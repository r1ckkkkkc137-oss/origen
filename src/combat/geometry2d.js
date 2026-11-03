// Geometry2D: reproduce EXACTAMENTE la geometría de KAGE (f40b47d): eje 1D `f.x` (px, ring ±cage), `f.facing` ±1, z = 0.
// Las expresiones aritméticas replican el orden original del núcleo para que el resultado sea idéntico bit a bit
// (multiplicar por ±1 es exacto, así que `x + facing*d` y `x - facing*d` coinciden con las formas originales).
// Ver geometry.js para el contrato (JSDoc).
import { JOINTS } from './kage-contracts.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Pose 2D mínima en reposo (px, origen pelvis, +x adelante, +y abajo) sólo para boneWorldPos en 2D sin esqueleto. */
const REST_2D = Object.freeze({
  pelvis: [0, -90], spine: [4, -115], neck: [8, -140], head: [10, -152],
  shoulderL: [8, -138], elbowL: [22, -125], handL: [34, -138],
  shoulderR: [8, -138], elbowR: [18, -122], handR: [30, -136],
  hipL: [0, -90], kneeL: [6, -48], footL: [4, 0], hipR: [0, -90], kneeR: [-4, -48], footR: [-8, 0],
});

export function createGeometry2D(opt) {
  const cage = opt.cage;
  const geo = {
    kind: '2d',
    units: 'px',
    bind(F) { geo.F = F; },

    place(A, B, startGap) {
      A.x = -startGap / 2; B.x = startGap / 2; A.facing = 1; B.facing = -1;
    },
    facingSign: (f) => f.facing,
    faceEachOther(A, B) { A.facing = B.x >= A.x ? 1 : -1; B.facing = -A.facing; },
    axisX: (f) => f.x,
    tickExtras: () => null,

    distance: (a, b) => Math.abs(a.x - b.x),

    moveAlong(f, dx) { f.x = f.x + f.facing * dx; },
    orbit(f, o, px) { f.x += f.facing * px; }, // 1D: orbitar apenas cambia la distancia
    applyKnockback(f, px) { f.x -= f.facing * px; },
    clampToRing(f) { f.x = clamp(f.x, -cage, cage); },
    recenterPair(f, o, mag) { const shift = mag * Math.sign(-f.x); f.x += shift; o.x += shift; },

    wallDistance: (f) => cage - Math.abs(f.x),
    backToWall: (f) => Math.sign(f.x) === -f.facing,
    cornered: (f, thresholdPx) => Math.abs(f.x) >= cage - thresholdPx && Math.sign(f.x) === -f.facing,
    exceedsWall: (f, d, marginPx) => Math.abs(f.x + f.facing * d) > cage - marginPx,

    separate(A, B, minGap) {
      const d = B.x - A.x;
      if (!(Math.abs(d) < minGap)) return;
      const s = d >= 0 ? 1 : -1;
      const push = (minGap - Math.abs(d)) / 2;
      A.x -= s * push; B.x += s * push;
      // contra la reja: el que no puede retroceder no se encima; el otro absorbe todo el empuje
      if (Math.abs(A.x) > cage) { A.x = clamp(A.x, -cage, cage); B.x = A.x + s * minGap; }
      else if (Math.abs(B.x) > cage) { B.x = clamp(B.x, -cage, cage); A.x = B.x - s * minGap; }
    },
    save: (f) => f.x,
    restore(f, snap) { f.x = snap; },
    separateLocked(A, B, minGap, lockA, lockB, snapA, snapB) {
      const d2 = B.x - A.x;
      if (!(Math.abs(d2) < minGap)) return;
      const s2 = d2 >= 0 ? 1 : -1;
      const need = minGap - Math.abs(d2);
      if (lockA && !lockB) B.x = A.x + s2 * minGap;
      else if (lockB && !lockA) A.x = B.x - s2 * minGap;
      else { A.x -= s2 * need / 2; B.x += s2 * need / 2; }
      A.x = clamp(A.x, -cage, cage); B.x = clamp(B.x, -cage, cage);
      if (lockA) A.x = snapA;
      if (lockB) B.x = snapB;
    },
    gather(top, bottom, margin) {
      const mid = clamp((top.x + bottom.x) / 2, -cage + margin, cage - margin);
      bottom.x = mid; top.x = mid - bottom.facing * 0; // mismo punto; el Animador separa visualmente
    },
    standUp(A, B, sepPx) {
      const mid = clamp((A.x + B.x) / 2, -cage + sepPx, cage - sepPx);
      const [L, R] = A.x <= B.x ? [A, B] : [B, A];
      L.x = mid - sepPx / 2; R.x = mid + sepPx / 2;
    },
    clinchPlace(A, B, halfGap) {
      const mid = (A.x + B.x) / 2;
      A.x = mid - A.facing * halfGap; B.x = mid - B.facing * halfGap;
    },

    boneWorldPos(f, bone) {
      let r = REST_2D[bone];
      if (bone === 'chest') r = [(REST_2D.spine[0] + REST_2D.neck[0]) / 2, (REST_2D.spine[1] + REST_2D.neck[1]) / 2]; // HUMAN_BONES.chest: derivado
      else if (!r || !JOINTS.includes(bone)) throw new Error('boneWorldPos: hueso desconocido ' + bone);
      return [f.x + f.facing * r[0], -r[1], 0]; // [x,y,z] en px de KAGE; y de mundo hacia arriba en el adaptador
    },
    hurtboxes: () => [],
    contactPoint: () => null,
  };
  return geo;
}
