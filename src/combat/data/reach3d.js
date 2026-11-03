// Alcances 3D por golpe de pie (Rick Combate). Distancia PELVIS–PELVIS en el tick de impacto, en METROS.
// Sólo la usa Geometry3D (geo.reachTable); Geometry2D sigue con las ventanas de KAGE (paridad bit a bit).
// Criterio MMA: jab/cross/patadas a media distancia; hook, uppercut y codo sólo a corta (0,6–0,8 m), si no se lanzan al aire.
// Para validar un clip del Animador: punta del miembro en impactT respecto de la pelvis + centro de la zona del rival ≈ ideal.
import { MOVES, STAND_STRIKES, PX_PER_M } from './moves.js';

/** [ideal, tolerancia] en metros. Ventana = ideal ± tol. */
export const REACH_3D_M = Object.freeze({
  jab: [1.10, 0.07], cross: [1.05, 0.07], overhand: [1.00, 0.07], bodyCross: [0.95, 0.07], supermanPunch: [1.05, 0.07],
  hook: [0.70, 0.08], bodyHook: [0.68, 0.08], uppercut: [0.66, 0.07], standElbow: [0.62, 0.05], spinningBackfist: [0.95, 0.07],
  teep: [1.15, 0.07], lowKick: [1.00, 0.07], calfKick: [0.98, 0.07], bodyKick: [0.95, 0.07], highKick: [1.00, 0.07],
  flyingKnee: [0.75, 0.07],
});

const r1 = (x) => Math.round(x * 10) / 10;
/** id -> movimiento con rangeMin/rangeMax/rangeIdeal en px de la sim (PX_PER_M). Los no listados quedan como en moves.js. */
export const REACH_TABLE_3D = Object.freeze(Object.fromEntries(STAND_STRIKES.filter((id) => REACH_3D_M[id]).map((id) => {
  const [ideal, tol] = REACH_3D_M[id];
  return [id, Object.freeze({ ...MOVES[id], rangeMin: r1((ideal - tol) * PX_PER_M), rangeMax: r1((ideal + tol) * PX_PER_M), rangeIdeal: r1(ideal * PX_PER_M) })];
})));
