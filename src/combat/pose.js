// Esqueleto 3D por defecto + pose procedural SIN animación externa, para correr headless (tests, balance, prototipo).
// Convención de Skeleton3D (propuesta; ver riesgos en el informe):
//   { bones:[{name,parent}], pose:{ boneName:{x,y,z} }, root:{x,y,z,heading}, space:'local'|'world' }
//   space 'local' : pose en el marco del peleador, EN METROS: origen = pelvis-en-reposo-sobre-el-suelo (root), +x = adelante (heading),
//                   +y = ARRIBA, +z = lateral derecha del peleador. Se rota por heading y se escala por pxPerUnit (85).
//   space 'world' : pose ya en mundo (metros, y arriba); root se ignora para la pose (la raíz de la sim manda igualmente).
//   root.heading  : radianes en el plano XZ del mundo; adelante = (cos h, sin h) en (x, z).
import { JOINTS } from './kage-contracts.js';
import { CLIP_REACH, PX_PER_M, MOVES } from './data/moves.js';

/** Huesos KAGE con su padre (jerarquía mínima de 16 articulaciones). */
export const KAGE_BONES = Object.freeze([
  { name: 'pelvis', parent: null },
  { name: 'spine', parent: 'pelvis' }, { name: 'neck', parent: 'spine' }, { name: 'head', parent: 'neck' },
  { name: 'shoulderL', parent: 'spine' }, { name: 'elbowL', parent: 'shoulderL' }, { name: 'handL', parent: 'elbowL' },
  { name: 'shoulderR', parent: 'spine' }, { name: 'elbowR', parent: 'shoulderR' }, { name: 'handR', parent: 'elbowR' },
  { name: 'hipL', parent: 'pelvis' }, { name: 'kneeL', parent: 'hipL' }, { name: 'footL', parent: 'kneeL' },
  { name: 'hipR', parent: 'pelvis' }, { name: 'kneeR', parent: 'hipR' }, { name: 'footR', parent: 'kneeR' },
]);

/** Reposo de stickman en px (misma escala que src/anim: origen suelo bajo la pelvis, +x adelante, +y abajo). [x, y, z(px lateral)] */
const REST_PX = Object.freeze({
  pelvis: [0, -90, 0], spine: [4, -115, 0], neck: [8, -140, 0], head: [10, -152, 0],
  shoulderL: [8, -138, -14], elbowL: [22, -125, -16], handL: [34, -138, -14],
  shoulderR: [8, -138, 14], elbowR: [18, -122, 16], handR: [30, -136, 14],
  hipL: [0, -90, -8], kneeL: [6, -48, -9], footL: [4, 0, -10],
  hipR: [0, -90, 8], kneeR: [-4, -48, 9], footR: [-8, 0, 10],
});

/** Zona de daño y radio de cápsula (m) del hueso hijo del segmento padre→hijo. */
export const ZONE_OF = Object.freeze({
  spine: ['body', 0.17], neck: ['body', 0.07], head: ['head', 0.11],
  shoulderL: ['body', 0.06], shoulderR: ['body', 0.06],
  elbowL: ['armL', 0.05], handL: ['armL', 0.04], elbowR: ['armR', 0.05], handR: ['armR', 0.04],
  hipL: ['body', 0.1], hipR: ['body', 0.1],
  kneeL: ['legs', 0.08], footL: ['legs', 0.06], kneeR: ['legs', 0.08], footR: ['legs', 0.06],
});

/** Pose de reposo local en metros (y arriba, z lateral). */
export function restPose() {
  const p = {};
  for (const j of JOINTS) { const r = REST_PX[j]; p[j] = { x: r[0] / PX_PER_M, y: -r[1] / PX_PER_M, z: r[2] / PX_PER_M }; }
  return p;
}

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

/**
 * Pose procedural determinista (pura: sólo lee F.t, F.phase y el estado del peleador; no consume RNG, no escribe nada).
 * Presentación únicamente: la sim NO depende de ella.
 * @returns {Record<string,{x:number,y:number,z:number}>}
 */
export function proceduralPose(F, f) {
  const p = restPose();
  const t = F.t / 60;
  // balanceo de guardia (idle bounce), fase distinta por peleador
  const ph = f.id === 'a' ? 0 : 1.7;
  const bob = Math.sin(t * 5 + ph) * 0.012;
  for (const j of JOINTS) p[j].y += (j === 'footL' || j === 'footR') ? 0 : bob;

  const lying = F.phase === 'ground' || f.down > 0;
  if (lying) {
    // tumbado: eje del cuerpo horizontal (x), a baja altura
    const top = F.ground && F.ground.top === f;
    for (const j of JOINTS) {
      const r = REST_PX[j];
      p[j] = { x: (-r[1] * (top ? 0.55 : 1)) / PX_PER_M, y: (top ? 0.45 + (r[1] / -90) * 0.1 : 0.12), z: r[2] / PX_PER_M };
    }
    return p;
  }

  const a = f.action;
  if (a && a.move) {
    const mv = MOVES[a.move];
    const reach = mv && CLIP_REACH[mv.clip];
    if (mv && mv.limb && reach) {
      const k = a.t < a.startup ? ease(a.t / Math.max(1, a.startup))
        : a.t < a.startup + a.active ? 1
        : 1 - ease((a.t - a.startup - a.active) / Math.max(1, a.recovery));
      const tgt = p[mv.limb];
      tgt.x = lerp(tgt.x, reach.tip / PX_PER_M, k);
      tgt.y = lerp(tgt.y, -reach.y / PX_PER_M, k);
      if (mv.limb.startsWith('hand')) { const el = p[mv.limb.replace('hand', 'elbow')]; el.x = lerp(el.x, reach.tip / PX_PER_M * 0.55, k); }
      else if (mv.limb.startsWith('foot')) { const kn = p[mv.limb.replace('foot', 'knee')]; kn.x = lerp(kn.x, reach.tip / PX_PER_M * 0.5, k); }
    }
  }
  return p;
}
