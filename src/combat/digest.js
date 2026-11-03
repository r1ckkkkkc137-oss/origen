// Digest bit-exacto de una pelea (para paridad 2D y determinismo 3D). Sólo usa la API pública de src/fight/index.js,
// así que sirve igual contra la copia de referencia de KAGE y contra la copia refactorizada.
import { createHash } from 'node:crypto';

/** JSON estable que distingue -0 / NaN / Infinity (JSON.stringify los aplasta). */
export function stable(v) {
  return JSON.stringify(v, (_k, x) => (typeof x === 'number' && (Object.is(x, -0) || !Number.isFinite(x)) ? `#${Object.is(x, -0) ? '-0' : String(x)}` : x));
}

const spec = (style, base) => ({ id: style, name: style, level: 5, style, condition: 1, stats: { fuerza: base, velocidad: base, resistencia: base, tecnica: base } });
export const levelSpec = spec;

/**
 * @param {object} mod  módulo src/fight/index.js (ref o nuevo)
 * @returns {{winner,method,detail,round,endTick,seconds,events:number,eventsHash:string,ticksHash:string,fullHash:string}}
 */
export function fightDigest(mod, styleA, styleB, level, seed, opts = {}) {
  const r = mod.simulateFight(spec(styleA, level), spec(styleB, level), seed, { record: true, ...opts });
  const eh = createHash('sha1'), th = createHash('sha1');
  for (const e of r.events) eh.update(stable(e)).update('\n');
  for (const t of r.ticks) th.update(stable(t)).update('\n');
  const fullHash = createHash('sha1').update(stable({ ...r, ticks: undefined, events: undefined })).digest('hex');
  return { winner: r.winner, method: r.method, detail: r.detail ?? null, round: r.round, endTick: r.endTick, events: r.events.length, ticks: r.ticks.length, eventsHash: eh.digest('hex'), ticksHash: th.digest('hex'), fullHash };
}

/** Matriz de paridad: 28 pares (i<j) de 8 estilos. */
export function stylePairs(STYLE_IDS) {
  const out = [];
  for (let i = 0; i < STYLE_IDS.length; i++) for (let j = i + 1; j < STYLE_IDS.length; j++) out.push([STYLE_IDS[i], STYLE_IDS[j]]);
  return out;
}
export const LEVELS = [10, 50, 85];

/** Subconjunto fijo de 56 seeds: 28 pares x 2, niveles rotando 10/50/85. */
export function subset56(STYLE_IDS) {
  const pairs = stylePairs(STYLE_IDS), out = [];
  pairs.forEach(([a, b], i) => { for (let k = 0; k < 2; k++) out.push({ a, b, level: LEVELS[(i + k) % 3], seed: 1000 + i * 2 + k }); });
  return out;
}
/** 28 pares x 3 niveles x N seeds (N=12 => 1008). */
export function fullSet(STYLE_IDS, perCombo = 12) {
  const out = [];
  stylePairs(STYLE_IDS).forEach(([a, b], i) => LEVELS.forEach((level, li) => { for (let k = 0; k < perCombo; k++) out.push({ a, b, level, seed: 5000 + (i * 3 + li) * 97 + k * 7 }); }));
  return out;
}
