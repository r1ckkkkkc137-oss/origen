// Resolución de acciones: golpes, defensas, derribos, suelo, sumisiones, KO.
// Funciones puras sobre el estado de pelea (F) + el RNG de la pelea. Sin Math.random.
import { MOVES, NEXT_POSITION, POSITION_VALUE, PX_PER_M as U } from '../data/moves.js';
import { moveArea } from '../data/styles.js';
import { condition, escalateMark, damageOf } from './fighter.js';
import { FIGHT_EVENTS, FIGHT_EVENTS_EXT as X } from './events.js';


/** Técnicas expertas (moves.expert): disponibles desde nivel 10 (profile.level o media de stats). */
export function fighterLevel(f) {
  if (f.profile?.level != null) return f.profile.level;
  const s = f.stats || f.profile?.stats;
  if (!s) return 1;
  return (s.fuerza + s.velocidad + s.tecnica + s.resistencia) / 4;
}
export function canUseMove(f, moveOrId) {
  const mv = typeof moveOrId === 'string' ? MOVES[moveOrId] : moveOrId;
  if (!mv) return false;
  if (mv.expert && fighterLevel(f) < 10) return false;
  return true;
}


/** Zona de bloqueo para Animador (blockHigh/blockBody): siempre head|body|legs. */
export function strikeTarget(move) {
  const z = move?.zone;
  return z === 'body' || z === 'legs' || z === 'head' ? z : 'head';
}

/** Zona precisa del KO para Animador: jaw|temple|body|legs (y variantes de TKO). */
export function koZoneOf(move, reason = null) {
  if (reason === 'legs' || reason === 'legsGone') return 'legs';
  if (reason === 'body') return 'body';
  if (reason === 'doctor') return 'jaw';
  const z = move?.zone ?? (typeof move === 'string' ? null : null);
  const mv = typeof move === 'string' ? MOVES[move] : move;
  const zone = mv?.zone ?? z;
  if (zone === 'legs') return 'legs';
  if (zone === 'body') return 'body';
  // cabeza: arco/limb -> jaw | temple
  const arc = mv?.arc;
  if (arc === 'hook' || arc === 'spin' || arc === 'over') return 'temple';
  if (arc === 'upper' || arc === 'knee') return 'jaw';
  if (mv?.limb && String(mv.limb).startsWith('elbow')) return 'temple';
  return 'jaw';
}

export const sig = (x) => 1 / (1 + Math.exp(-x));
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/**
 * Ventaja RELATIVA a vs b (grappling): REL_K·ln(a/b). Escala igual con stats 10 que con 85 (un 20% mejor es un 20%
 * mejor a cualquier nivel); REL_K ≈ prowess típica, así que a nivel medio equivale a la vieja diferencia a-b.
 */
export const REL_K = 0.6;
export const rel = (a, b) => REL_K * Math.log(Math.max(1e-3, a) / Math.max(1e-3, b));
/** Soft-cap de ventaja de sumisión (rel). Sin techo, lucha disparada (T12 vs rival flojo)
 *  hace que casi todo lock termine en tap. Edges chicos (mirrors / estilos parejos) pasan lineales. */
export const SUB_EDGE_LIN = 0.09; // lineal hasta aquí
export const SUB_EDGE_SOFT = 0.11; // tanh extra sobre el exceso
export function softSubEdge(edge) {
  const a = Math.abs(edge), s = Math.sign(edge) || 1;
  if (a <= SUB_EDGE_LIN) return edge;
  return s * (SUB_EDGE_LIN + Math.tanh((a - SUB_EDGE_LIN) / SUB_EDGE_SOFT) * SUB_EDGE_SOFT);
}
export const skill = (f, area) => f.style.skill[area] ?? 1;
const n = (f, k) => f.stats[k] / 100;

// Habilidad efectiva en un área (0..~1.4): stat relevante + técnica, por afinidad de estilo.
export function prowess(f, area, exOverride = null) {
  const tec = n(f, 'tecnica');
  let base;
  if (area === 'wrestling') base = 0.65 * n(f, 'lucha') + 0.2 * tec + 0.15 * n(f, 'fuerza');
  else if (area === 'ground' || area === 'subs') base = 0.6 * n(f, 'lucha') + 0.4 * tec;
  else if (area === 'clinch') base = 0.4 * n(f, 'lucha') + 0.3 * tec + 0.3 * n(f, 'fuerza');
  else base = 0.65 * tec + 0.35 * n(f, 'velocidad');
  // Exponente < 1 comprime los multiplicadores de estilo (más en grappling, donde también influye 'lucha').
  const ex = exOverride ?? (area === 'wrestling' || area === 'ground' || area === 'subs' ? 0.45 : 0.6);
  return (0.3 + 0.7 * base) * Math.pow(skill(f, area), ex);
}

/** Ventana de alcance del movimiento según la geometría (3D: data/reach3d.js; 2D: la de moves.js). */
export const rw = (F, mv) => (F.reach && mv && F.reach[mv.id]) || mv;
export const dist = (F) => F.geo.distance(F.fighters[0], F.fighters[1]);
/** Holgura (px) sobre la ventana de alcance del clip al resolver: la sim mide entre anclas, el dibujo interpola. */
export const REACH_SLACK = 0; // la tolerancia ya está en la ventana (REACH_TOL de moves.js)
const KB_TICKS = 6;
/** Golpes cortos (uppercut, codo, rodilla de pie): sólo a corta distancia, sin crédito de estocada ni paso largo. */
export const SHORT_STEP_PX = 12;
export const STEP_BACK_PX = 10;
/** Estocada/paso previsto (px) → tick.lunge. jab/cross 0.25·U; hook 0.12·U; short SHORT_STEP_PX; kicks 0.18·U; knee 0.12·U; clinch 0. */
export function stepInReach(mv) {
  if (mv.phase === 'clinch') return 0;
  if (mv.lunge != null) return 0.25 * U + mv.lunge;
  if (mv.short) return SHORT_STEP_PX;
  const c = mv.clip;
  if (c === 'jab' || c === 'cross') return 0.25 * U;
  if (c === 'hook') return 0.12 * U;
  if (c === 'lowKick' || c === 'highKick') return 0.18 * U;
  if (c === 'knee') return 0.12 * U;
  if (c === 'shoot') return 0.25 * U;
  return 0.25 * U;
}
export const stepInPerTick = (mv, startup) => stepInReach(mv) / Math.max(1, startup);
/** ¿Puede este golpe impactar dentro de su ventana desde la distancia d? (paso adentro / atrás del startup incluidos) */
/** Igual que inStrikeWindow y además alcanzable de pie sin bajar de minGap. */
export const reachable = (F, mv, d) => { mv = rw(F, mv); return inStrikeWindow(mv, d) && (F.phase !== 'stand' || mv.rangeMax == null || mv.rangeMax >= F.opt.minGap); };
/** 3D: golpes cortos (hook/uppercut/codo) sueltos sólo DENTRO de su ventana, sin crédito de paso; encadenados tras jab/cross
 *  (chained) o contra un rival que entra sí usan el paso del startup. En 2D (F.reach null) = reachable de KAGE. */
export const CLOSE_ONLY = new Set(['hook', 'bodyHook', 'uppercut', 'standElbow']);
export const reachableAI = (F, mv, d, chained = false, self = null) => {
  if (!F.reach || !CLOSE_ONLY.has(mv.id) || F.phase !== 'stand') return reachable(F, mv, d);
  if (chained) { // encadenado: vale el paso, salvo que el rival se esté yendo (ahí se tira al aire)
    const o = self && F.fighters.find((x) => x !== self);
    const leaving = o && !o.action && (o.intent?.dir ?? 0) < 0 && F.t < (o.intent?.until ?? 0);
    const kb = o && o.slide && o.slide.n > 0 ? Math.abs(o.slide.v) * o.slide.n : 0; // el knockback del golpe anterior lo aleja
    const dp = d + kb;
    return reachable(F, mv, dp) && (!leaving || dp <= rw(F, mv).rangeIdeal);
  }
  const w = rw(F, mv);
  return reachable(F, mv, d) && d <= w.rangeMax;
};
export const inStrikeWindow = (mv, d) => d <= mv.rangeMax + (mv.short ? SHORT_STEP_PX : stepInReach(mv)) && d >= mv.rangeMin - STEP_BACK_PX * 0.6;
export const cornered = (F, f) => F.geo.cornered(f, 0.15 * U);

// Hitstop sugerido (ticks de congelado para render). Tunable vía F.opt.hitstop.
export function hitstopFor(F, dmg, extra = 0) {
  const h = F.opt.hitstop;
  return clamp(Math.round(h.base + dmg * h.perDamage + extra), h.min, h.max);
}
const powerNorm = (dmg) => Math.round(clamp(dmg / 16, 0, 1) * 1000) / 1000;
const r3 = (v) => Math.round(v * 1000) / 1000;

function baseEvent(A, B, move) {
  return { attacker: A.id, defender: B.id, limb: move.limb, target: move.zone, move: move.id, angle: move.angle, arc: move.arc };
}

// Defensa por controlador del lado (options.controllers): el humano decide si lee y cómo defiende.
const ctlOf = (F, f) => F.controllers?.[f.id];
function ctlReadP(F, B, A, move, p) {
  const c = ctlOf(F, B);
  return c?.readP ? clamp(c.readP(F, B, A, move, p), 0, 1) : p;
}
function ctlDefense(F, B, A, move) {
  const c = ctlOf(F, B);
  return (c?.chooseDefense ?? F.ai.chooseDefense)(F, B, A, move);
}

// ---------- Golpes ----------
export function resolveStrike(F, A, B, act) {
  const move = MOVES[act.move];
  const rng = F.rng;
  const cA = condition(A), cB = condition(B);
  const area = moveArea(move);
  const st = F.stats[A.id];
  st.thrown[move.id] = (st.thrown[move.id] || 0) + 1;
  const ground = F.phase === 'ground';
  const clinch = F.phase === 'clinch';
  const d = dist(F);

  // De pie la distancia del tick de impacto tiene que caer en la ventana del clip: si no, whiff.
  if (!ground && !clinch) F.impactT = F.t;
  const outKind = ground || clinch ? null : d > rw(F, move).rangeMax + REACH_SLACK ? 'short' : d < rw(F, move).rangeMin - REACH_SLACK ? 'jammed' : null;
  if (outKind) {
    F.emit(X.WHIFF, { ...baseEvent(A, B, move), kind: outKind, power: 0, hitstop: 0 });
    act.recovery = Math.round(act.recovery * 1.15);
    F.ai.observe(F, B, { kind: 'whiff', by: A, move });
    return 'miss';
  }

  // Estado del defensor
  const bAct = B.action;
  const bInStartup = bAct && bAct.t < bAct.startup + bAct.active && !bAct.feint;
  const bInRecovery = bAct && bAct.t >= bAct.startup + bAct.active;
  const counterMul = bInStartup ? 1.25 : bInRecovery ? 1.12 : 1;
  const busy = !!bAct || B.rocked > 0 || B.down > 0 || B.dazed > 0 || F.t < B.feintBit;
  const startup = act.startup;
  let readBonus = F.ai.readBonus(F, B, A, move);
  if (F.t < B.counterReady) readBonus += 0.35;
  const reactT = B.attr.reaction * cB.speed;
  let readP = busy ? 0 : sig((startup + 14 * move.telegraph - reactT) / 3.2 + readBonus * 2);
  if (clinch) readP *= 0.6;
  if (ground) readP *= 0.5;
  if (act.counter) readP *= 0.35; // el contra llega cuando el otro aún está recuperando
  readP = ctlReadP(F, B, A, move, readP);

  // ¿Va al blanco?
  let acc = move.accuracy * A.attr.accuracy * cA.accuracy * Math.pow(skill(A, area), 0.6);
  if (act.afterFeint) acc *= 1.12;
  if (B.rocked > 0 || B.dazed > 0) acc *= 1.3;
  const guardDropped = F.t < B.guardDropUntil;
  if (guardDropped && move.zone === 'head') acc *= 1.2;
  if (bInStartup) acc *= 1.08;
  // El pateador de distancia (style.rangeKick) pivota y sale tras la patada: menos expuesto en la recuperación.
  if (bInRecovery && !ground && !clinch && moveArea(MOVES[bAct.move]) === 'kick') acc *= 1 - 0.3 * (B.style.rangeKick ?? 0);
  acc = clamp(acc, 0.05, 0.95);
  const ev0 = baseEvent(A, B, move);
  if (!rng.chance(acc)) {
    F.emit(X.WHIFF, { ...ev0, kind: 'miss', power: 0, hitstop: 0 });
    act.recovery = Math.round(act.recovery * 1.2);
    F.ai.observe(F, B, { kind: 'whiff', by: A, move });
    F.ai.observe(F, A, { kind: 'result', move, res: 'miss' });
    return 'miss';
  }

  let powerMul = 1;
  let defended = null;
  if (rng.chance(readP)) {
    const choice = ctlDefense(F, B, A, move);
    const defSk = cB.defense * skill(B, 'defense');
    const tecB = n(B, 'tecnica');
    let pOk = 0;
    if (choice === 'slip') pOk = (0.22 + 0.4 * tecB * skill(B, 'headMovement')) * cB.defense - 0.15 * (move.accuracy - 0.5);
    else if (choice === 'parry') pOk = (0.3 + 0.45 * tecB) * defSk;
    else if (choice === 'block') pOk = (move.zone === 'legs' ? 0 : 0.6 + 0.2 * tecB) * defSk * (move.arc === 'hook' && move.zone === 'head' ? 0.85 : 1);
    else if (choice === 'step') pOk = cornered(F, B) ? 0.05 : (0.35 + 0.3 * n(B, 'velocidad')) * cB.mobility * (rw(F, move).rangeMax > 1.2 * U ? 0.8 : 1) * Math.sqrt(skill(B, 'headMovement'));
    else if (choice === 'check') pOk = (0.4 + 0.35 * tecB) * Math.pow(skill(B, 'kick'), 1.6) * cB.defense; // chequear es técnica de pateador
    else if (choice === 'catch') pOk = (move.catchable ?? 0) * (0.6 + 0.8 * n(B, 'lucha')) * cB.defense * 1.6 * (1 - 0.4 * (A.style.rangeKick ?? 0));
    pOk = clamp(pOk, 0, 0.92);
    if (rng.chance(pOk)) defended = choice;
    else powerMul = 0.85; // la defensa falló pero algo amortiguó
  } else if (!clinch && !ground && move.zone === 'head' && !bInStartup && !(B.rocked > 0)) {
    // Guardia pasiva
    const pBlock = 0.2 * B.guard * skill(B, 'defense') * cB.defense * (guardDropped ? 0.2 : 1);
    if (rng.chance(pBlock)) defended = 'block';
  } else if ((clinch || ground) && !busy) {
    const pBlock = (ground ? F.ai.groundCover(F, B) : 0.22) * cB.defense;
    if (rng.chance(pBlock)) defended = 'block';
  }

  if (defended) {
    F.ai.observe(F, A, { kind: 'result', move, res: defended });
    F.ai.observe(F, B, { kind: 'defended', by: A, move, res: defended });
    B.unanswered = Math.max(0, B.unanswered - 1);
    st.defended = (st.defended || 0) + 1;
    if (defended === 'block') {
      const chip = move.damage * A.attr.power * 0.18;
      B.dmg[move.zone] += chip;
      // B1 Arte: el bloqueo carga los brazos (brazo adelantado = armR si facing>0)
      const armKey = F.geo.facingSign(B) >= 0 ? 'armR' : 'armL';
      B.dmg[armKey] = (B.dmg[armKey] ?? 0) + chip * 0.85;
      escalateMark(B, armKey, (B.dmg[armKey] ?? 0) / (B.attr.armCap || 100));
      B.stamina = Math.max(0, B.stamina - move.damage * 0.25);
      F.emit(FIGHT_EVENTS.BLOCK, { ...ev0, target: strikeTarget(move), power: powerNorm(chip * 2), damage: r3(chip), hitstop: hitstopFor(F, chip, 1) });
    } else if (defended === 'parry') {
      act.recovery += 4;
      F.emit(X.PARRY, { ...ev0, target: strikeTarget(move), power: 0.1, hitstop: F.opt.hitstop.parry });
    } else if (defended === 'check') {
      // la canilla del que pateó sufre
      const back = move.damage * 0.55 * (0.6 + 0.6 * n(B, 'resistencia')) * Math.min(1.2, skill(B, 'kick'));
      A.dmg.legs += back;
      act.recovery += 6;
      F.emit(X.CHECK, { ...ev0, power: powerNorm(back), damage: r3(back), hitstop: hitstopFor(F, back, 2) });
    } else if (defended === 'catch') {
      act.recovery += 14;
      F.emit(X.CATCH, { ...ev0, power: 0.2, hitstop: 4 });
      F.onCatch(B, A);
      return 'caught';
    } else {
      F.emit(FIGHT_EVENTS.DODGE, { ...ev0, kind: defended, power: 0, hitstop: 0 });
      act.recovery = Math.round(act.recovery * 1.1);
    }
    F.maybeCounter(B, A, defended);
    return defended;
  }

  // ---------- Impacta ----------
  let posMul = 1;
  if (ground) posMul = F.ai.groundPowerMul(F, A);
  const dmg = move.damage * A.attr.power * cA.power * Math.sqrt(skill(A, area)) * counterMul * powerMul * posMul * rng.float(0.8, 1.2);
  const scaled = dmg * F.opt.damageScale * (move.zone === 'head' ? 1 : F.opt.limbDamageMul);
  B.dmg[move.zone] += scaled;
  // B1 Arte: cortes faciales (cutHead/nose/eye). Cosméticos: B.cut (doctor/TKO) no escala con VIS.
  // Golpes limpios a cabeza → en R3 duro cutHead ~0.3–0.6; jab-fests quedan bajas.
  if (move.cut && move.zone === 'head') {
    const elbow = move.clip === 'elbow' ? 2.35 : 1;
    const clean = (counterMul > 1.05 ? 1.35 : 1) * (dmg > 14 ? 1.2 : dmg > 9 ? 1 : 0.4);
    const cutAdd = move.cut * dmg * F.opt.damageScale / 16 * elbow * clean * rng.float(0.3, 1.4);
    B.cut += cutAdd; // doctor stoppage: tasa previa (no sube con VIS)
    const VIS = 1.45; // solo cutHead/nose/eye (render)
    const vis = cutAdd * VIS;
    B.cutHead = clamp((B.cutHead ?? 0) + vis * 0.9, 0, 1.5);
    const r = rng.next();
    if (r < 0.32) B.nose = clamp((B.nose ?? 0) + vis * 0.75, 0, 1.5);
    else if (r < 0.72) {
      B.eye = clamp((B.eye ?? 0) + vis * 0.85, 0, 1.5);
      escalateMark(B, 'head', Math.max(B.dmg.head / Math.max(1e-6, B.attr.headCap), (B.eye ?? 0) * 0.9));
    } else {
      B.nose = clamp((B.nose ?? 0) + vis * 0.35, 0, 1.5);
      B.eye = clamp((B.eye ?? 0) + vis * 0.4, 0, 1.5);
    }
  }
  {
    const cap = move.zone === 'head' ? B.attr.headCap : move.zone === 'body' ? B.attr.bodyCap : B.attr.legsCap;
    escalateMark(B, move.zone, B.dmg[move.zone] / Math.max(1e-6, cap));
  }
  if (move.zone === 'body') B.stamina = Math.max(0, B.stamina - dmg * 0.9);
  else B.stamina = Math.max(0, B.stamina - dmg * 0.25);
  if (move.zone === 'legs') B.staminaMax = Math.max(40, B.staminaMax - dmg * 0.1);
  A.momentum = clamp(A.momentum + dmg / 45, -1, 1);
  B.momentum = clamp(B.momentum - dmg / 60, -1, 1);
  A.unanswered = 0;
  B.unanswered += dmg > 4 ? 1 : 0.5;
  B.lastHitT = F.t;
  st.landed[move.id] = (st.landed[move.id] || 0) + 1;
  F.roundStat(A.id).dmg += dmg * (move.zone === 'head' ? 1 : move.zone === 'body' ? 0.9 : 0.8);
  F.roundStat(A.id).landed += 1;
  if (ground) F.ground.lastActivity = F.t;
  if (move.knockback && !ground && !clinch) {
    const kb = move.knockback * (0.6 + 0.4 * A.attr.power);
    B.slide = { v: kb / KB_TICKS, n: KB_TICKS }; // se aplica en los ticks siguientes: el frame de impacto muestra el contacto
  }
  F.ai.observe(F, A, { kind: 'result', move, res: 'hit', dmg });
  F.ai.observe(F, B, { kind: 'hitBy', by: A, move, dmg });

  const hitEv = { ...ev0, power: powerNorm(dmg), damage: r3(dmg), hitstop: hitstopFor(F, dmg), counter: counterMul > 1 };
  // B1 Arte: HIT opcionalmente lleva injury si ya hay lesión en zona relacionada
  if (B.injuries && Object.keys(B.injuries).length) {
    const map = { head: ['eyeL', 'eyeR', 'nose'], body: ['ribs'], legs: ['kneeL', 'kneeR'], armL: ['elbowL', 'shoulderL'], armR: ['elbowR', 'shoulderR'] };
    const keys = map[move.zone] || [];
    for (const k of keys) {
      if (B.injuries[k]) { hitEv.injury = { part: k, kind: B.injuries[k] }; break; }
    }
  }
  F.emit(FIGHT_EVENTS.HIT, hitEv);
  // si B estaba lanzando algo y lo pescaron, se interrumpe
  if (B.action && !B.action.resolved && dmg > 5) { B.action = null; B.queue.length = 0; }
  checkDamage(F, A, B, move, dmg, counterMul);
  return 'hit';
}


/** Emite KO/TKO con koZone+move y anota koZone en el HIT que lo causó. */
function finishKo(F, A, B, move, method, reason) {
  const koZone = koZoneOf(move, reason);
  // el HIT acaba de emitirse: etiquetar la zona precisa del golpe final
  if (F.out) {
    for (let i = F.out.length - 1; i >= 0; i--) {
      const e = F.out[i];
      if (e.type === FIGHT_EVENTS.HIT && e.attacker === A.id && e.defender === B.id && e.move === move.id) {
        e.koZone = koZone;
        break;
      }
    }
  }
  return F.finish(A, method, move.id, { reason, koZone });
}

// Consecuencias del daño: flash KO, knockdown, aturdido, TKO por acumulación o paro del árbitro.
// Patadas: multiplicadores de finalización sobre el daño acumulado.
const HK_LEGS = 1.2, HK_BODY = 0.8, BK_FOLD = 3, LG_MIN = 0.5, LG_P = 1.0;
export function checkDamage(F, A, B, move, dmg, counterMul = 1) {
  if (F.done) return;
  const rng = F.rng;
  const a = B.attr;
  const headR = B.dmg.head / a.headCap;
  const bodyR = B.dmg.body / a.bodyCap;
  const legsR = B.dmg.legs / a.legsCap;
  const ground = F.phase === 'ground';
  if (move.zone === 'head') {
    let ko = dmg * move.ko * (0.35 + 1.5 * Math.pow(headR, 1.4)) / a.chin;
    ko *= F.opt.koScale;
    if (B.rocked > 0 || B.dazed > 0) ko *= 1.7;
    if (counterMul > 1) ko *= 1.15;
    // Patada a la cabeza sobre un rival lento (piernas/cuerpo dañados): no la ve venir ni puede salir.
    if (!ground && moveArea(move) === 'kick') ko *= 1 + HK_LEGS * Math.sqrt(Math.min(1, legsR)) + HK_BODY * Math.min(1, bodyR);
    // Sien (hook/highKick/over/elbow): golpes limpios a temple un poco más KO-aptos; jaw sin cambio.
    if (koZoneOf(move) === 'temple') {
      // limpio (counter / golpe fuerte hook·highKick·elbow): más chance de koTemple sin inflar KO total
      const cleanT = counterMul > 1.05 || dmg > 11;
      ko *= cleanT ? 1.22 : 1.0;
    }
    const pKO = 1 - Math.exp(-ko * 0.004);
    const pKD = ground ? 0 : 1 - Math.exp(-ko * 0.014);
    const pRock = 1 - Math.exp(-ko * (ground ? 0.03 : 0.05));
    const r = rng.next();
    if (r < pKO) return finishKo(F, A, B, move, 'KO', 'flash');
    if (r < pKD) return F.knockdown(A, B, move);
    if (r < pRock) F.rock(A, B, Math.round(70 + 90 * (1 - a.recovery) + dmg * 4));
    if (headR >= 1) return finishKo(F, A, B, move, 'TKO', 'accumulated');
  } else if (move.zone === 'body') {
    if (bodyR >= 1) {
      if (B.down > 0 || bodyR >= 1.2 || ground) return finishKo(F, A, B, move, 'TKO', 'body');
      if (!ground) return F.knockdown(A, B, move);
    }
    const pFold = 1 - Math.exp(-dmg * (move.ko + 0.05) * Math.pow(bodyR, 2) * 0.06 * F.opt.koScale * (moveArea(move) === 'kick' ? BK_FOLD : 1));
    if (!ground && rng.chance(pFold)) return F.knockdown(A, B, move);
  } else if (move.zone === 'legs') {
    if (legsR >= F.opt.legsTko) return finishKo(F, A, B, move, 'TKO', 'legs');
    if (legsR >= LG_MIN && !ground && rng.chance((legsR - LG_MIN + 0.05) * LG_P)) return F.knockdown(A, B, move, 'legsGone'); // pierna rota: cae y el pateador va a terminarla
  }
  if (B.cut >= 1) return finishKo(F, A, B, move, 'TKO', 'doctor');
  // Árbitro: no se defiende inteligentemente
  const hurt = B.rocked > 0 || B.dazed > 0;
  if (hurt && B.unanswered >= 6) return finishKo(F, A, B, move, 'TKO', 'unanswered');
  if (ground && F.ground.bottom === B && B.unanswered >= 9 && headR > 0.55) return finishKo(F, A, B, move, 'TKO', 'groundAndPound');
}

// ---------- Derribos ----------
export function resolveTakedown(F, A, B, act) {
  const move = MOVES[act.move];
  const rng = F.rng;
  const cA = condition(A), cB = condition(B);
  const st = F.stats[A.id];
  st.tdAtt++;
  F.roundStat(A.id).tdAtt++;
  const ev0 = baseEvent(A, B, move);
  const fromClinch = F.phase === 'clinch';
  if (!fromClinch && dist(F) > rw(F, move).rangeMax + REACH_SLACK) {
    F.emit(X.SPRAWL, { ...ev0, kind: 'short', power: 0, hitstop: 0 });
    act.recovery += 10;
    A.tdFails++;
    F.ai.observe(F, A, { kind: 'tdResult', ok: false });
    return false;
  }
  const bAct = B.action;
  const bStriking = bAct && !bAct.feint && MOVES[bAct.move]?.kind === 'strike' && bAct.t < bAct.startup + bAct.active;
  const kicking = bStriking && MOVES[bAct.move].limb.startsWith('foot');
  // 'busy' = comprometido con un golpe (arranque/activo o primera parte de la recuperación), groggy o mordió una finta
  const bRec = bAct && !bAct.feint && MOVES[bAct.move]?.kind === 'strike' && bAct.t < bAct.startup + bAct.active + bAct.recovery * 0.6;
  const busy = bRec || B.rocked > 0 || F.t < B.feintBit;
  let readP = busy ? 0 : sig((act.startup + 14 * move.telegraph - B.attr.reaction * cB.speed) / 3.2 + 0.6 + F.ai.readBonus(F, B, A, move) * 2 + 0.6 * (B.style.rangeKick ?? 0)); // el pateador a distancia ve venir el shoot
  readP = ctlReadP(F, B, A, move, readP);
  let defChoice = 'sprawl';
  const read = rng.chance(readP);
  if (read) defChoice = ctlDefense(F, B, A, move);
  // Contra al que dispara (rodilla del pateador / uppercut del boxeador cuando baja la cabeza): golpe enorme si sale
  if (read && defChoice === 'knee') {
    const upper = skill(B, 'punch') > skill(B, 'kick');
    const cArea = upper ? 'punch' : 'kick';
    const kneeAcc = 0.35 + 0.35 * n(B, 'tecnica') * skill(B, cArea);
    if (rng.chance(kneeAcc * cB.defense)) {
      const knee = upper ? MOVES.uppercut : MOVES.flyingKnee;
      const cId = upper ? 'counterUppercut' : 'counterKnee';
      const dmg = (upper ? 11 : 13) * B.attr.power * cB.power * 1.4 * rng.float(0.85, 1.2);
      A.dmg.head += dmg * F.opt.damageScale;
      F.stats[B.id].landed[cId] = (F.stats[B.id].landed[cId] || 0) + 1;
      F.stats[B.id].thrown[cId] = (F.stats[B.id].thrown[cId] || 0) + 1;
      F.roundStat(B.id).dmg += dmg; F.roundStat(B.id).landed++;
      A.unanswered += 1; B.unanswered = 0;
      F.emit(FIGHT_EVENTS.HIT, { attacker: B.id, defender: A.id, limb: upper ? 'handR' : 'kneeR', target: 'head', move: cId, angle: -45, arc: upper ? 'upper' : 'knee', power: powerNorm(dmg), damage: r3(dmg), hitstop: hitstopFor(F, dmg, 3), counter: true });
      act.recovery += 12; A.tdFails++;
      F.ai.observe(F, A, { kind: 'tdResult', ok: false });
      checkDamage(F, B, A, { ...knee, id: cId, ko: 0.85 }, dmg, 1.3);
      return false;
    }
  }
  let off = prowess(A, 'wrestling') * (0.75 + 0.25 * cA.power) * (0.8 + 0.2 * cA.stamina);
  // Bonus MULTIPLICATIVOS (antes +0.12/+0.15/+0.3/+0.1/+0.08 aditivos, que pesaban más con prowess bajo):
  // equivalen a los aditivos con prowess ~0.45 (nivel 50) y escalan igual en cualquier nivel dentro de rel().
  if (kicking) off *= 1.27;          // atrapa la patada / entra bajo el golpe
  else if (bStriking) off *= 1.33;   // cambio de nivel bajo el golpe
  if (B.rocked > 0) off *= 1.67;
  if (act.afterFeint) off *= 1.22;
  if (act.setup) off *= 1.18;
  let def = prowess(B, 'wrestling') * cB.defense * (0.85 + 0.15 * cB.stamina) * (B.style.tdDefense ?? 1);
  if (!read) def *= 0.72;
  if (fromClinch) def *= 0.9;
  if (cornered(F, B)) def *= 1.05; // la reja ayuda a sostenerse
  const margin = rel(off, def);
  const p = sig(margin * 4.5 - 1.5 + (move.id === 'singleLeg' ? -0.15 : 0) + F.opt.tdBias);
  if (rng.chance(p)) {
    let pos = move.lands || 'guard';
    if (margin > 0.35 && rng.chance(0.5)) pos = NEXT_POSITION[pos];
    st.tdLand++;
    F.roundStat(A.id).td++;
    A.momentum = clamp(A.momentum + 0.15, -1, 1);
    B.stamina = Math.max(0, B.stamina - 4);
    B.dmg.body += 2;
    F.emit(FIGHT_EVENTS.TAKEDOWN, { ...ev0, pos, power: 0.5, hitstop: 6 });
    F.ai.observe(F, A, { kind: 'tdResult', ok: true });
    F.ai.observe(F, B, { kind: 'tdAgainst', ok: true, move });
    F.startGround(A, B, pos);
    return true;
  }
  A.tdFails++;
  A.stamina = Math.max(0, A.stamina - 3);
  act.recovery += 10;
  F.ai.observe(F, A, { kind: 'tdResult', ok: false });
  F.ai.observe(F, B, { kind: 'tdAgainst', ok: false, move });
  F.emit(X.SPRAWL, { ...ev0, power: 0.2, hitstop: 4, kind: read ? defChoice : 'scramble' });
  // ¿Guillotina desde el sprawl?
  const gBase = B.style.guillotine ?? (B.style.sub > 0.2 ? 0.18 * B.style.sub : 0); // brawler: guillotina oportunista
  if (!fromClinch && read && gBase > 0 && rng.chance(gBase * skill(B, 'subs'))) {
    F.startGround(A, B, 'guard', /*bottomIs*/ B, /*topIs*/ A);
    F.startSub(B, A, 'guillotine', B.style.guillotine ? 0.12 : 0); // cuello atrapado en shoot; posAdj suave (no spam T12)
    return false;
  }
  if (!fromClinch && rng.chance(0.15 + 0.25 * Math.max(A.style.clinch, B.style.clinch))) F.startClinch(A, B, 'stalled');
  return false;
}

// ---------- Suelo: acciones disputadas (pase, raspada, levantarse, escapes) ----------
export function resolveGroundContest(F, A, B, act) {
  const move = MOVES[act.move];
  const rng = F.rng;
  const g = F.ground;
  const cA = condition(A), cB = condition(B);
  const ev0 = baseEvent(A, B, move);
  const offA = prowess(A, 'ground') * (0.7 + 0.3 * cA.stamina);
  const defB = prowess(B, 'ground') * cB.defense * (0.75 + 0.25 * cB.stamina) * (B.dazed > 0 ? 0.5 : 1);
  const margin = rel(offA, defB);
  const st = F.stats[A.id];
  const posV = POSITION_VALUE[g.pos];
  if (move.id === 'pass') {
    const p = sig(margin * 3.5 - 1.3 - 0.15 * posV + (g.exposed > F.t ? 0.6 : 0));
    if (rng.chance(p)) { st.passes++; F.setPosition(NEXT_POSITION[g.pos], move.id); F.roundStat(A.id).adv++; return true; }
  } else if (move.id === 'takeBack') {
    const p = sig(margin * 3.5 - 1.6 + (g.exposed > F.t ? 1.0 : 0));
    if (rng.chance(p)) { st.passes++; F.setPosition('back', move.id); F.roundStat(A.id).adv++; return true; }
  } else if (move.id === 'disengage') {
    const p = 0.55 + 0.3 * n(A, 'velocidad') - 0.2 * B.style.groundBottomOk;
    if (rng.chance(p)) { F.emit(X.BREAK, { ...ev0, reason: 'disengage' }); F.standUp(A, B, 1.2); return true; }
  } else if (move.id === 'sweep') {
    const p = sig(margin * 4.5 - 0.9 + (g.pos === 'half' ? -0.2 : 0) + B.momentum * -0.2);
    if (rng.chance(p)) {
      st.sweeps++;
      F.roundStat(A.id).adv += 1.5;
      F.emit(X.SWEEP, { ...ev0, power: 0.4, hitstop: 4 });
      F.startGround(A, B, rng.chance(0.6) ? 'guard' : 'half', B, A, true);
      return true;
    }
  } else if (move.id === 'getUp') {
    const base = g.pos === 'guard' ? 0.3 : g.pos === 'half' ? -0.1 : -0.6;
    const wall = cornered(F, A) ? 0.15 : 0; // caminar la reja
    const p = sig(rel(prowess(A, 'wrestling') * 0.5 + 0.5 * offA, prowess(B, 'wrestling') * 0.5 * cB.defense + 0.5 * defB) * 4.5 + base + wall + F.opt.getUpBias + (cA.stamina - 0.5) * 0.6 - 1.6 * (B.style.topControl ?? 0) + (A.style.getUpBonus ?? 0)); // topControl: el luchador te aplasta
    if (rng.chance(p)) { A.getUpFails = 0; F.emit(FIGHT_EVENTS.GET_UP, { ...ev0, kind: 'escape' }); F.standUp(A, B, 0.9); return true; }
    A.getUpFails = (A.getUpFails || 0) + 1;
    if (g.pos === 'side' || g.pos === 'half') g.exposed = F.t + 40; // dio la espalda al levantarse
  } else if (move.id === 'shrimp') {
    const p = sig(margin * 4.5 - 0.5 - 0.2 * (posV - 3));
    if (rng.chance(p)) {
      const to = g.pos === 'back' ? 'side' : g.pos === 'mount' ? 'half' : 'guard';
      F.setPosition(to, move.id, true);
      return true;
    }
    A.getUpFails = (A.getUpFails || 0) + 1; // también frena el spam de shrimp
  }
  return false;
}

// ---------- Sumisiones ----------
export function subOffense(A, move) {
  const cA = condition(A);
  return prowess(A, 'subs') * move.subPower * (0.7 + 0.3 * cA.stamina);
}
// Defender una sumisión es lo primero que entrena cualquier peleador de MMA: el estilo pesa menos (exponente menor).
export const SUB_DEF_EX = 0.25;
export function subDefense(B) {
  const cB = condition(B);
  return prowess(B, 'ground', SUB_DEF_EX) * (0.55 + 0.45 * cB.stamina) * cB.defense * (B.dazed > 0 ? 0.55 : 1) * (B.rocked > 0 ? 0.75 : 1);
}
