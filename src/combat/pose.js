// Esqueleto 3D por defecto + pose procedural SIN animación externa, para correr headless (tests, balance, prototipo).
//
// Convención (coordinada con contracts v0.1/v0.2 de Motor; ver README):
//   - Esqueleto = Skeleton3D del contrato: { bones:string[] (HUMAN_BONES), parent:{hueso:padre|null}, root:{pos:[x,y,z], yaw}, pose:{hueso:[x,y,z]} }
//     con root.pos y pose en MUNDO y en METROS (el mundo/CombatEvent.point van en bloques; ver geometry3d.js).
//   - La pose PROCEDURAL por defecto se define en el marco LOCAL del peleador, en METROS: origen = pelvis proyectada al suelo (root),
//     +x = adelante (yaw), +y = ARRIBA, +z = lateral derecha. geometry3d.js la lleva a mundo (rota por heading y suma la raíz).
//   - yaw: contracts headingDir(yaw) = (cos yaw, 0, -sin yaw) (= rotation.y de Three): hacia donde apunta el +x local.
//   - Los 16 joints de KAGE existen con el MISMO nombre en HUMAN_BONES; HUMAN_BONES agrega 'chest' (sin joint KAGE): la pose
//     procedural lo deriva (punto medio spine–neck) y los hurtboxes lo usan como segmento propio.
import { HUMAN_BONES } from '../shared/contracts.js';
import { JOINTS } from './kage-contracts.js';
import { CLIP_REACH, PX_PER_M, MOVES } from './data/moves.js';

/** Padre de cada hueso humano del contrato (jerarquía de 17). */
export const HUMAN_PARENT = Object.freeze({
  pelvis: null, spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', elbowL: 'shoulderL', handL: 'elbowL',
  shoulderR: 'chest', elbowR: 'shoulderR', handR: 'elbowR',
  hipL: 'pelvis', kneeL: 'hipL', footL: 'kneeL',
  hipR: 'pelvis', kneeR: 'hipR', footR: 'kneeR',
});
/** joint de KAGE -> hueso de HUMAN_BONES (identidad: los 16 coinciden por nombre). */
export const KAGE_TO_HUMAN = Object.freeze(Object.fromEntries(JOINTS.map((j) => [j, j])));
/** Huesos de HUMAN_BONES sin joint KAGE equivalente (se derivan). */
export const HUMAN_ONLY = Object.freeze(HUMAN_BONES.filter((b) => !JOINTS.includes(b)));
/** Joints de KAGE sin hueso en HUMAN_BONES (vacío = todos mapean). */
export const KAGE_UNMAPPED = Object.freeze(JOINTS.filter((j) => !HUMAN_BONES.includes(KAGE_TO_HUMAN[j])));

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
  spine: ['body', 0.17], chest: ['body', 0.16], neck: ['body', 0.07], head: ['head', 0.11],
  shoulderL: ['body', 0.06], shoulderR: ['body', 0.06],
  elbowL: ['armL', 0.05], handL: ['armL', 0.04], elbowR: ['armR', 0.05], handR: ['armR', 0.04],
  hipL: ['body', 0.1], hipR: ['body', 0.1],
  kneeL: ['legs', 0.08], footL: ['legs', 0.06], kneeR: ['legs', 0.08], footR: ['legs', 0.06],
});

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
/** Agrega los huesos HUMAN_BONES que KAGE no tiene (chest = punto medio spine–neck). */
function withDerived(p) { p.chest = mid(p.spine, p.neck); return p; }

/** Pose de reposo local en metros (y arriba, z lateral) para los 17 huesos de HUMAN_BONES. */
export function restPose() {
  const p = {};
  for (const j of JOINTS) { const r = REST_PX[j]; p[j] = { x: r[0] / PX_PER_M, y: -r[1] / PX_PER_M, z: r[2] / PX_PER_M }; }
  return withDerived(p);
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
    return withDerived(p);
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
  return withDerived(p);
}
