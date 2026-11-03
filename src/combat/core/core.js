// Núcleo de simulación de pelea (Rick Combate). Paso fijo a TICK_RATE (60 Hz), determinista por seed.
// API:
//   createFightCore(a, b, seed, options?) -> state
//   stepCore(state) -> { tick: FightTick, events: FightEvent[] }   (avanza 1 tick)
//   runCore(a, b, seed, options?) -> { seed, tickRate, ticks, events, winner, reason, method, detail, result, stats }
// a/b: FighterSpec del contrato (o perfil de createFighter). Unidades en px. Ver src/fight/README.md.
import { TICK_RATE, ACTIONS } from '../kage-contracts.js';
import { MOVES, PX_PER_M as U, subClipOf } from '../data/moves.js';
import { moveArea } from '../data/styles.js';
import { createRng } from './rng.js';
import { FIGHT_EVENTS, FIGHT_EVENTS_EXT as X } from './events.js';
import { createFighter, createRuntime, condition, fatigueOf, damageOf } from './fighter.js';
import * as AI from './ai.js';
import { createGeometry } from '../geometry.js';
import { resolveControllers, sameIntent } from './controllers.js';
import { resolveStrike, resolveTakedown, resolveGroundContest, checkDamage, subOffense, subDefense, prowess, rel, softSubEdge, dist, clamp, sig, skill, hitstopFor, cornered, stepInPerTick, stepInReach, STEP_BACK_PX, reachable, canUseMove } from './resolve.js';
const KD_BACK = 0.04; // prob. de tomar la espalda al rematar en el suelo tras knockdown

// Valores tunables. tuning.js (del otro agente) puede pasar overrides en options (merge superficial + hitstop/windows).
export const DEFAULT_TUNING = Object.freeze({
  rounds: 3,
  roundSeconds: 90,          // tiempo de simulación por round (escalado; MMA real = 300)
  restSeconds: 3,            // descanso entre rounds (ticks sin acción)
  cage: 260,                 // media arena en px (contrato: ±260)
  startGap: 180,             // distancia inicial (px)
  minGap: 50,                // distancia mínima DURA entre pelvis de pie (px). Medido en src/anim: hombro adelantado en guardia a 12.8 px del ancla
                              // (torsos a ≥24 px uno del otro); 50 deja entrar el uppercut de pie (ideal 48.2, ventana 42.2–54.2) sin cruzar torsos
  koScale: 0.24,             // multiplica probabilidades de KO/knockdown
  damageScale: 0.15,         // fracción del daño que se acumula en zonas (ritmo de TKO por acumulación)
  limbDamageMul: 1.9,        // multiplicador extra para cuerpo/piernas (el KO de cabeza va por probabilidad aparte)
  tempoCost: 1.6,            // penaliza en la IA golpes "sin motivo" (sin lectura/castigo/apertura)
  neutralGap: 0.35,          // m extra sobre el rango del estilo donde se mueven entre intercambios
  pace: 1.3,                  // >1 = más pausas entre acciones (pelea más lenta/táctica)
  tdBias: 0,                 // sesgo logit de éxito de derribo
  subBias: 0,                // sesgo logit de "trabar" sumisión
  getUpBias: 0,
  standupSeconds: 9,         // árbitro los para si no pasa nada en el suelo
  clinchBreakSeconds: 6,     // árbitro rompe clinch estancado
  maxSubSeconds: 5,
  hitstop: Object.freeze({ base: 2, perDamage: 0.55, min: 2, max: 24, ko: 30, knockdown: 16, parry: 3, takedown: 6, sweep: 4 }),
  windows: Object.freeze({
    comboCancel: 0.45,       // fracción del recovery tras la cual se encadena el siguiente golpe del combo
    comboStartupMul: 0.8,    // startup de golpes encadenados
    counterStartupMul: 0.75, // startup de contragolpes
    hitstun: 14,             // ticks mostrando 'hit' tras recibir
    blockstun: 8,
    dodgeShow: 10,
  }),
  // Stats efectivos por pelea (fighter.effectiveStats): 50 + (media-50)·levelKeep + (s-media)·statSpread + forma
  // del día (gauss·formSd puntos, por peleador y pelea). Nivel absoluto pesa poco; la diferencia entre ellos, mucho.
  // Nivel RELATIVO: solo la velocidad conserva 30% del nivel absoluto (un 10 v 10 se ve más lento); daño,
  // mandíbula, cardio, técnica... cuentan solo frente al rival, así 10 v 10 finaliza igual que 85 v 85.
  levelKeep: { velocidad: 0.3 },
  // Instinto de cierre: suma a la utilidad de sumisión cuando el rival está cansado/golpeado/aturdido.
  subInstinct: 1.5,
  legsTko: 1.05,             // TKO por piernas al superar legsCap·legsTko
  legsHunt: 0.3,             // IA: valor extra de patear piernas ya tocadas
  legsToHead: 0.8,           // IA: valor extra de ir a la cabeza de un rival con piernas tocadas
  statSpread: 0.75,
  formSd: 5,
  maxTicks: 60 * 60 * 30,    // salvaguarda
});

function mergeOpts(o = {}) {
  return { ...DEFAULT_TUNING, ...o, hitstop: { ...DEFAULT_TUNING.hitstop, ...(o.hitstop ?? {}) }, windows: { ...DEFAULT_TUNING.windows, ...(o.windows ?? {}) } };
}

const newStats = () => ({ thrown: {}, landed: {}, defended: 0, tdAtt: 0, tdLand: 0, subAtt: 0, kd: 0, rocked: 0, passes: 0, sweeps: 0, feints: 0, clinches: 0, ctrl: 0 });
// Métricas de IA pro (sólo lectura; no consumen RNG): traza de decisiones con footwork, combos, fintas castigadas, salidas, reja.
const newPro = () => ({ trace: [], comboLens: [], feints: 0, feintBit: 0, feintPunished: 0, pivots: 0, exits: 0, circles: 0, cuts: 0, cageTicks: 0, standTicks: 0, clinchAtt: 0, clinchKnees: 0, clinchElbows: 0, underhooks: 0, roundThrown: [] });
const newRoundStat = () => ({ dmg: 0, landed: 0, kd: 0, td: 0, tdAtt: 0, ctrl: 0, subAtt: 0, adv: 0, attempts: 0 });

export function createFightCore(a, b, seed = 1, options = {}) {
  const { geometry: geoSpec, ...coreOptions } = options; // la geometría no es tuning: se aparta de F.opt
  const opt = mergeOpts(coreOptions);
  const pa = createFighter(a), pb = createFighter(b);
  const rng = createRng('fight:' + seed);
  const fr = rng.fork('form');
  const center = Object.fromEntries(Object.keys(pa.stats).map((k) => [k, (pa.stats[k] + pb.stats[k]) / 2]));
  // Gaps enormes (T12 ~100 vs makeRival ~23): comprimir spread para ~75–85% W sin tocar mirrors (gap≈0).
  const rawGap = Object.keys(pa.stats).reduce((s, k) => s + Math.abs(pa.stats[k] - pb.stats[k]), 0) / Object.keys(pa.stats).length;
  const spread = opt.statSpread * Math.min(1, 22 / Math.max(12, rawGap));
  const effOf = () => ({ center, levelKeep: opt.levelKeep, spread, form: Math.round(fr.gauss() * opt.formSd * 100) / 100 });
  const A = createRuntime(pa, 'a', effOf());
  const B = createRuntime(pb, 'b', effOf());
  const geo = createGeometry(geoSpec, opt);
  geo.place(A, B, opt.startGap);
  A.mem = AI.initMemory(); B.mem = AI.initMemory();
  const F = {
    seed, opt, rng, ai: AI, geo,
    controllers: resolveControllers(options.controllers), // { a, b }: quién decide cada lado (default IA)
    inputs: [],                                           // grabación de inputs humanos: [{ t, side, intent }] (sólo cambios)
    lastInput: { a: null, b: null },
    aiRng: { a: rng.fork('ai:a'), b: rng.fork('ai:b') },
    t: 0, round: 1, roundT: 0, roundTicks: Math.round(opt.roundSeconds * TICK_RATE), rest: 0,
    phase: 'stand', ground: null, clinch: null, sub: null, pounce: null,
    fighters: [A, B], byId: { a: A, b: B },
    out: [], events: [], done: false, result: null, endT: -1,
    stats: { a: newStats(), b: newStats() },
    pro: { a: newPro(), b: newPro(), roundTicks: [] },
    phaseTicks: { stand: 0, clinch: 0, ground: 0 },
    roundStats: [{ a: newRoundStat(), b: newRoundStat() }],
    cards: [],
    judges: [0, 1, 2].map((i) => { const r = rng.fork('judge' + i); return { rng: r, wDmg: r.float(0.85, 1.15), wCtrl: r.float(0.6, 1.4), wAgg: r.float(0.5, 1.5) }; }),
  };
  bindMethods(F);
  geo.bind(F);
  for (const f of F.fighters) { f.disp = { action: ACTIONS.IDLE, since: 0 }; f.animSeq = 0; }
  return F;
}

// ---------------------------------------------------------------------------
function bindMethods(F) {
  const other = (f) => (f === F.fighters[0] ? F.fighters[1] : F.fighters[0]);
  F.other = other;
  F.emit = (type, p = {}) => {
    const ev = { tick: F.t, type, actor: p.actor ?? p.attacker ?? null, round: F.round, ...p };
    F.out.push(ev); F.events.push(ev);
    noteReaction(F, ev);
    return ev;
  };
  F.roundStat = (id) => F.roundStats[F.round - 1][id];
  F.note = (f, tok) => { F.pro[f.id].trace.push(tok); };
  F.react = (f, action, ticks, clip = REACT_CLIP[action] ?? 'guard') => { f.react = { action, clip, until: F.t + ticks }; f.animSeq++; };

  F.startAction = (f, moveId, o = {}) => {
    const mv = MOVES[moveId];
    if (!mv || !canUseMove(f, mv)) return; // B5: expert desde nivel 10
    const c = condition(f);
    const sm = f.attr.speedMul * c.speed;
    let startup = Math.max(3, Math.round(mv.startup * sm * (o.startupMul ?? 1)));
    const kickRec = moveArea(mv) === 'kick' && mv.phase === 'stand' ? 1 - 0.18 * (f.style.rangeKick ?? 0) : 1; // retrae rápido: menos expuesto
    const recovery = Math.max(4, Math.round(mv.recovery * sm * kickRec));
    f.stamina = Math.max(0, f.stamina - mv.stamina);
    f.staminaMax = Math.max(40, f.staminaMax - mv.stamina * 0.04);
    f.action = { move: moveId, t: 0, startup, active: mv.active, recovery, resolved: false, counter: !!o.counter, afterFeint: F.t < (f.feintFollow ?? -1), setup: !!o.setup, exploit: !!o.exploit, chain: !!o.chain, stepThis: 0, lungeTotal: 0, lungeDone: 0 };
    // Estocada/paso previsto (px hacia facing): Animador lo lee en tick.lunge/step; el root se congela en activo.
    if (mv.rangeMax && (mv.kind === 'strike' || mv.kind === 'takedown' || mv.kind === 'clinch')) {
      f.action.lungeTotal = stepInReach(mv);
    }
    // Clip de combo de Animador: jab-jab, jab-jab-cross, y entrada+jab-jab (stepJabJab). Sustituye al clip del último golpe del patrón.
    if (mv.kind === 'strike' && F.phase === 'stand') {
      const cs = o.chain && f.chainSeq ? f.chainSeq : (f.chainSeq = { moves: [], step: F.t - (f.lastStepInT ?? -999) <= 60 });
      if (!o.chain) { cs.moves = []; cs.step = F.t - (f.lastStepInT ?? -999) <= 60; }
      cs.moves.push(moveId);
      const m = cs.moves, n = m.length;
      f.action.clip = null;
      if (moveId === 'jab' && n === 2 && m[0] === 'jab') f.action.clip = cs.step ? 'stepJabJab' : 'jabJab';
      else if (moveId === 'cross' && n === 3 && m[0] === 'jab' && m[1] === 'jab') f.action.clip = 'jabJabCross';
    }
    f.lastMove = moveId;
    f.lastWasFeint = false;
    const P = F.pro[f.id];
    F.note(f, moveId);
    if (mv.kind === 'strike' && F.phase !== 'ground') {
      (P.roundThrown[F.round - 1] = (P.roundThrown[F.round - 1] ?? 0) + 1);
      if (o.chain && P.comboLens.length) P.comboLens[P.comboLens.length - 1]++; else P.comboLens.push(1);
    }
    if (moveId === 'clinchEntry') P.clinchAtt++;
    if (moveId === 'clinchKnee' || moveId === 'clinchKneeHead') P.clinchKnees++;
    if (moveId === 'clinchElbow') P.clinchElbows++;
    if (mv.kind === 'strike' && F.phase === 'stand') f.lastStrikeT = F.t;
    f.foot = null;
    f.react = null;
    f.animSeq++;
    F.roundStat(f.id).attempts++;
    const o2 = other(f);
    AI.observe(F, o2, { kind: 'oppAction', move: mv });
    if (mv.kind === 'takedown') f.lastTdT = F.t;
    if (moveId === 'clinchEntry') f.lastClinchT = F.t;
    const p = { attacker: f.id, defender: o2.id, move: moveId, limb: mv.limb, target: mv.zone, angle: mv.angle, arc: mv.arc, startup, active: mv.active, recovery, counter: !!o.counter, combo: !!o.chain, read: !!o.exploit, power: Math.round(clamp(mv.damage / 16, 0, 1) * 1000) / 1000, hitstop: 0, phase: F.phase };
    if (mv.kind === 'strike') F.emit(FIGHT_EVENTS.STRIKE, p);
    else if (mv.kind === 'sub') { /* el evento SUB_ATTEMPT sale al resolver */ }
    else F.emit(X.ACTION ?? 'action', p);
  };

  F.startFeint = (f, variant) => {
    const rng = F.aiRng[f.id];
    const fake = variant === 'takedown' ? 'doubleLeg' : variant === 'strike' ? (f.style.moveW.lowKick > 1 && rng.chance(0.3) ? 'lowKick' : rng.chance(0.6) ? 'jab' : 'cross')
      : f.style.moveW.lowKick > 1 && rng.chance(0.3) ? 'lowKick' : f.style.td > 0.3 && rng.chance(0.4) ? 'doubleLeg' : rng.chance(0.6) ? 'jab' : 'cross';
    f.foot = null;
    // A2: finta sin estocada (lunge/step=0); root anclado tras resolve (rootLocked)
    f.action = { move: fake, t: 0, startup: 7, active: 1, recovery: 6, resolved: false, feint: true, variant: MOVES[fake].kind === 'takedown' ? 'takedown' : 'strike', stepThis: 0, lungeTotal: 0, lungeDone: 0 };
    F.pro[f.id].feints++; F.note(f, 'feint:' + f.action.variant);
    f.stamina = Math.max(0, f.stamina - 0.6);
    f.lastWasFeint = true;
    f.react = null;
    f.animSeq++;
    F.stats[f.id].feints++;
  };

  F.maybeCounter = (D, A, how) => {
    if (D.action || D.down > 0 || F.done || F.phase !== 'stand') return;
    if (F.controllers[D.id].autoCounter === false) { D.counterUntil = F.t + 18; return; } // humano: su próximo golpe sale como contra
    const c = condition(D);
    let p = D.style.counter * 0.65 + 0.1 + (F.t < D.counterReady ? 0.3 : 0) + (how === 'slip' || how === 'parry' ? 0.12 : 0) + (how === 'catch' ? 0.4 : 0);
    if (c.stamina < 0.15) p *= 0.3;
    if (!F.aiRng[D.id].chance(clamp(p, 0, 0.92))) return;
    const id = AI.pickCounter(F, D, A, how);
    if (!id || D.stamina < MOVES[id].stamina) return;
    F.startAction(D, id, { counter: true, startupMul: F.opt.windows.counterStartupMul });
  };

  F.onCatch = (B, A) => {
    // B atrapó la patada de A
    const w = prowess(B, 'wrestling');
    if (B.style.td > 0.15 || w > 0.75) {
      const p = sig(rel(w, prowess(A, 'wrestling') * 0.6) * 5 + 0.6);
      F.stats[B.id].tdAtt++; F.roundStat(B.id).tdAtt++;
      if (F.rng.chance(p)) {
        F.stats[B.id].tdLand++; F.roundStat(B.id).td++;
        F.emit(FIGHT_EVENTS.TAKEDOWN, { attacker: B.id, defender: A.id, move: 'kickCatch', limb: 'handR', target: 'legs', angle: 30, arc: 'shoot', pos: 'guard', power: 0.5, hitstop: F.opt.hitstop.takedown });
        F.startGround(B, A, 'guard');
        return;
      }
    }
    A.action = null;
    F.maybeCounter(B, A, 'catch');
  };

  F.rock = (A, B, ticks) => {
    if (B.rocked <= 0) { F.stats[A.id].rocked++; F.emit(X.ROCKED, { attacker: A.id, defender: B.id, ticks, hitstop: 4 }); }
    B.rocked = Math.max(B.rocked, ticks);
    A.momentum = clamp(A.momentum + 0.25, -1, 1);
  };

  F.knockdown = (A, B, move, reason = 'strike') => {
    if (F.done) return;
    const ticks = Math.round(70 + 110 * (1 - B.attr.recovery) + F.rng.int(0, 40));
    B.down = ticks; B.action = null; B.queue.length = 0; B.rocked = 0; B.unanswered = 1;
    A.queue.length = 0;
    F.stats[A.id].kd++; F.roundStat(A.id).kd++;
    A.momentum = clamp(A.momentum + 0.4, -1, 1);
    if (F.phase === 'clinch') { F.phase = 'stand'; F.clinch = null; }
    F.emit(X.KNOCKDOWN, { attacker: A.id, defender: B.id, move: move.id, target: move.zone, reason, getUpIn: ticks, power: 1, hitstop: F.opt.hitstop.knockdown });
    // ¿remata en el suelo o lo deja pararse?
    const choice = AI.onKnockdown(F, A, B);
    F.pounce = choice === 'pounce' ? { by: A, on: B } : null;
    if (!F.pounce) { A.intent = { dir: -1, until: F.t + 40 }; A.nextDecision = F.t + ticks; }
  };

  F.finish = (winner, method, move, extra = {}) => {
    if (F.done) return;
    const loser = other(winner);
    F.done = true;
    F.endT = F.t;
    F.result = { winner: winner ? winner.id : null, loser: loser && winner ? loser.id : null, method, detail: extra.reason ?? move ?? null, move: move ?? null, koZone: extra.koZone ?? null, round: F.round, roundTime: F.roundT, tick: F.t };
    // B3 KO limpio: congelar roots, limpiar acciones/slide/intent/pounce para que Anim no deslice al caer
    F.pounce = null;
    F.sub = null;
    for (const f of F.fighters) {
      f.action = null;
      f.queue.length = 0;
      f.slide = null;
      f.intent = { dir: 0, until: 0 };
      f.foot = null;
      f.rocked = 0;
      if (method === 'KO' || method === 'TKO') f.react = null;
    }
    if (method === 'KO' || method === 'TKO') {
      // Animador: koZone precisa + move; TKO lleva reason/detail
      const koZone = extra.koZone ?? null;
      F.emit(FIGHT_EVENTS.KO, {
        attacker: winner.id, defender: loser.id, move: move ?? null, method,
        reason: extra.reason ?? null, detail: extra.reason ?? null,
        koZone, target: koZone === 'legs' ? 'legs' : koZone === 'body' ? 'body' : 'head',
        power: 1, hitstop: F.opt.hitstop.ko,
      });
    }
    if (method === 'KO' || method === 'TKO' || method === 'SUB') { loser.koed = method !== 'SUB'; loser.lost = true; winner.won = true; }
    else if (winner) winner.won = true;
    F.emit(X.FIGHT_END, { result: F.result, actor: F.result.winner });
  };

  F.startGround = (top, bottom, pos) => {
    F.phase = 'ground'; F.clinch = null; F.pounce = null;
    F.ground = { top, bottom, pos, since: F.t, lastActivity: F.t, exposed: -1 };
    F.geo.gather(top, bottom, 30); // mismo punto; el Animador separa visualmente
    for (const f of F.fighters) { f.action = null; f.queue.length = 0; f.rocked = 0; f.intent = { dir: 0, until: 0 }; f.nextDecision = F.t + 18; }
    F.emit(X.POSITION, { actor: top.id, attacker: top.id, defender: bottom.id, top: top.id, bottom: bottom.id, pos });
  };

  F.setPosition = (pos, moveId, byBottom = false) => {
    const g = F.ground;
    g.pos = pos; g.lastActivity = F.t;
    for (const f of F.fighters) { f.getUpFails = 0; f.gRun = 0; f.gLast = null; }
    const actor = byBottom ? g.bottom : g.top;
    F.emit(X.POSITION, { actor: actor.id, attacker: actor.id, defender: other(actor).id, top: g.top.id, bottom: g.bottom.id, pos, move: moveId });
  };

  F.standUp = (A, B, sepM = 1.0) => {
    for (const f of F.fighters) { f.getUpFails = 0; f.gRun = 0; f.gLast = null; }
    F.geo.standUp(A, B, sepM * U);
    F.phase = 'stand'; F.ground = null; F.clinch = null; F.sub = null;
    for (const f of F.fighters) { f.action = null; f.queue.length = 0; f.dazed = 0; f.down = 0; f.nextDecision = F.t + 15; }
  };

  F.startClinch = (A, B, kind = 'entry') => {
    F.phase = 'clinch';
    F.clinch = { init: A, since: F.t, lastActivity: F.t };
    { const cA = prowess(A, 'clinch'), cB = prowess(B, 'clinch'); const w = F.aiRng[A.id].chance(sig(rel(cA, cB) * 4)) ? A : B; F.clinch.underhook = w; F.pro[w.id].underhooks++; }
    F.geo.clinchPlace(A, B, 0.35 * U); // ~60px: rodilla/uppercut del clinch tocan sin atravesar
    for (const f of F.fighters) { f.action = null; f.queue.length = 0; f.nextDecision = F.t + 12; }
    F.stats[A.id].clinches++;
    F.emit(X.CLINCH, { attacker: A.id, defender: B.id, kind });
  };

  F.startSub = (A, B, moveId, snap = 0) => { // snap: bonus de la sumisión oportunista (guillotina al shoot leído)
    const mv = MOVES[moveId];
    const clip = subClipOf(mv); // armbar|kimura|triangle|rearNaked|heelHook|kneeBar (o id si sin clip)
    F.stats[A.id].subAtt++; F.roundStat(A.id).subAtt++;
    for (const f of F.fighters) { f.action = null; f.queue.length = 0; }
    F.emit(X.SUB_ATTEMPT, { attacker: A.id, defender: B.id, move: clip, limb: mv.limb, target: mv.zone, hitstop: 0 });
    if (F.ground) F.ground.lastActivity = F.t;
    const posAdj = (F.ground ? ({ guard: -0.12, half: -0.12, side: 0, mount: 0.06, back: 0.1 }[F.ground.pos] ?? 0) : 0) + snap;
    const lock = sig(softSubEdge(rel(subOffense(A, mv), subDefense(B)) + posAdj) * 3.5 - 0.45 + F.opt.subBias);
    if (!F.rng.chance(lock)) return F.subFailed(A, B, mv, 'defended');
    F.sub = { A, B, move: mv, progress: 0.15, t0: F.t, posAdj };
  };

  F.subFailed = (A, B, mv, kind) => {
    F.sub = null;
    AI.observe(F, A, { kind: 'subFail' });
    const clip = subClipOf(mv);
    F.emit(X.SUBMISSION, { attacker: A.id, defender: B.id, move: clip, phase: 'escape', pressure: 0, result: 'escape' });
    F.emit(X.SUB_ESCAPE, { attacker: A.id, defender: B.id, actor: B.id, move: clip, kind });
    for (const f of F.fighters) f.nextDecision = F.t + 10;
    if (!F.ground) return;
    const g = F.ground;
    if (mv.lose === 'guardBottom' && F.rng.chance(0.6)) F.startGround(B, A, 'guard');
    else if (g.bottom === A && F.rng.chance(0.35)) F.setPosition(mv.id === 'guillotine' ? 'half' : 'half', 'pass');
  };

  F.forDisplay = (f) => displayAction(F, f);
}

// ---------------------------------------------------------------------------
function updateSub(F) {
  const s = F.sub;
  const { A, B, move } = s;
  A.stamina = Math.max(0, A.stamina - 0.04);
  B.stamina = Math.max(0, B.stamina - 0.08);
  F.ground.lastActivity = F.t;
  if ((F.t - s.t0) % 12 !== 11) return;
  const edge = softSubEdge(rel(subOffense(A, move), subDefense(B)) + s.posAdj);
  s.progress += 0.22 * edge + 0.14 * F.rng.gauss();
  if (s.progress >= 1) {
    // B4: llaves articulares dejan lesión al tap; estrangulaciones (choke) no
    // result:'break' ↔ injury dislocated|broken (Animador Ronda 17); choke → result:'tap'
    let injury = null;
    const clip = subClipOf(move);
    if (!move.choke) {
      const joint = move.joint || (({
        armbarTop: 'elbowR', armbarGuard: 'elbowL', kimura: 'shoulderR',
        heelHook: 'kneeR', kneeBar: 'kneeR',
      })[move.id] ?? (move.zone === 'body' ? 'elbowR' : move.zone === 'legs' ? 'kneeR' : null));
      if (joint) {
        // progreso agresivo / edge alto → broken; si no, dislocated
        const kind = s.progress >= 1.15 || (F.t - s.t0) > F.opt.maxSubSeconds * TICK_RATE * 0.7 ? 'broken' : 'dislocated';
        B.injuries = B.injuries || {};
        B.injuries[joint] = kind;
        if (joint.startsWith('knee') || joint.startsWith('ankle')) {
          B.dmg.legs = (B.dmg.legs ?? 0) + (kind === 'broken' ? B.attr.legsCap * 0.45 : B.attr.legsCap * 0.3);
        } else {
          const arm = joint.endsWith('L') ? 'armL' : 'armR';
          B.dmg[arm] = (B.dmg[arm] ?? 0) + (kind === 'broken' ? B.attr.armCap * 0.55 : B.attr.armCap * 0.35);
        }
        injury = { part: joint, kind };
      }
    }
    const result = injury ? 'break' : 'tap';
    const pressure = clamp(s.progress, 0, 1);
    F.emit(X.SUBMISSION, { attacker: A.id, defender: B.id, move: clip, phase: result, pressure, result });
    const tapEv = { attacker: A.id, defender: B.id, actor: B.id, move: clip, limb: move.limb, target: move.zone, hitstop: 10, result };
    if (injury) tapEv.injury = injury;
    F.emit(X.TAP, tapEv);
    return F.finish(A, 'SUB', clip, { reason: clip, injury });
  }
  if (s.progress <= 0 || F.t - s.t0 > F.opt.maxSubSeconds * TICK_RATE) F.subFailed(A, B, move, 'escape');
}

function endAction(F, f) {
  const act = f.action;
  f.action = null;
  const o = F.other(f);
  // "Tell": baja la guardia tras ciertos golpes
  const tell = f.profile.tells[act.move];
  if (!act.feint && tell && F.aiRng[f.id].chance(tell)) {
    f.guardDropUntil = F.t + 22;
    if (F.aiRng[o.id].chance(0.25 + 0.6 * o.attr.technique)) {
      AI.observe(F, o, { kind: 'tell', move: MOVES[act.move] });
      if ((o.mem.tells[act.move] ?? 0) >= 2 && !o.action) o.nextDecision = Math.min(o.nextDecision, F.t + 1);
    }
  }
  // combo
  if (f.queue.length && !F.done && f.down <= 0) {
    let next = f.queue.shift();
    if (!act.feint && F.phase === 'stand') next = AI.adaptNext(F, f, next, act);
    const mv = MOVES[next];
    const okPhase = mv.phase === F.phase || (mv.kind === 'takedown' && F.phase === 'stand');
    const inWin = mv.kind !== 'strike' || F.phase !== 'stand' || reachable(F, mv, dist(F));
    const go = act.feint || act.result === 'hit' || act.result === 'block' || act.result === 'check' || F.aiRng[f.id].chance(0.4 + 0.5 * f.style.combo);
    const ok = okPhase && inWin && f.stamina >= mv.stamina && go;
    if (ok) { F.startAction(f, next, { chain: !act.feint, setup: true, startupMul: F.opt.windows.comboStartupMul }); return; }
    f.queue.length = 0;
  }
  if (act.feint) { f.nextDecision = Math.min(f.nextDecision, F.t + 2); return; }
  f.nextDecision = Math.max(f.nextDecision, F.t + thinkTicks(F, f));
  // salir del pocket tras el intercambio (hit-and-move), según estilo
  // (contra la reja: pivot en ángulo; afuera: stepOut corto o salida caminando)
  const rng = F.aiRng[f.id];
  if (F.phase === 'stand' && rng.chance(0.25 + 0.5 * (1 - f.style.aggression) + (act.result === 'hit' ? -0.1 : 0.1))) {
    const nearCage = F.geo.backToWall(f) && F.geo.wallDistance(f) < 60;
    const kind = nearCage ? 'pivot' : rng.chance(0.45 + 0.3 * (f.style.rangeKick ?? 0)) ? 'pivot' : rng.chance(0.5) ? 'stepOut' : 'exit';
    const n = kind === 'pivot' ? rng.int(14, 22) : kind === 'stepOut' ? rng.int(6, 9) : rng.int(8, 20);
    f.intent = { dir: -1, until: F.t + n };
    f.foot = { kind, until: F.t + n, dir: rng.chance(0.75) ? 1 : -1 };
    f.animSeq++;
    f.nextDecision = Math.max(f.nextDecision, f.intent.until);
    if (kind === 'pivot') F.pro[f.id].pivots++; else F.pro[f.id].exits++;
    F.note(f, kind);
  }
  // reset tras el intercambio: los dos se reacomodan (tanteo) antes de la próxima ráfaga
  if (F.phase === 'stand' && MOVES[act.move].kind !== 'clinch') tempoReset(F, f, o);
}

// Ritmo de pelea pro: tanteo al empezar cada round (R1 más largo), reset de ambos tras cada intercambio.
// Urgencia (R3 perdiendo) acorta las pausas; cansancio las alarga. Sólo usa los RNG de IA.
const FEINT_FOLLOW = 60;                  // ticks en que el golpe/derribo tras la finta cuenta como 'afterFeint'
const STUDY = [[150, 260], [90, 170], [70, 140]];   // ticks de tanteo al abrir R1 / R2 / R3+
const RESET = { p: 0.85, min: 110, max: 230 };       // prob. y duración del reset tras un intercambio
function studyPhase(F) {
  const [lo, hi] = STUDY[Math.min(F.round, STUDY.length) - 1];
  for (const f of F.fighters) f.calmUntil = F.t + Math.round(F.aiRng[f.id].int(lo, hi) * (1 - 0.6 * AI.urgency(F, f)));
}
function tempoReset(F, f, o) {
  const rng = F.aiRng[f.id];
  const tired = condition(f).stamina < 0.45 ? 1.25 : 1;
  if (!rng.chance(RESET.p * (F.round === 1 ? 1.1 : 1) * (1 - 0.5 * AI.urgency(F, f)))) return;
  const n = rng.int(RESET.min, RESET.max) * tired * (F.round === 1 ? 1.15 : 1);
  f.calmUntil = Math.max(f.calmUntil ?? 0, F.t + Math.round(n * (1 - 0.6 * AI.urgency(F, f))));
  o.calmUntil = Math.max(o.calmUntil ?? 0, F.t + Math.round(n * 0.85 * (1 - 0.6 * AI.urgency(F, o))));
}

function thinkTicks(F, f) {
  const ag = f.style.aggression;
  const base = F.phase === 'stand' ? 10 + 14 * (1 - 0.5 * f.attr.technique) : 8 + 8 * (1 - 0.5 * f.attr.technique);
  return Math.round(base * F.opt.pace * (1.3 - 0.6 * ag)) + F.aiRng[f.id].int(0, 10);
}

function advanceAction(F, f) {
  const act = f.action;
  if (!act) return;
  const o = F.other(f);
  const mv = MOVES[act.move];
  act.t++;
  act.stepThis = 0;
  // paso/estocada SOLO en startup temprano (t < startup): el tick de impacto y la fase activa quedan con root quieto
  // (Animador: pie plantado no desliza; el avance previsto va en tick.lunge / tick.step).
  // Apunta a que la distancia EN EL TICK DE IMPACTO sea rangeIdeal; nunca bajo minGap.
  if (F.phase === 'stand' && !act.resolved && !act.feint && mv.rangeMax && act.t < act.startup && F.impactT !== F.t) {
    const d = dist(F);
    const target = Math.max(mv.rangeIdeal ?? mv.rangeMax * 0.9, F.opt.minGap);
    const left = act.startup - act.t; // ticks de startup que quedan (sin contar el de impacto)
    if (d > target) {
      const cap = Math.max(stepInPerTick(mv, Math.max(1, act.startup - 1)), (act.stepLeft ??= stepInReach(mv)) / Math.max(1, left));
      const step = Math.min(cap, act.stepLeft, d - target);
      act.stepLeft -= step;
      act.stepThis = step;
      act.lungeDone = (act.lungeDone ?? 0) + step;
      F.geo.moveAlong(f, step); F.geo.clampToRing(f);
    } else if (d < target && !cornered(F, f)) {
      const cap = Math.max(STEP_BACK_PX / Math.max(1, act.startup - 1), (act.backLeft ??= Math.max(STEP_BACK_PX, 0.8 * stepInReach(mv))) / Math.max(1, left));
      const step = Math.min(cap, act.backLeft, target - d);
      act.backLeft -= step;
      act.stepThis = -step; // negativo = recule (espacio del peleador)
      F.geo.moveAlong(f, -step); F.geo.clampToRing(f);
    }
  }
  if (!act.resolved && act.t >= act.startup) {
    act.resolved = true;
    if (act.feint) {
      const bitP = clamp(0.6 - 0.4 * o.attr.technique - 0.05 * (o.mem.feint[1] - 2) + (o.action ? -1 : 0), 0.05, 0.7);
      const bit = F.phase === 'stand' && F.aiRng[o.id].chance(bitP);
      if (bit) { o.feintBit = F.t + 20; o.nextDecision = Math.max(o.nextDecision, F.t + 14); F.react(o, ACTIONS.BLOCK, 10); F.pro[f.id].feintBit++; f.feintOpen = F.t + 45; }
      f.feintFollow = F.t + FEINT_FOLLOW;
      AI.observe(F, f, { kind: 'feint', bit });
      F.emit(X.FEINT, { attacker: f.id, defender: o.id, move: act.move, bit, hitstop: 0 });
      f.nextDecision = F.t + act.recovery;  // decide el golpe real apenas termina
    } else if (mv.kind === 'strike') act.result = resolveStrike(F, f, o, act);
    else if (mv.kind === 'takedown') act.result = resolveTakedown(F, f, o, act) ? 'td' : 'stuffed';
    else if (mv.kind === 'sub') { F.startSub(f, o, mv.id); return; }
    else if (mv.kind === 'clinch') resolveClinchEntry(F, f, o, act);
    else if (mv.id === 'breakClinch') resolveBreak(F, f, o);
    else if (F.phase === 'ground') resolveGroundContest(F, f, o, act);
    if (!act.feint && F.t <= (f.feintOpen ?? -1) && (act.result === 'hit' || act.result === 'td')) { F.pro[f.id].feintPunished++; f.feintOpen = -1; }
    if (F.done || f.action !== act) return;
  }
  if (f.queue.length && act.resolved && act.t >= act.startup + act.active + Math.round(act.recovery * F.opt.windows.comboCancel)) return endAction(F, f);
  if (act.t >= act.startup + act.active + act.recovery) endAction(F, f);
}

function resolveClinchEntry(F, A, B, act) {
  const read = !B.action && F.rng.chance(0.5);
  const p = sig(rel(prowess(A, 'clinch'), prowess(B, 'clinch') * (read ? 0.9 : 0.55)) * 4 + 0.25);
  if (dist(F) < 1.1 * U && F.rng.chance(p)) F.startClinch(A, B);
  else F.emit(FIGHT_EVENTS.DODGE, { attacker: A.id, defender: B.id, move: act.move, kind: 'pummel', limb: 'handR', target: 'body', power: 0, hitstop: 0 });
}

function resolveBreak(F, A, B) {
  const p = sig(rel(prowess(A, 'clinch') * 0.8 + 0.3 * A.stats.velocidad / 100, prowess(B, 'clinch') * 0.8) * 4 + 0.6);
  if (F.rng.chance(p)) { F.emit(X.BREAK, { attacker: A.id, defender: B.id, reason: 'break' }); F.standUp(A, B, 1.0); }
}

function applyDecision(F, f, o, dec) {
  if (!dec) return;
  if (dec.kind === 'action') {
    f.queue = dec.combo ? [...dec.combo] : [];
    if (F.t < (f.counterUntil ?? -1) && MOVES[dec.move].kind === 'strike') { f.counterUntil = -1; F.startAction(f, dec.move, { counter: true, startupMul: F.opt.windows.counterStartupMul }); }
    else F.startAction(f, dec.move, { exploit: dec.exploit });
    f.intent = { dir: 0, until: 0 };
  } else if (dec.kind === 'feint') {
    F.startFeint(f, dec.variant);
    f.queue = dec.follow ? [dec.follow] : [];
  } else if (dec.kind === 'move') {
    f.intent = { dir: dec.dir, until: F.t + dec.ticks };
    const foot = F.phase === 'stand' ? (dec.foot ?? (dec.dir > 0 ? 'advance' : 'retreat')) : null;
    f.foot = foot ? { kind: foot, until: F.t + dec.ticks, dir: dec.orbitDir ?? 1 } : null;
    if (foot) {
      F.note(f, foot);
      if (foot === 'pivot') F.pro[f.id].pivots++;
      else if (foot === 'cutAngle') F.pro[f.id].cuts++;
      else if (foot === 'circle') F.pro[f.id].circles++;
      if (foot === 'stepIn') f.lastStepInT = F.t;
      if (foot === 'pivot' || foot === 'stepIn' || foot === 'stepOut') f.animSeq++;
    }
    f.nextDecision = F.t + (dec.next ?? Math.max(4, Math.round(dec.ticks * 0.6)));
  } else {
    f.intent = { dir: 0, until: F.t + dec.ticks };
    f.foot = null;
    if (F.phase !== 'ground') F.note(f, F.phase === 'clinch' ? 'clinchHold' : 'wait');
    f.counterReady = F.t + dec.ticks + 6;
    f.nextDecision = F.t + dec.ticks;
    if (F.phase === 'ground' && F.ground.top === f) F.ground.holdT = (F.ground.holdT ?? 0) + dec.ticks;
  }
}

/** Root anclado: golpe/finta ya resueltos (activo/recovery). Evita que minGap o el pivot del rival arrastren el pie plantado. */
function rootLocked(f) {
  const act = f.action;
  if (!act || !act.resolved) return false;
  if (act.feint) return true; // A2: finta también planta (sin desliz)
  const mv = MOVES[act.move];
  return !!(mv && mv.kind === 'strike');
}

function moveFighters(F) {
  const [A, B] = F.fighters;
  const geo = F.geo;
  const lockedX = new Map();
  for (const f of F.fighters) if (rootLocked(f)) lockedX.set(f, geo.save(f));
  for (const f of F.fighters) {
    if (f.down > 0 || f.action) continue;
    if (F.impactT === F.t) continue; // tick de impacto: nadie camina, la distancia dibujada es la del contacto
    const o = F.other(f);
    let dir = F.t < f.intent.until ? f.intent.dir : 0;
    if (F.pounce && F.pounce.by === f) dir = 1;
    if (!dir) continue;
    const c = condition(f);
    const rk = f.style.rangeKick ?? 0; // footwork del pateador: retrocede y gira sin perder velocidad
    const foot = f.foot && F.t < f.foot.until ? f.foot.kind : null;
    const sp = f.attr.moveSpeed * c.mobility * (dir < 0 ? 0.85 + 0.15 * rk : 1) * (foot === 'stepIn' || foot === 'stepOut' ? 1.3 : 1);
    const oCut = o.foot && F.t < o.foot.until && o.foot.kind === 'cutAngle';
    const cut = oCut ? 0.35 + 0.3 * rk : o.intent.dir > 0 && F.t < o.intent.until ? 0.45 + 0.3 * rk : 1;
    if (foot === 'pivot') {
      // pivot: sale en ángulo; en 1D el par gira -> se recentra (cerca de la reja) o retrocede poco (afuera)
      const wall = geo.wallDistance(f) < 60 && geo.backToWall(f);
      if (wall) geo.recenterPair(f, o, sp * 1.05 * cut);
      else geo.moveAlong(f, dir * sp * 0.35);
      continue;
    }
    if (foot === 'circle') {                     // orbita: en 1D casi no cambia la distancia
      geo.orbit(f, o, dir * sp * 0.2);
      f.circleUntil = F.t;
      continue;
    }
    if (dir < 0 && geo.exceedsWall(f, dir * sp, 2)) {
      // contra la reja: girar hacia afuera (circle; en 1D el par se recentra), más difícil si el otro corta el paso
      geo.recenterPair(f, o, sp * 0.7 * cut);
      if (!(f.circleUntil > F.t - 1)) { F.pro[f.id].circles++; F.note(f, 'circle'); }
      f.circleUntil = F.t + 1;
      f.circleDir ??= F.aiRng[f.id].chance(0.75) ? 1 : -1;     // (circle contra la reja: el par se recentra)
    } else geo.moveAlong(f, dir * sp);
  }
  if (F.impactT !== F.t) for (const f of F.fighters) if (f.slide && f.slide.n > 0) { geo.applyKnockback(f, f.slide.v); f.slide.n--; } // knockback repartido tras el impacto
  for (const f of F.fighters) geo.clampToRing(f);
  // separación mínima
  if (F.phase === 'stand' && !F.pounce) geo.separate(A, B, F.opt.minGap);
  // Reponer pelvis de quien está en golpe activo/recovery (el rival absorbe minGap / giros de reja).
  if (lockedX.size) {
    for (const [f, snap] of lockedX) geo.restore(f, snap);
    for (const f of F.fighters) geo.clampToRing(f);
    if (F.phase === 'stand' && !F.pounce) geo.separateLocked(A, B, F.opt.minGap, lockedX.has(A), lockedX.has(B), lockedX.get(A), lockedX.get(B));
  }
  if (F.phase === 'stand') geo.faceEachOther(A, B);
}

function tickUpkeep(F) {
  F.phaseTicks[F.phase]++;
  F.pro.roundTicks[F.round - 1] = (F.pro.roundTicks[F.round - 1] ?? 0) + 1;
  if (F.phase === 'stand') for (const f of F.fighters) { F.pro[f.id].standTicks++; if (cornered(F, f)) F.pro[f.id].cageTicks++; }
  for (const f of F.fighters) {
    const c = condition(f);
    if (!f.action && !F.sub) {
      const moving = F.t < f.intent.until && f.intent.dir !== 0;
      let r = f.attr.regen * c.regen * (moving ? 0.6 : 1);
      if (F.phase === 'ground' && F.ground.bottom === f) r *= 0.6;
      f.stamina = Math.min(f.staminaMax, f.stamina + r);
    }
    if (f.rocked > 0) f.rocked--;
    if (f.dazed > 0) f.dazed--;
    f.momentum *= 0.999;
    if (F.t - f.lastHitT > 150) f.unanswered = Math.max(0, f.unanswered - 0.02);
    const st = c.stamina;
    f.guard = F.t < f.guardDropUntil ? 0.2 : clamp(0.45 + 0.6 * st, 0, 1) * c.guard * (f.rocked > 0 ? 0.6 : 1);
  }
  // knockdown
  for (const f of F.fighters) {
    if (f.down > 0) {
      f.down--;
      const o = F.other(f);
      if (F.pounce && F.pounce.on === f && dist(F) < 0.8 * U) {
        const left = f.down;
        // el caído se hace bolita: a veces le toman la espalda (RNC del striker tras knockdown)
        const r = F.rng.float(0, 1);
        F.startGround(o, f, r < KD_BACK ? 'back' : r < 0.5 + KD_BACK / 2 ? 'half' : 'guard');
        f.dazed = left + 60;
        f.down = 0;
      } else if (f.down === 0) {
        F.pounce = null;
        f.rocked = Math.max(f.rocked, 90);
        f.nextDecision = F.t + 10;
        F.emit(FIGHT_EVENTS.GET_UP, { actor: f.id, attacker: f.id, defender: o.id, kind: 'knockdown' });
      }
    }
  }
  if (F.phase === 'ground') {
    const g = F.ground;
    F.stats[g.top.id].ctrl++; F.roundStat(g.top.id).ctrl++;
    if (!F.sub && F.t - g.lastActivity > F.opt.standupSeconds * TICK_RATE) {
      F.emit(X.BREAK, { actor: null, attacker: g.top.id, defender: g.bottom.id, reason: 'referee' });
      F.standUp(g.top, g.bottom, 1.1);
    }
  } else if (F.phase === 'clinch') {
    const cl = F.clinch;
    const cA = prowess(F.fighters[0], 'clinch'), cB = prowess(F.fighters[1], 'clinch');
    const dom = cl.underhook ?? (cA >= cB ? F.fighters[0] : F.fighters[1]); // el que ganó los underhooks controla
    F.roundStat(dom.id).ctrl += 0.4;
    if (F.t - cl.lastActivity > F.opt.clinchBreakSeconds * TICK_RATE || F.t - cl.since > 3 * F.opt.clinchBreakSeconds * TICK_RATE) {
      F.emit(X.BREAK, { actor: null, attacker: cl.init.id, defender: F.other(cl.init).id, reason: 'referee' });
      F.standUp(cl.init, F.other(cl.init), 1.1);
    }
  }
}

// ---------------------------------------------------------------------------
// Jueces: 10-point must por round.
function scoreRound(F) {
  const rs = F.roundStats[F.round - 1];
  const raw = (s, j) => s.dmg * j.wDmg + s.kd * 18 + s.td * 5 + s.adv * 3 + (s.ctrl / TICK_RATE) * 0.35 * j.wCtrl + s.subAtt * 3 + s.attempts * 0.05 * j.wAgg;
  // Desempate objetivo 10-10: daño, knockdowns, control, golpes conectados (sin RNG).
  const tieBreak = (sa, sb) => (sa.dmg - sb.dmg) + (sa.kd - sb.kd) * 14 + (sa.ctrl - sb.ctrl) / TICK_RATE * 0.45 + (sa.landed - sb.landed) * 0.2 + (sa.td - sb.td) * 4;
  const card = F.judges.map((j) => {
    const a = raw(rs.a, j), b = raw(rs.b, j);
    const diff = a - b + j.rng.gauss() * (1.5 + 0.06 * (a + b));
    if (Math.abs(diff) < 0.15) {
      const tb = tieBreak(rs.a, rs.b);
      if (Math.abs(tb) < 1e-9) return [10, 10]; // empate real (rarísimo)
      return tb > 0 ? [10, 9] : [9, 10];
    }
    const big = Math.abs(diff) > 30 + 0.5 * Math.min(a, b) || Math.abs(rs.a.kd - rs.b.kd) >= 2;
    return diff > 0 ? [10, big ? 8 : 9] : [big ? 8 : 9, 10];
  });
  F.cards.push(card);
  return card;
}

function decision(F) {
  const tot = [0, 1, 2].map((j) => F.cards.reduce((acc, c) => [acc[0] + c[j][0], acc[1] + c[j][1]], [0, 0]));
  let wa = 0, wb = 0, dr = 0;
  for (const [x, y] of tot) { if (x > y) wa++; else if (y > x) wb++; else dr++; }
  let winner = null, kind;
  if (wa === 3 || wb === 3) { winner = wa === 3 ? 'a' : 'b'; kind = 'UD'; }
  else if (wa === 2 || wb === 2) { winner = wa === 2 ? 'a' : 'b'; kind = dr ? 'MD' : 'SD'; }
  else {
    // Tarjetas empatadas: desempatar por daño/control/KD acumulados del fight (no forzar finish).
    const sum = (side) => F.roundStats.reduce((a, rs) => {
      const s = rs[side];
      return a + s.dmg + s.kd * 14 + s.ctrl / TICK_RATE * 0.45 + s.landed * 0.2 + s.td * 4;
    }, 0);
    const da = sum('a'), db = sum('b');
    if (Math.abs(da - db) < 1e-9) kind = 'DRAW';
    else { winner = da > db ? 'a' : 'b'; kind = 'SD'; }
  }
  F.emit(X.DECISION, { actor: winner, winner, kind, cards: tot });
  if (winner) F.finish(F.byId[winner], 'DEC', null, { reason: kind });
  else { F.finish(null, 'DRAW', null, { reason: 'DRAW' }); }
  F.result.cards = tot;
}

function endRound(F) {
  const card = scoreRound(F);
  F.emit(X.ROUND_END, { actor: null, round: F.round, cards: card });
  if (F.round >= F.opt.rounds) return decision(F);
  F.round++;
  F.roundT = 0;
  F.roundStats.push({ a: newRoundStat(), b: newRoundStat() });
  F.rest = Math.round(F.opt.restSeconds * TICK_RATE);
  F.phase = 'stand'; F.ground = null; F.clinch = null; F.sub = null; F.pounce = null;
  const [A, B] = F.fighters;
  F.geo.place(A, B, F.opt.startGap);
  for (const f of F.fighters) {
    f.action = null; f.queue.length = 0; f.rocked = 0; f.down = 0; f.dazed = 0; f.unanswered = 0; f.react = null;
    f.staminaMax = Math.max(40, f.staminaMax * 0.97);
    f.stamina = Math.min(f.staminaMax, f.stamina + (f.staminaMax - f.stamina) * 0.55 * f.attr.recovery);
    f.dmg.head *= 0.9;
    f.intent = { dir: 0, until: 0 };
  }
}

// ---------------------------------------------------------------------------
// Acción visible por tick (ACTIONS del contrato + propuestas: clinch, shoot, sprawl, groundTop, groundBottom, getUp, feint)
const PUNCH_L = new Set(['handL', 'elbowL']);
export function moveToAction(mv) {
  if (!mv) return ACTIONS.IDLE;
  if (mv.kind === 'takedown') return 'shoot';
  if (mv.phase === 'ground') return null;
  if (mv.kind === 'clinch') return 'clinch';
  if (mv.limb.startsWith('foot') || mv.limb.startsWith('knee')) return ACTIONS.KICK;
  return PUNCH_L.has(mv.limb) ? ACTIONS.JAB : ACTIONS.CROSS;
}

function displayAction(F, f) {
  if (F.done) {
    if (f.koed) return ACTIONS.KO;
    if (f.won) return ACTIONS.VICTORY;
    if (F.phase === 'ground') return F.ground.top === f ? 'groundTop' : 'groundBottom';
    return ACTIONS.IDLE;
  }
  if (F.rest > 0) return ACTIONS.IDLE;
  if (f.down > 0) return ACTIONS.KO; // knockdown (ver tick.a.down)
  if (F.sub && F.sub.A === f) return ACTIONS.SUB ?? 'sub'; // contrato v2: el que aplica la sumisión
  if (F.phase === 'ground') return F.ground.top === f ? 'groundTop' : 'groundBottom';
  if (f.react && F.t < f.react.until && (!f.action || f.action.t < 2)) return f.react.action;
  if (f.action) {
    if (f.action.feint) return 'feint';
    const a = moveToAction(MOVES[f.action.move]);
    if (a) return F.phase === 'clinch' && a === 'clinch' ? 'clinch' : a;
  }
  if (F.phase === 'clinch') return 'clinch';
  if (F.t < f.intent.until && f.intent.dir !== 0) return ACTIONS.WALK;
  return ACTIONS.GUARD;
}

// Reacciones visibles: se anotan al emitir el evento (HIT/BLOCK/DODGE/PARRY/CHECK/SPRAWL/GET_UP).
const REACT_CLIP = { [ACTIONS.BLOCK]: 'block', [ACTIONS.DODGE]: 'slip', [ACTIONS.HIT]: 'hitHead', sprawl: 'block', getUp: 'getUp' };
const HIT_CLIP = { head: 'hitHead', body: 'hitBody', legs: 'hitLegs' };
function noteReaction(F, ev) {
  const def = ev.defender != null ? F.fighters.find((f) => f.id === ev.defender) : null;
  switch (ev.type) {
    case FIGHT_EVENTS.HIT: if (def) F.react(def, ACTIONS.HIT, 16, HIT_CLIP[ev.target] ?? 'hitHead'); break;
    case FIGHT_EVENTS.BLOCK: case X.PARRY: case X.CHECK: if (def) F.react(def, ACTIONS.BLOCK, 12); break;
    case FIGHT_EVENTS.DODGE: if (def) F.react(def, ACTIONS.DODGE, 14); break;
    case X.SPRAWL: if (def && F.phase === 'stand') F.react(def, ACTIONS.SPRAWL ?? 'sprawl', 20); break;
    case FIGHT_EVENTS.GET_UP: { const a = F.fighters.find((f) => f.id === ev.actor); if (a) F.react(a, ACTIONS.GET_UP ?? 'getUp', 40); break; }
    default:
  }
}

/**
 * Clip exacto de src/anim para este tick (extra no contractual: tick.a.animClip). Sale de la acción visible y del
 * movimiento en curso: idle, guard, walk, shuffleBack, jab, cross, hook, uppercut, lowKick, highKick, knee, elbow,
 * block, slip, hitHead, hitBody, hitLegs, shoot, takenDown, ko, getUp, victory. tick.a.animSeq cambia en cada
 * one-shot nuevo (re-disparar el mismo clip, p. ej. jab-jab).
 */
function animClipOf(F, f, action) {
  switch (action) {
    case ACTIONS.KO: return 'ko';
    case ACTIONS.VICTORY: return 'victory';
    case ACTIONS.IDLE: return 'idle';
    case ACTIONS.WALK: return footClip(F, f);
    case 'groundBottom': return 'takenDown';
    case 'groundTop': { const mv = f.action && MOVES[f.action.move]; return mv && mv.kind === 'strike' && mv.clip ? mv.clip : 'guard'; }
    case 'sub': return F.ground && F.ground.bottom === f ? 'takenDown' : 'guard';
    default:
  }
  if (f.react && F.t < f.react.until && action === f.react.action) return f.react.clip;
  if (f.action) {
    if (f.action.feint) return 'feint';
    const id = f.action.move;
    if (id === 'clinchEntry') return 'clinchEntry';
    if (id === 'clinchKnee' || id === 'clinchKneeHead') return 'clinchKnee';
    if (id === 'clinchElbow') return 'clinchElbow';
    return f.action.clip ?? MOVES[id]?.clip ?? 'guard';
  }
  if (F.phase === 'clinch') return F.clinch && F.t - F.clinch.since < CLINCH_HOOK_TICKS && F.clinch.underhook === f ? 'clinchUnderhook' : 'clinchTie';
  return 'guard';
}

// Clip de desplazamiento: advance -> walk; retreat/exit -> shuffleBack; el resto, el nombre del paso (stepIn, stepOut, pivot, circle, cutAngle).
const CLINCH_HOOK_TICKS = 30;
const CIRCLE_RATE = 1.6, PIVOT_ANGLE = Math.PI / 3;   // rad/s (continuo) y rad (oneShot) para src/anim
function footKind(F, f) {
  if (f.foot && F.t < f.foot.until) return f.foot.kind;
  if (f.circleUntil >= F.t && f.intent.dir < 0) return 'circle';
  return null;
}
function footClip(F, f) {
  const k = footKind(F, f);
  if (k === 'stepIn' || k === 'stepOut' || k === 'pivot' || k === 'cutAngle' || k === 'circle') return k;
  return f.intent.dir < 0 ? 'shuffleBack' : 'walk';
}
const ONE_SHOT_CLIPS = new Set(['jabJab', 'jabJabCross', 'stepJabJab', 'stepIn', 'stepOut', 'pivot', 'feint', 'clinchEntry', 'clinchKnee', 'clinchElbow', 'jab', 'cross', 'hook', 'uppercut', 'lowKick', 'highKick', 'knee', 'elbow', 'shoot', 'slip', 'block', 'sprawl']);
/**
 * Intención de animación (extra: tick.a.intent) = clip + modo. oneShot: se dispara una vez con cada animSeq nuevo y
 * corre hasta terminar (golpes, feint, stepIn/stepOut, pivot, clinchEntry/Knee/Elbow). continuous: dura mientras el
 * tick lo siga reportando (walk, shuffleBack, circle, cutAngle, clinchTie, clinchUnderhook, guard). feint trae variant.
 */
/** Largo del paso (px, con signo: + hacia el rival) por defecto de los clips de entrada/salida. Coincide con lo que lee Animador (intent.dist). */
const STEP_DIST = Object.freeze({ stepIn: 20, stepOut: -20, clinchEntry: 18 });
function intentOf(F, f, clip) {
  if (clip === 'idle' || clip === 'guard' || clip === 'ko' || clip === 'victory') return null;
  const i = { name: clip, mode: ONE_SHOT_CLIPS.has(clip) ? 'oneShot' : 'continuous' };
  if (clip === 'feint') i.variant = f.action.variant;
  const d = STEP_DIST[clip]; if (d != null) i.dist = d;
  return i;
}
// Órbita (sólo animación; x sigue 1D): circle continuo con rate firmado rad/s; pivot oneShot con ángulo objetivo. dir +1 = hacia su mano izquierda
// (lejos de la mano de poder de un rival ortodoxo), -1 al otro lado.
function orbitOf(F, f, clip) {
  if (clip === 'circle') { const d = f.foot && F.t < f.foot.until && f.foot.kind === 'circle' ? f.foot.dir : f.circleDir ?? 1; return { mode: 'continuous', rate: r2(d * CIRCLE_RATE), target: 0, dir: d }; }
  if (clip === 'pivot') { const d = f.foot?.dir ?? 1; return { mode: 'oneShot', rate: 0, target: r2(d * PIVOT_ANGLE), dir: d }; }
  return null;
}

const r2 = (v) => Math.round(v * 100) / 100;
function hpOf(f) {
  const a = f.attr;
  const lost = 0.6 * (f.dmg.head / a.headCap) + 0.25 * (f.dmg.body / a.bodyCap) + 0.15 * (f.dmg.legs / a.legsCap);
  return f.koed ? 0 : Math.max(0, Math.round((1 - lost) * 1000) / 10);
}
function tickState(F, f) {
  const act = F.forDisplay(f);
  if (act !== f.disp.action) f.disp = { action: act, since: F.t };
  const g = F.ground;
  const clip = animClipOf(F, f, act);
  const intent = intentOf(F, f, clip), fk = footKind(F, f);
  const dmgN = damageOf(f);
  const r3 = (v) => Math.round(clamp(v, 0, 1) * 1000) / 1000;
  const tk = {
    x: r2(F.geo.axisX(f)), hp: hpOf(f), maxHp: 100, stamina: r2(clamp(f.stamina / f.attr.staminaMax, 0, 1)),
    action: act, actionT: r2((F.t - f.disp.since) / TICK_RATE), facing: F.geo.facingSign(f),
    animClip: clip, animSeq: f.animSeq, intent, orbit: orbitOf(F, f, clip),
    foot: fk, variant: intent?.variant ?? null, dist: intent?.dist ?? 0,
    // A1: estocada prevista (px hacia facing) y paso de este tick; root ≈ quieto en fase activa del golpe
    lunge: f.action ? r2(f.action.lungeTotal ?? 0) : 0,
    step: f.action ? r2(f.action.stepThis ?? 0) : 0,
    // extras (no contractuales) para Animador/Render/HUD
    move: f.action ? f.action.move : null,
    movePhase: f.action ? (f.action.t < f.action.startup ? 'startup' : f.action.t < f.action.startup + f.action.active ? 'active' : 'recovery') : null,
    moveT: f.action ? f.action.t : 0,
    phase: F.phase, groundPos: g ? g.pos : null, groundRole: g ? (g.top === f ? 'top' : 'bottom') : null,
    guard: r2(f.guard), rocked: f.rocked > 0, down: f.down > 0, momentum: r2(f.momentum),
    // compat: dmg 3 zonas (histórico)
    dmg: { head: r2(dmgN.head), body: r2(dmgN.body), legs: r2(dmgN.legs) },
    // B1 Arte: daño 5 zonas 0..1, lesiones, cortes faciales, fatiga, progreso de sumisión
    damage: { head: r3(dmgN.head), body: r3(dmgN.body), legs: r3(dmgN.legs), armL: r3(dmgN.armL), armR: r3(dmgN.armR) },
    marks: { ...(f.marks || {}) },
    injuries: { ...(f.injuries || {}) },
    cutHead: r3(f.cutHead ?? 0), nose: r3(f.nose ?? 0), eye: r3(f.eye ?? 0),
    fatigue: r3(fatigueOf(f)),
    subProgress: F.sub && (F.sub.A === f || F.sub.B === f) ? r3(clamp(F.sub.progress, 0, 1)) : null,
    sub: F.sub ? (F.sub.A === f ? 'attacking' : F.sub.B === f ? 'defending' : null) : null,
  };
  const ex = F.geo.tickExtras(f); // 2D: null (no cambia la forma del objeto); 3D: { pos, heading }
  if (ex) Object.assign(tk, ex);
  return tk;
}

// ---------------------------------------------------------------------------
export function stepCore(F) {
  F.out = [];
  if (F.done) {
    F.t++;
    return { tick: { tick: F.t - 1, a: tickState(F, F.fighters[0]), b: tickState(F, F.fighters[1]), round: F.round, phase: 'over' }, events: F.out };
  }
  if (F.t === 0) { F.emit(X.ROUND_START, { actor: null, round: 1 }); studyPhase(F); }
  if (F.rest > 0) {
    F.rest--;
    for (const f of F.fighters) f.stamina = Math.min(f.staminaMax, f.stamina + f.attr.regen * 2);
    if (F.rest === 0) { F.emit(X.ROUND_START, { actor: null, round: F.round }); studyPhase(F); }
  } else {
    tickUpkeep(F);
    if (F.sub) updateSub(F);
    else if (!F.done) {
      const order = F.t & 1 ? [1, 0] : [0, 1];
      for (const f of F.fighters) {
        const ctl = F.controllers[f.id];
        if (!ctl.poll) continue;
        const it = ctl.poll(F, f);
        if (!F.lastInput[f.id] || !sameIntent(F.lastInput[f.id], it)) { F.inputs.push({ t: F.t, side: f.id, intent: it }); F.lastInput[f.id] = it; }
      }
      for (const i of order) {
        const f = F.fighters[i], o = F.fighters[1 - i];
        if (F.done || F.sub) break;
        if (f.action || f.down > 0 || o.down > 0 || F.t < f.nextDecision) continue;
        if (F.phase === 'ground' && f.dazed > 0 && F.ground.bottom === f) continue;
        applyDecision(F, f, o, F.controllers[f.id].decide(F, f, o));
      }
      for (const i of order) { if (F.done || F.sub) break; advanceAction(F, F.fighters[i]); }
      if (!F.done && (F.phase === 'stand')) moveFighters(F);
    }
    for (const f of F.fighters) if (f.stamina < 0 || !Number.isFinite(f.stamina)) f.stamina = 0;
    if (!F.done) {
      F.roundT++;
      if (F.roundT >= F.roundTicks) endRound(F);
    }
    if (!F.done && F.t >= F.opt.maxTicks) F.finish(null, 'DRAW', null, { reason: 'maxTicks' });
  }
  const tick = { tick: F.t, a: tickState(F, F.fighters[0]), b: tickState(F, F.fighters[1]), round: F.round, roundT: F.roundT, phase: F.rest > 0 ? 'rest' : F.phase };
  F.t++;
  return { tick, events: F.out };
}

/**
 * Corre la pelea completa. tailSeconds: ticks extra tras el final (para animar KO/victoria).
 * Devuelve un FightResult del contrato + extras: method ('KO'|'TKO'|'SUB'|'DEC'|'DRAW'), detail, result, stats.
 *   reason (contrato): 'ko' para KO/TKO/SUB, 'decision' para DEC, 'draw' para DRAW.
 */
export function runCore(a, b, seed = 1, options = {}) {
  const F = createFightCore(a, b, seed, options);
  const ticks = [];
  const keepTicks = options.keepTicks !== false;
  const tail = Math.round((options.tailSeconds ?? 2) * TICK_RATE);
  while (!F.done || F.t <= F.endT + tail) {
    const { tick } = stepCore(F);
    if (keepTicks) ticks.push(tick);
    if (F.t > F.opt.maxTicks + tail + 10) break;
  }
  const r = F.result;
  const reason = r.method === 'DEC' ? 'decision' : r.method === 'DRAW' ? 'draw' : 'ko';
  return { seed, tickRate: TICK_RATE, ticks, events: F.events, winner: r.winner, reason, method: r.method, detail: r.detail, result: r, stats: F.stats, inputs: F.inputs, phaseTicks: F.phaseTicks, cards: F.cards, pro: F.pro, fighters: { a: F.fighters[0].profile, b: F.fighters[1].profile } };
}
