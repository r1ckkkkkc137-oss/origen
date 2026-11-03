// Métricas de "pelea pro" (dueño: Rick Combate API). PURO y sin dependencias: lee solo result.ticks / result.events
// de un FightResult (src/fight/index.js). Nada de esto toca la simulación.
//
//   const m = fightMetrics(result)            // conteos aditivos por lado { a, b, pair }
//   const acc = mergeMetrics([m1, m2, ...])   // suma conteos (o por estilo: mergeMetrics([...], { by: 'style' }))
//   summarize(acc.a)                          // derivados: %, por minuto, entropía media, etc.
//
// Definiciones (todas sobre la fase de pie salvo que se diga):
//  - Golpes lanzados = evento 'strike' (cualquier fase); conectados = 'hit' del mismo atacante y movimiento.
//    Precisión = conectados / lanzados (bloqueados, chequeados, esquivados y whiffs no cuentan como conectados).
//  - MEDIDA = jab, teep. POTENCIA = cross, hook, uppercut, overhand, superman, spinningBackfist, highKick,
//    bodyKick, lowKick, calfKick, flyingKnee, standElbow y rodillas/codos/uppercut del clinch. El resto
//    (bodyHook, bodyCross, ground and pound) queda en 'otros'. Las contras al derribo (counterUppercut,
//    counterKnee) llegan como 'hit' con counter:true sin 'strike' previo: cuentan como lanzado+conectado+potencia+contra. Los % son sobre golpes de pie+clinch.
//  - Finta "seguida" = el mismo peleador lanza golpe o derribo ≤ FOLLOW_TICKS (30) después (y ≤ 60, 1 s, aparte;
//    el evento 'feint' sale al resolverse el amago, así que el golpe siguiente suele llegar a 30–60 ticks).
//  - Combo = cadena de golpes del mismo atacante donde cada uno siguiente trae combo:true; largo ≥2.
//  - Contragolpe = golpe propio ≤ COUNTER_TICKS (30) tras un whiff del rival o un bloqueo/parry/esquive/chequeo propio
//    (counterPct = sobre esas oportunidades). counterFlagPct = % de golpes que el núcleo marcó counter:true.
//  - Footwork (por ticks, tick.foot o, si falta, tick.animClip): entrada = tramo 'walk' o paso 'stepIn'/'cutAngle';
//    salida = paso 'stepOut'/'pivot'/'circle' o tramo 'shuffleBack' que empieza ≤ 40 ticks después de un golpe propio;
//    retroceso = cualquier otro tramo 'shuffleBack'. Pasos sueltos: stepIns/stepOuts/pivots/circles/cuts (un paso
//    oneShot nuevo = cambio de tipo o de animSeq). x sigue 1D: el ángulo es de animación (tick.orbit); "giro" =
//    pivot/circle/cutAngle, o tramo contra la reja (|x| ≥ cage−2, de espaldas) en el que el peleador se recentra.
//    Arrinconado = episodios con |x| ≥ cage − 12.75 de espaldas a la reja (misma regla que resolve.cornered).
//  - Distancia (pelvis–pelvis de pie): 'adentro' < 81 px, 'rango' 81–133 px (de la ventana del hook a la del
//    lowKick según moves.reachWindow), 'afuera' > 133 px.
//  - Spam: secuencia de acciones ofensivas (id del golpe, del derribo/clinch o 'feint'): racha máxima igual,
//    entropía de Shannon (bits) por pelea y % de acciones iguales a la anterior. Para derribos: racha máxima de
//    intentos seguidos (sin otra acción en medio), % de intentos que siguen a otro intento y separación media.
//  - Pausa = tramo de pie > PAUSE_TICKS (180 = 3 s) sin golpe/finta/derribo de NINGUNO; se reporta % del tiempo de pie.

export const METRIC_DEFAULTS = Object.freeze({
  tickRate: 60, cage: 260, corneredPx: 12.75, insidePx: 81, outsidePx: 133,
  FOLLOW_TICKS: 30, FOLLOW_LONG_TICKS: 60, CORNER_EXIT_PX: 20, COUNTER_TICKS: 30, EXIT_TICKS: 40, PAUSE_TICKS: 180,
});
export const MEASURE_MOVES = Object.freeze(['jab', 'teep']);
export const POWER_MOVES = Object.freeze(['cross', 'hook', 'uppercut', 'overhand', 'supermanPunch', 'spinningBackfist',
  'highKick', 'bodyKick', 'lowKick', 'calfKick', 'flyingKnee', 'standElbow', 'clinchKnee', 'clinchKneeHead', 'clinchElbow', 'dirtyUppercut',
  'counterUppercut', 'counterKnee']);
export const COUNTER_MOVES = Object.freeze(['counterUppercut', 'counterKnee']);
/** Nombres exactos de los pasos del núcleo (core.footKind / tick.foot). */
export const FOOT_IN = Object.freeze(['stepIn', 'cutAngle']);
export const FOOT_OUT = Object.freeze(['stepOut', 'pivot', 'circle']);
const FOOT = new Set([...FOOT_IN, ...FOOT_OUT]), F_IN = new Set(FOOT_IN), CTR = new Set(COUNTER_MOVES);
const FOOT_KEY = { stepIn: 'stepIns', stepOut: 'stepOuts', pivot: 'pivots', circle: 'circles', cutAngle: 'cuts' };
const TAKEDOWNS = new Set(['doubleLeg', 'singleLeg', 'bodyLockTrip']);
const OUTCOMES = new Set(['hit', 'block', 'dodge', 'check', 'parry', 'whiff', 'catch']);
const DEFENSES = new Set(['block', 'parry', 'dodge', 'check']);
const MEAS = new Set(MEASURE_MOVES), POW = new Set(POWER_MOVES);

const KEYS = ['fights', 'minutes', 'standMin', 'thrown', 'landed', 'measT', 'measL', 'powT', 'powL', 'otherT', 'otherL',
  'feints', 'feintFollow', 'feintFollow60', 'counterFlag', 'tCornered', 'combos', 'comboStrikes', 'counters', 'counterOpp', 'entries', 'exits', 'retreats', 'turns', 'stepIns', 'stepOuts', 'pivots', 'circles', 'cuts',
  'cornered', 'tInside', 'tRange', 'tOutside', 'tStand', 'acts', 'sameAsPrev', 'maxRun', 'entropySum', 'entropyN',
  'tdAtt', 'tdAfterTd', 'tdMaxRun', 'tdGapSum', 'tdGapN', 'pauseTicks'];
const zero = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

function entropy(seq) {
  const c = new Map();
  for (const s of seq) c.set(s, (c.get(s) ?? 0) + 1);
  let h = 0;
  for (const n of c.values()) { const p = n / seq.length; h -= p * Math.log2(p); }
  return h;
}

/** Conteos aditivos de una pelea. opts sobrescribe METRIC_DEFAULTS. */
export function fightMetrics(result, opts = {}) {
  const o = { ...METRIC_DEFAULTS, tickRate: result.tickRate ?? METRIC_DEFAULTS.tickRate, ...opts };
  const ticks = result.ticks ?? [], events = result.events ?? [];
  const S = { a: zero(), b: zero() };
  const other = (s) => (s === 'a' ? 'b' : 'a');
  const live = ticks.filter((t) => t.phase === 'stand' || t.phase === 'clinch' || t.phase === 'ground');
  for (const s of ['a', 'b']) { S[s].fights = 1; S[s].minutes = live.length / o.tickRate / 60; }

  // --- eventos ---
  const pending = { a: [], b: [] };                 // golpes lanzados esperando resultado
  const lastStrike = { a: null, b: null };          // para cadenas de combo
  const chain = { a: 0, b: 0 };
  const closeChain = (s) => { if (chain[s] >= 2) { S[s].combos++; S[s].comboStrikes += chain[s]; } chain[s] = 0; };
  const feints = { a: [], b: [] };
  const counterWin = { a: -1e9, b: -1e9 };          // tick hasta el que un golpe propio cuenta como contragolpe
  const acts = { a: [], b: [] };                    // secuencia de acciones ofensivas
  const offTicks = [];                              // ticks con acción ofensiva de cualquiera
  const lastTd = { a: null, b: null };
  const followFeint = (s, t) => { for (const f of feints[s]) if (!f.done && t - f.t <= o.FOLLOW_LONG_TICKS) { f.done = true; S[s].feintFollow60++; if (t - f.t <= o.FOLLOW_TICKS) S[s].feintFollow++; } };
  for (const e of events) {
    const s = e.attacker;
    if (e.type === 'strike') {
      const st = S[s];
      st.thrown++;
      const cls = MEAS.has(e.move) ? 'meas' : POW.has(e.move) ? 'pow' : 'other';
      if (e.phase !== 'ground' || cls === 'other') st[cls + 'T']++;
      pending[s].push({ move: e.move, cls });
      if (e.combo && chain[s] > 0) chain[s]++; else { closeChain(s); chain[s] = 1; }
      if (e.tick <= counterWin[s]) st.counters++;
      counterWin[s] = -1e9;
      acts[s].push(e.move); offTicks.push(e.tick);
      if (e.counter) st.counterFlag++;
      followFeint(s, e.tick);
    } else if (OUTCOMES.has(e.type) && s && e.move) {
      const q = pending[s], i = q.findIndex((p) => p.move === e.move);
      const p = i >= 0 ? q.splice(i, 1)[0] : null;
      if (p && e.type === 'hit') { S[s].landed++; S[s][p.cls + 'L']++; }
      else if (!p && e.type === 'hit' && CTR.has(e.move)) {
        const st = S[s]; st.thrown++; st.landed++; st.powT++; st.powL++; st.counterFlag++; st.counters++;
        closeChain(s); acts[s].push(e.move); offTicks.push(e.tick);
      }
      const d = e.defender;
      // oportunidad de contragolpe para el defensor: whiff del rival o defensa propia
      if (d && (e.type === 'whiff' || DEFENSES.has(e.type))) { S[d].counterOpp++; counterWin[d] = e.tick + o.COUNTER_TICKS; }
    } else if (e.type === 'feint') {
      S[s].feints++; feints[s].push({ t: e.tick, done: false }); acts[s].push('feint'); offTicks.push(e.tick); closeChain(s);
    } else if (e.type === 'action' && s && e.move) {
      acts[s].push(e.move); offTicks.push(e.tick); closeChain(s);
      if (TAKEDOWNS.has(e.move)) {
        const st = S[s]; st.tdAtt++;
        if (lastTd[s] != null) { st.tdGapSum += (e.tick - lastTd[s]) / o.tickRate; st.tdGapN++; }
        lastTd[s] = e.tick;
        followFeint(s, e.tick);
      }
    }
  }
  for (const s of ['a', 'b']) {
    closeChain(s);
    const seq = acts[s], st = S[s];
    st.acts = seq.length;
    let run = 0, tdRun = 0;
    for (let i = 0; i < seq.length; i++) {
      const same = i > 0 && seq[i] === seq[i - 1];
      if (same) st.sameAsPrev++;
      run = same ? run + 1 : 1; st.maxRun = Math.max(st.maxRun, run);
      const td = TAKEDOWNS.has(seq[i]);
      if (td && i > 0 && TAKEDOWNS.has(seq[i - 1])) st.tdAfterTd++;
      tdRun = td ? tdRun + 1 : 0; st.tdMaxRun = Math.max(st.tdMaxRun, tdRun);
    }
    if (seq.length >= 2) { st.entropySum += entropy(seq); st.entropyN++; }
  }

  // --- ticks (footwork / distancia / pausas) ---
  const strikeTicks = { a: [], b: [] };
  for (const e of events) if (e.type === 'strike') strikeTicks[e.attacker].push(e.tick);
  const recentStrike = (s, t) => { const arr = strikeTicks[s]; for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] > t) continue; return t - arr[i] <= o.EXIT_TICKS; } return false; };
  const prev = { a: null, b: null }, seqP = { a: null, b: null }, corn = { a: false, b: false }, turning = { a: false, b: false }, px = { a: null, b: null };
  const offSet = new Set(offTicks);
  let quiet = 0;
  for (const t of ticks) {
    const stand = t.phase === 'stand';
    if (stand && t.a && t.b) {
      const d = Math.abs(t.a.x - t.b.x);
      for (const s of ['a', 'b']) {
        const st = S[s]; st.tStand++;
        if (d < o.insidePx) st.tInside++; else if (d > o.outsidePx) st.tOutside++; else st.tRange++;
      }
      if (offSet.has(t.tick)) { if (quiet > o.PAUSE_TICKS) { S.a.pauseTicks += quiet; S.b.pauseTicks += quiet; } quiet = 0; } else quiet++;
    } else { if (quiet > o.PAUSE_TICKS) { S.a.pauseTicks += quiet; S.b.pauseTicks += quiet; } quiet = 0; }
    for (const s of ['a', 'b']) {
      const f = t[s]; if (!f) continue;
      const st = S[s];
      const fk = stand ? (FOOT.has(f.foot) ? f.foot : FOOT.has(f.animClip) ? f.animClip : null) : null;
      const clip = stand ? fk ?? f.animClip : null;   // prev[] guarda este 'clip' (paso o clip)
      // paso nuevo: cambia el tipo, o el mismo oneShot se repite (animSeq nuevo con el clip del paso, no una reacción)
      const newStep = fk && (fk !== prev[s] || (f.animSeq != null && f.animSeq !== seqP[s] && f.animClip === fk && fk !== 'circle' && fk !== 'cutAngle'));
      if (newStep) {
        st[FOOT_KEY[fk]]++;
        if (F_IN.has(fk)) st.entries++; else st.exits++;
        if (fk !== 'stepIn' && fk !== 'stepOut') st.turns++;
      } else if (clip !== prev[s]) {
        if (clip === 'walk') st.entries++;
        else if (clip === 'shuffleBack') { if (recentStrike(s, t.tick)) st.exits++; else st.retreats++; }
      }
      prev[s] = clip; seqP[s] = f.animSeq;
      const backToWall = Math.sign(f.x) === -f.facing;
      // histéresis: el episodio termina recién al salir CORNER_EXIT_PX más allá del umbral (o al dejar de estar de pie)
      const c = stand && backToWall && Math.abs(f.x) >= o.cage - o.corneredPx;
      if (c && !corn[s]) st.cornered++;
      corn[s] = stand && (c || (corn[s] && Math.abs(f.x) >= o.cage - o.corneredPx - o.CORNER_EXIT_PX));
      if (c) st.tCornered++;
      const atWall = stand && backToWall && Math.abs(f.x) >= o.cage - 2;
      const recenter = atWall && px[s] != null && Math.abs(f.x) < Math.abs(px[s]) && clip === 'shuffleBack' && !fk;
      if (recenter && !turning[s]) st.turns++;
      turning[s] = recenter || (turning[s] && atWall);
      px[s] = f.x;
    }
  }
  if (quiet > o.PAUSE_TICKS) { S.a.pauseTicks += quiet; S.b.pauseTicks += quiet; }
  for (const s of ['a', 'b']) S[s].standMin = S[s].tStand / o.tickRate / 60;
  return { a: S.a, b: S.b, styles: result.styles ?? null };
}

/** Suma conteos. Sin opts: { a, b, all }. Con { by: 'style' }: { [estilo]: conteos, all } (necesita result.styles). */
export function mergeMetrics(list, opts = {}) {
  const add = (acc, x) => { for (const k of KEYS) acc[k] += x[k]; return acc; };
  const out = { all: zero() };
  for (const m of list) {
    for (const s of ['a', 'b']) {
      const key = opts.by === 'style' ? (m.styles?.[s] ?? s) : s;
      out[key] ??= zero();
      add(out[key], m[s]); add(out.all, m[s]);
    }
  }
  return out;
}

const r = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
/** Derivados legibles de un acumulado (maxRun/tdMaxRun se reportan como media por peleador-pelea). */
export function summarize(c) {
  const fm = c.fights || 1, min = c.minutes || 1e-9, sm = c.standMin || 1e-9;
  const mp = c.measT + c.powT;
  return {
    fights: c.fights,
    strikesPerMin: r(c.thrown / min), landedPerMin: r(c.landed / min), accuracy: r((100 * c.landed) / Math.max(1, c.thrown)),
    measurePctThrown: r((100 * c.measT) / Math.max(1, mp)), measurePctLanded: r((100 * c.measL) / Math.max(1, c.measL + c.powL)),
    measureAcc: r((100 * c.measL) / Math.max(1, c.measT)), powerAcc: r((100 * c.powL) / Math.max(1, c.powT)),
    feintsPerFight: r(c.feints / fm, 2), feintsPerMin: r(c.feints / min, 2), feintFollowPct: r((100 * c.feintFollow) / Math.max(1, c.feints)), feintFollow60Pct: r((100 * c.feintFollow60) / Math.max(1, c.feints)),
    comboLen: r(c.comboStrikes / Math.max(1, c.combos), 2), comboPct: r((100 * c.comboStrikes) / Math.max(1, c.thrown)),
    countersPerMin: r(c.counters / min, 2), counterPct: r((100 * c.counters) / Math.max(1, c.counterOpp)), counterFlagPct: r((100 * c.counterFlag) / Math.max(1, c.thrown)),
    entriesPerMin: r(c.entries / sm), exitsPerMin: r(c.exits / sm), retreatsPerMin: r(c.retreats / sm), turnsPerFight: r(c.turns / fm, 2),
    stepInsPerMin: r(c.stepIns / sm), stepOutsPerMin: r(c.stepOuts / sm), pivotsPerFight: r(c.pivots / fm, 2), circlesPerFight: r(c.circles / fm, 2), cutsPerFight: r(c.cuts / fm, 2),
    corneredPerFight: r(c.cornered / fm, 2), corneredPct: r((100 * c.tCornered) / Math.max(1, c.tStand)),
    inRangePct: r((100 * c.tRange) / Math.max(1, c.tStand)), insidePct: r((100 * c.tInside) / Math.max(1, c.tStand)), outsidePct: r((100 * c.tOutside) / Math.max(1, c.tStand)),
    maxRunAvg: r(c.maxRun / fm, 2), entropyBits: r(c.entropySum / Math.max(1, c.entropyN), 2), samePrevPct: r((100 * c.sameAsPrev) / Math.max(1, c.acts - c.fights)),
    tdPerFight: r(c.tdAtt / fm, 2), tdMaxRunAvg: r(c.tdMaxRun / fm, 2), tdAfterTdPct: r((100 * c.tdAfterTd) / Math.max(1, c.tdAtt)), tdGapSec: r(c.tdGapSum / Math.max(1, c.tdGapN)),
    pausePct: r((100 * c.pauseTicks) / Math.max(1, c.tStand)),
  };
}
