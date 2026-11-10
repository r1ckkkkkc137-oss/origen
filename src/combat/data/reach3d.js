// Alcances 3D por golpe de pie (Rick Combate). Distancia PELVIS–PELVIS en el tick de impacto, en METROS.
// Sólo la usa Geometry3D (geo.reachTable); Geometry2D sigue con las ventanas de KAGE (paridad bit a bit).
// Criterio MMA: jab/cross/patadas a media distancia; hook, uppercut y codo sólo a corta (0,80–0,92 m: nunca bajo MIN_GAP_3D_M), si no se lanzan al aire.
// Para validar un clip del Animador: punta del miembro en impactT respecto de la pelvis + centro de la zona del rival ≈ ideal.
import { MOVES, STAND_STRIKES, PX_PER_M } from './moves.js';

/** Separación mínima pelvis–pelvis de pie en 3D (fuera de clinch): a menos, los torsos en guardia se montan. */
export const MIN_GAP_3D_M = 0.80;

/** [ideal, tolerancia] en metros. Ventana = ideal ± tol. */
export const REACH_3D_M = Object.freeze({
  jab: [0.97, 0.06], cross: [0.95, 0.06], overhand: [0.95, 0.06], bodyCross: [0.92, 0.06], supermanPunch: [1.02, 0.07],
  hook: [0.86, 0.06], bodyHook: [0.86, 0.06], uppercut: [0.85, 0.05], standElbow: [0.84, 0.04], spinningBackfist: [0.95, 0.07],
  teep: [1.15, 0.07], lowKick: [1.00, 0.07], calfKick: [0.98, 0.07], bodyKick: [0.95, 0.07], highKick: [1.00, 0.07],
  flyingKnee: [0.86, 0.06],
});

const r1 = (x) => Math.round(x * 10) / 10;
/** id -> movimiento con rangeMin/rangeMax/rangeIdeal en px de la sim (PX_PER_M). Los no listados quedan como en moves.js. */
export const REACH_TABLE_3D = Object.freeze(Object.fromEntries(STAND_STRIKES.filter((id) => REACH_3D_M[id]).map((id) => {
  const [ideal, tol] = REACH_3D_M[id];
  return [id, Object.freeze({ ...MOVES[id], rangeMin: r1((ideal - tol) * PX_PER_M), rangeMax: r1((ideal + tol) * PX_PER_M), rangeIdeal: r1(ideal * PX_PER_M) })];
})));
