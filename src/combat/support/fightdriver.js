// Driver de pelea: elige la API del módulo fight y la expone tick a tick al juego.
// Preferencia (contracts MODULE_API.fight): createFight+tickFight (en vivo) > simulateFight (replay) > fallback de engine.
// Tolerante con detalles de Combate: tickFight puede devolver undefined (se lee fight.frame), los eventos
// pueden traer attacker/defender en vez de actor y los ids pueden ser 0/1/'p1'/'p2'.
import { TICK_RATE } from '../kage-contracts.js';
import * as FB from './fallbacks.js';

/** 'live' | 'sim' | null */
export function selectFightApi(mod) {
  if (!mod) return null;
  if (typeof mod.createFight === 'function' && typeof mod.tickFight === 'function') return 'live';
  if (typeof mod.simulateFight === 'function') return 'sim';
  return null;
}

const ID = { a: 'a', b: 'b', 0: 'a', 1: 'b', p1: 'a', p2: 'b', A: 'a', B: 'b' };
export const normId = (v) => (v == null ? v : ID[v] ?? v);

export function normEvent(e, tick) {
  const out = { ...e };
  if (out.actor == null && out.attacker != null) out.actor = out.attacker;
  if (out.actor == null && out.defender != null) out.actor = out.defender;
  for (const k of ['actor', 'attacker', 'defender', 'winner']) if (k in out) out[k] = normId(out[k]);
  if (out.target != null && ID[out.target] && !['head', 'body', 'legs'].includes(out.target)) out.target = normId(out.target);
  if (out.tick == null) out.tick = tick;
  return out;
}

function normFighter(f) {
  if (!f || typeof f !== 'object') return null;
  return { ...f, x: +f.x, hp: Number.isFinite(+f.hp) ? +f.hp : 0, maxHp: Number.isFinite(+f.maxHp) ? +f.maxHp : 100, stamina: f.stamina ?? 1, action: f.action ?? 'guard', actionT: f.actionT ?? 0 };
}

export function normFrame(raw, tickFallback) {
  if (!raw || typeof raw !== 'object') throw new Error('tickFight no devolvió frame');
  const a = normFighter(raw.a ?? raw.fighters?.[0] ?? raw.p1);
  const b = normFighter(raw.b ?? raw.fighters?.[1] ?? raw.p2);
  if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) throw new Error('frame sin a.x/b.x numéricos');
  const tick = Number.isFinite(raw.tick) ? raw.tick : tickFallback;
  const events = (Array.isArray(raw.events) ? raw.events : []).map((e) => normEvent(e, tick));
  return { tick, a, b, events, done: !!raw.done, winner: normId(raw.winner ?? null), reason: raw.reason ?? null };
}

/** Valida mínimamente un FightResult; devuelve string de error o null. */
export function validateFightResult(r) {
  if (!r || !Array.isArray(r.ticks) || r.ticks.length === 0) return 'sin ticks';
  const t0 = r.ticks[0];
  if (!t0.a || !t0.b || typeof t0.a.x !== 'number' || typeof t0.b.x !== 'number') return 'tick sin a/b.x';
  const w = normId(r.winner ?? null);
  if (!(w === 'a' || w === 'b' || w === null)) return 'winner inválido';
  if (!Array.isArray(r.events)) return 'sin events';
  return null;
}

/** Tope de seguridad: si una pelea en vivo no termina, decisión forzada. */
export const MAX_LIVE_TICKS = TICK_RATE * 60 * 20;

/**
 * @param {any} fightMod  impl de loadModules().fight (o el módulo crudo)
 * @returns driver { mode:'live'|'sim', source:'module'|'fallback', cur, prev, step():events[], done, winner, reason, tickCount, events, error? }
 */
export function createFightDriver(fightMod, specA, specB, seed, { log = console, maxTicks = MAX_LIVE_TICKS } = {}) {
  const errors = [];
  const attempts = [];
  const api = selectFightApi(fightMod);
  const isFb = fightMod && fightMod.createFight === FB.createFight;
  if (api === 'live' && !isFb) attempts.push(['live', fightMod, 'module']);
  if (selectFightApi({ simulateFight: fightMod?.simulateFight }) === 'sim' && fightMod.simulateFight !== FB.simulateFight) attempts.push(['sim', fightMod, 'module']);
  attempts.push(['live', FB, 'fallback']);
  for (const [mode, mod, source] of attempts) {
    try {
      const d = mode === 'live' ? liveDriver(mod, specA, specB, seed, maxTicks) : simDriver(mod, specA, specB, seed);
      d.source = source;
      if (errors.length) d.error = errors.join(' | ');
      return d;
    } catch (err) {
      errors.push(`${source}/${mode}: ${err?.message ?? err}`);
      log?.warn?.(`[kage] fight ${source}/${mode} falló; pruebo la siguiente opción`, err);
    }
  }
  throw new Error('ninguna API de pelea funcionó: ' + errors.join(' | '));
}

/**
 * Normaliza lo que devuelve tickFight a un FightFrame. Acepta:
 *  - FightFrame {tick, a, b, events, done, winner?, reason?}
 *  - undefined  -> se lee fight.frame
 *  - forma de src/fight/index.js: {ticks:[FightTick...], events, done, over} (se usa el último tick;
 *    si no avanzó ninguno se repite el frame anterior). winner/reason via getResult(fight) si existe.
 */
function readLive(mod, fight, ret, prev, n) {
  let raw = ret === undefined ? fight.frame : ret;
  if (raw && Array.isArray(raw.ticks) && !raw.a) {
    const last = raw.ticks[raw.ticks.length - 1];
    if (!last && !prev) throw new Error('tickFight no avanzó ningún tick');
    const base = last ?? { tick: prev.tick, a: prev.a, b: prev.b };
    raw = { ...base, events: raw.events, done: raw.done, over: raw.over, winner: raw.winner, reason: raw.reason };
  }
  const fr = normFrame(raw, n);
  if (fr.done && !raw.winner && !raw.reason) {
    const r = typeof mod.getResult === 'function' ? mod.getResult(fight) : fight;
    fr.winner = normId(r?.winner ?? null); fr.reason = r?.reason ?? null;
  }
  return fr;
}

function liveDriver(mod, specA, specB, seed, maxTicks) {
  const fight = mod.createFight(specA, specB, seed);
  if (fight == null) throw new Error('createFight devolvió ' + fight);
  const dt = 1 / TICK_RATE;
  const first = readLive(mod, fight, mod.tickFight(fight, dt), null, 0); // valida el primer frame (si falla, cae a la siguiente API)
  const d = { mode: 'live', fight, cur: first, prev: first, tickCount: 1, events: [...first.events], done: first.done, winner: first.winner, reason: first.reason, pending: first.events };
  d.step = () => {
    if (d.pending) { const p = d.pending; d.pending = null; return p; }
    if (d.done) return [];
    d.prev = d.cur;
    d.cur = readLive(mod, fight, mod.tickFight(fight, dt), d.prev, d.tickCount);
    d.tickCount++;
    for (const e of d.cur.events) d.events.push(e);
    if (d.cur.done) {
      d.done = true; d.winner = d.cur.winner; d.reason = d.cur.reason ?? 'decision';
      let r = null; try { r = typeof mod.getResult === 'function' ? mod.getResult(fight) : null; } catch { r = null; }
      setMethod(d, r);
    } else if (d.tickCount >= maxTicks) {
      d.done = true; const ra = d.cur.a.hp / d.cur.a.maxHp, rb = d.cur.b.hp / d.cur.b.maxHp;
      d.winner = ra === rb ? null : ra > rb ? 'a' : 'b'; d.reason = d.winner ? 'decision' : 'draw'; d.capped = true;
      setMethod(d, null);
    }
    return d.cur.events;
  };
  return d;
}

/**
 * Método de la definición: 'KO'|'TKO'|'SUB'|'DEC'|'DRAW'. Prioridad: result.method del módulo (getResult /
 * FightResult extra) > último evento de cierre (tap→SUB, stoppage→TKO, ko→KO) > reason ('decision'/'draw').
 */
export function resolveMethod(result, events = [], reason = null) {
  const m = result?.method;
  if (typeof m === 'string' && /^(KO|TKO|SUB|DEC|DRAW)$/.test(m)) return m;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i]?.type;
    if (t === 'tap') return 'SUB';
    if (t === 'stoppage') return 'TKO';
    if (t === 'ko') return 'KO';
  }
  if (reason === 'draw') return 'DRAW';
  if (reason === 'decision') return 'DEC';
  return reason === 'ko' ? 'KO' : null;
}
function setMethod(d, r) {
  d.method = resolveMethod(r, d.events, d.reason);
  d.detail = r?.detail ?? null;
}

/** Etiqueta para la pantalla de resultado. */
export function methodLabel(method, detail) {
  const base = { KO: 'KO', TKO: 'TKO', SUB: 'Sumisión', DEC: 'Decisión', DRAW: 'Empate' }[method] ?? (method ?? '');
  const det = typeof detail === 'string' && detail && detail !== method ? detail : null;
  return det ? `${base} (${det})` : base;
}

function simDriver(mod, specA, specB, seed) {
  const r = mod.simulateFight(specA, specB, seed);
  const err = validateFightResult(r);
  if (err) throw new Error('FightResult inválido: ' + err);
  const frames = r.ticks.map((t, i) => normFrame(t, i));
  const evs = r.events.map((e) => normEvent(e, e.tick));
  const byTick = new Map();
  for (const e of evs) { if (!byTick.has(e.tick)) byTick.set(e.tick, []); byTick.get(e.tick).push(e); }
  let idx = 0;
  const d = { mode: 'sim', cur: frames[0], prev: frames[0], tickCount: 1, events: evs, done: frames.length <= 1, winner: null, reason: null, result: r };
  const fin = () => { d.done = true; d.winner = normId(r.winner); d.reason = r.reason; setMethod(d, r); };
  if (d.done) fin();
  d.pending = byTick.get(frames[0].tick) ?? [];
  d.step = () => {
    if (d.pending) { const p = d.pending; d.pending = null; return p; }
    if (d.done) return [];
    idx++;
    d.prev = d.cur; d.cur = frames[idx]; d.tickCount = idx + 1;
    if (idx >= frames.length - 1) fin();
    return byTick.get(d.cur.tick) ?? [];
  };
  return d;
}
