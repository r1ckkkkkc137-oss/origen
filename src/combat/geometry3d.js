// Geometry3D (prototipo): peleadores en el plano XZ del mundo con ángulo de heading, ring circular de radio `cage` (px),
// distancia 3D ancla–ancla, cápsulas de daño y posiciones de hueso tomadas de un Skeleton3D.
//
// Estado propio del adaptador por peleador (el núcleo no lo toca): f.pos = {x,y,z} (px; y = 0, altura del suelo), f.heading (rad).
//   adelante(f) = (cos h, sin h) en (x, z).  Lateral derecha = (-sin h, cos h).
//
// DETERMINISMO: la sim sólo usa pos/heading (raíz). Los huesos/cápsulas/contactPoint vienen de la pose (provider o procedural)
// y son SÓLO LECTURA: nunca vuelven a pos/heading ni a eventos. La animación no puede cambiar el resultado.
//
// Provider de esqueleto: opts.skeleton = (fighter, F) => Skeleton3D | null  (ver pose.js para la convención).
// Si no hay provider se usa el esqueleto KAGE por defecto + proceduralPose (sin animación externa).
import { PX_PER_M } from './data/moves.js';
import { KAGE_BONES, ZONE_OF, proceduralPose } from './pose.js';

const r2 = (v) => Math.round(v * 100) / 100;
const EPS = 1e-9;
const fwd = (f) => ({ x: Math.cos(f.heading), z: Math.sin(f.heading) });
const len2 = (x, z) => Math.sqrt(x * x + z * z);

function closestOnSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 < EPS ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t, z: a.z + abz * t };
}

/**
 * @param {{cage:number}} opt
 * @param {{ skeleton?:Function, boneMap?:Record<string,string>, pxPerUnit?:number }} [spec]
 */
export function createGeometry3D(opt, spec = {}) {
  const cage = opt.cage;
  const pxPerUnit = spec.pxPerUnit ?? PX_PER_M;
  const boneMap = spec.boneMap ?? {};                      // joint KAGE -> nombre de hueso del esqueleto externo
  const inv = Object.fromEntries(Object.entries(boneMap).map(([k, v]) => [v, k]));
  const kageName = (bone) => inv[bone] ?? bone;
  const boneName = (joint) => boneMap[joint] ?? joint;

  const clampRing = (p, R = cage) => { const r = len2(p.x, p.z); if (r > R) { const k = R / r; p.x *= k; p.z *= k; } };
  const unitAB = (A, B, fallback) => {
    const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z, l = len2(dx, dz);
    return l < EPS ? fallback : { x: dx / l, z: dz / l };
  };
  const face = (f, toward) => { f.heading = Math.atan2(toward.pos.z - f.pos.z, toward.pos.x - f.pos.x); };

  /** Skeleton3D actual del peleador (provider o procedural). Siempre con la raíz de la SIM. */
  function skeletonOf(f) {
    let sk = spec.skeleton ? spec.skeleton(f, geo.F) : null;
    if (!sk) sk = { bones: KAGE_BONES, pose: proceduralPose(geo.F, f), space: 'local' };
    return { ...sk, root: { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: f.heading } };
  }
  function worldOf(f, sk, p) {
    const k = pxPerUnit;
    if (sk.space === 'world') return { x: p.x * k, y: p.y * k, z: p.z * k };
    const c = Math.cos(f.heading), s = Math.sin(f.heading);
    const lz = p.z ?? 0;
    return { x: f.pos.x + (p.x * c - lz * s) * k, y: f.pos.y + p.y * k, z: f.pos.z + (p.x * s + lz * c) * k };
  }

  const geo = {
    kind: '3d',
    bind(F) { geo.F = F; },

    place(A, B, startGap) {
      A.pos = { x: -startGap / 2, y: 0, z: 0 }; B.pos = { x: startGap / 2, y: 0, z: 0 };
      A.heading = 0; B.heading = Math.PI;
    },
    facingSign: () => 1,
    faceEachOther(A, B) { face(A, B); face(B, A); },
    axisX: (f) => f.pos.x,
    tickExtras: (f) => ({ pos: { x: r2(f.pos.x), y: r2(f.pos.y), z: r2(f.pos.z) }, heading: Math.round(f.heading * 1e4) / 1e4 }),

    distance(a, b) { const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); },

    moveAlong(f, dx) { const u = fwd(f); f.pos.x += u.x * dx; f.pos.z += u.z * dx; },
    applyKnockback(f, px) { const u = fwd(f); f.pos.x -= u.x * px; f.pos.z -= u.z * px; },
    clampToRing(f) { clampRing(f.pos); },
    recenterPair(f, o, mag) {
      const r = len2(f.pos.x, f.pos.z);
      const u = r < EPS ? { x: 0, z: 0 } : { x: -f.pos.x / r, z: -f.pos.z / r };
      f.pos.x += u.x * mag; f.pos.z += u.z * mag; o.pos.x += u.x * mag; o.pos.z += u.z * mag;
    },
    /** Tangencial alrededor del rival (mantiene la distancia a primer orden): px con signo = sentido. */
    orbit(f, o, px) {
      const u = unitAB(f, o, fwd(f));
      const side = { x: -u.z, z: u.x };
      f.pos.x += side.x * px; f.pos.z += side.z * px;
    },

    wallDistance: (f) => cage - len2(f.pos.x, f.pos.z),
    backToWall(f) { const u = fwd(f); return f.pos.x * u.x + f.pos.z * u.z < 0; },
    cornered(f, th) { return len2(f.pos.x, f.pos.z) >= cage - th && geo.backToWall(f); },
    exceedsWall(f, d, margin) { const u = fwd(f); return len2(f.pos.x + u.x * d, f.pos.z + u.z * d) > cage - margin; },

    separate(A, B, minGap) {
      const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z, l = len2(dx, dz);
      if (!(l < minGap)) return;
      const s = l < EPS ? fwd(A) : { x: dx / l, z: dz / l };
      const push = (minGap - l) / 2;
      A.pos.x -= s.x * push; A.pos.z -= s.z * push; B.pos.x += s.x * push; B.pos.z += s.z * push;
      if (len2(A.pos.x, A.pos.z) > cage) { clampRing(A.pos); B.pos.x = A.pos.x + s.x * minGap; B.pos.z = A.pos.z + s.z * minGap; }
      else if (len2(B.pos.x, B.pos.z) > cage) { clampRing(B.pos); A.pos.x = B.pos.x - s.x * minGap; A.pos.z = B.pos.z - s.z * minGap; }
    },
    save: (f) => ({ x: f.pos.x, z: f.pos.z }),
    restore(f, snap) { f.pos.x = snap.x; f.pos.z = snap.z; },
    separateLocked(A, B, minGap, lockA, lockB, snapA, snapB) {
      const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z, l = len2(dx, dz);
      if (!(l < minGap)) return;
      const s = l < EPS ? fwd(A) : { x: dx / l, z: dz / l };
      const need = minGap - l;
      if (lockA && !lockB) { B.pos.x = A.pos.x + s.x * minGap; B.pos.z = A.pos.z + s.z * minGap; }
      else if (lockB && !lockA) { A.pos.x = B.pos.x - s.x * minGap; A.pos.z = B.pos.z - s.z * minGap; }
      else { A.pos.x -= s.x * need / 2; A.pos.z -= s.z * need / 2; B.pos.x += s.x * need / 2; B.pos.z += s.z * need / 2; }
      clampRing(A.pos); clampRing(B.pos);
      if (lockA) geo.restore(A, snapA);
      if (lockB) geo.restore(B, snapB);
    },
    // Suelo/clinch: ambos en el MISMO punto (como KAGE); la pose (tumbado/arriba) reparte el cuerpo visualmente.
    gather(top, bottom, margin) {
      const mid = { x: (top.pos.x + bottom.pos.x) / 2, z: (top.pos.z + bottom.pos.z) / 2 };
      clampRing(mid, cage - margin);
      for (const f of [top, bottom]) { f.pos.x = mid.x; f.pos.z = mid.z; }
    },
    standUp(A, B, sepPx) {
      const mid = { x: (A.pos.x + B.pos.x) / 2, z: (A.pos.z + B.pos.z) / 2 };
      clampRing(mid, cage - sepPx);
      const u = unitAB(A, B, fwd(A));
      A.pos.x = mid.x - u.x * sepPx / 2; A.pos.z = mid.z - u.z * sepPx / 2;
      B.pos.x = mid.x + u.x * sepPx / 2; B.pos.z = mid.z + u.z * sepPx / 2;
      geo.faceEachOther(A, B);
    },
    clinchPlace(A, B, halfGap) {
      const mid = { x: (A.pos.x + B.pos.x) / 2, z: (A.pos.z + B.pos.z) / 2 };
      const ua = fwd(A), ub = fwd(B);
      A.pos.x = mid.x - ua.x * halfGap; A.pos.z = mid.z - ua.z * halfGap;
      B.pos.x = mid.x - ub.x * halfGap; B.pos.z = mid.z - ub.z * halfGap;
    },

    // ---- lectura (presentación) ----
    skeletonOf,
    boneWorldPos(f, joint) {
      const sk = skeletonOf(f);
      const p = sk.pose[boneName(joint)];
      if (!p) throw new Error('boneWorldPos: hueso sin pose ' + joint);
      return worldOf(f, sk, p);
    },
    hurtboxes(f) {
      const sk = skeletonOf(f);
      const out = [];
      for (const b of sk.bones) {
        const name = kageName(b.name);
        const z = ZONE_OF[name];
        if (!z || !b.parent || !sk.pose[b.name] || !sk.pose[b.parent]) continue;
        out.push({ a: worldOf(f, sk, sk.pose[b.parent]), b: worldOf(f, sk, sk.pose[b.name]), radius: z[1] * pxPerUnit, zone: z[0], bones: [b.parent, b.name] });
      }
      return out;
    },
    /** Punto de contacto aproximado: de la articulación atacante al punto más cercano de las cápsulas de la zona objetivo. */
    contactPoint(attacker, defender, move) {
      if (!move || !move.limb) return null;
      const tip = geo.boneWorldPos(attacker, move.limb);
      let best = null, bd = Infinity;
      for (const c of geo.hurtboxes(defender)) {
        if (move.zone && c.zone !== move.zone && !(move.zone === 'legs' && c.zone === 'legs')) continue;
        const q = closestOnSegment(tip, c.a, c.b);
        const d = Math.hypot(q.x - tip.x, q.y - tip.y, q.z - tip.z);
        if (d < bd) { bd = d; best = q; }
      }
      return best;
    },
  };
  return geo;
}
