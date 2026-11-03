// Geometry3D: peleadores en el plano XZ del mundo con yaw, ring circular de radio `cage` (px de sim), distancia 3D ancla–ancla,
// cápsulas de daño y posiciones de hueso tomadas de un Skeleton3D del contrato (HUMAN_BONES).
//
// Unidades (contracts v0.2): la SIM sigue en px de KAGE (PX_PER_M = 85 px/m, ring ±260 px). Skeleton3D, raíz, huesos y cápsulas
// SALEN en METROS ([x,y,z], y arriba); el mundo (chunks, CombatEvent.point) es en BLOQUES: 1 bloque = BLOCK_M (contracts) metros.
// La conversión metros<->bloques vive sólo aquí (`toBlocks`/`fromBlocks`) y en events.js (point). `spec.origin` ([x,y,z] BLOQUES del
// mundo) ubica el centro del ring en el mundo: se suma sólo a las SALIDAS, la sim no lo ve.
//
// Estado propio del adaptador por peleador (el núcleo no lo toca): f.pos = {x,y,z} (px; y = 0, suelo), f.heading (rad, interno).
//   yaw (contrato) = -heading;  Adelante(f) = (cos h, sin h) en (x, z) = headingDir(yaw) = (cos yaw, 0, -sin yaw) de contracts.
//
// DETERMINISMO: la sim sólo usa pos/heading (raíz). Los huesos/cápsulas/contactPoint vienen de la pose (provider o procedural)
// y son SÓLO LECTURA: nunca vuelven a pos/heading ni a eventos. La animación no puede cambiar el resultado. Un esqueleto de provider
// en espacio mundo se RE-ANCLA a la raíz de la sim (rotación + traslación rígidas): la raíz de la animación no manda nunca.
//
// Provider: opts.skeleton = (fighter, F) => Skeleton3D | null. Si es null/ausente: HUMAN_BONES + proceduralPose (sin animación externa).
import { BLOCK_M, headingDir } from '../shared/contracts.js';
import { PX_PER_M } from './data/moves.js';
import { HUMAN_PARENT, ZONE_OF, proceduralPose } from './pose.js';

export { BLOCK_M, headingDir };
/** Ángulo normalizado a (-π, π]. */
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** yaw (contrato, headingDir) <-> heading (interno de la sim, antihorario en x,z): mismo valor con signo opuesto. */
export const yawFromHeading = (h) => wrap(-h);
export const headingFromYaw = (y) => wrap(-y);

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
 * @param {{ skeleton?:Function, boneMap?:Record<string,string>, origin?:[number,number,number] }} [spec]
 */
export function createGeometry3D(opt, spec = {}) {
  const cage = opt.cage;
  const org = (spec.origin ?? [0, 0, 0]).map((v) => v * BLOCK_M);        // origen del ring en el mundo, en metros
  const toM = (p) => [org[0] + p.x / PX_PER_M, org[1] + p.y / PX_PER_M, org[2] + p.z / PX_PER_M];   // px (sim) -> [x,y,z] metros
  const toBlocks = (m) => [m[0] / BLOCK_M, m[1] / BLOCK_M, m[2] / BLOCK_M];   // metros -> bloques (mundo)
  const fromBlocks = (b) => [b[0] * BLOCK_M, b[1] * BLOCK_M, b[2] * BLOCK_M];
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

  const vec = (p) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] ?? 0 } : { x: p.x, y: p.y, z: p.z ?? 0 });
  /** Skeleton3D (contrato) actual del peleador: pose en MUNDO y METROS, SIEMPRE con la raíz de la sim. */
  function skeletonOf(f) {
    const sk = spec.skeleton ? spec.skeleton(f, geo.F) : null;
    const root = { pos: toM(f.pos), yaw: yawFromHeading(f.heading) };
    const c = Math.cos(f.heading), s = Math.sin(f.heading);
    const rb = { x: root.pos[0], y: root.pos[1], z: root.pos[2] };
    const out = {};
    if (!sk) {                       // por defecto: pose local en METROS -> mundo en metros
      const loc = proceduralPose(geo.F, f);
      for (const [name, p] of Object.entries(loc)) {
        const lx = p.x, ly = p.y, lz = p.z;
        out[name] = [rb.x + lx * c - lz * s, rb.y + ly, rb.z + lx * s + lz * c];
      }
      return { bones: Object.keys(HUMAN_PARENT), parent: HUMAN_PARENT, root, visualYaw: root.yaw, pose: out };
    }
    const names = sk.bones.map((b) => (typeof b === 'string' ? b : b.name));
    const parent = Array.isArray(sk.bones) && typeof sk.bones[0] === 'object' ? Object.fromEntries(sk.bones.map((b) => [b.name, b.parent ?? null])) : sk.parent;
    if ((sk.space ?? 'world') === 'local') {            // metros locales (+x adelante, y arriba, z derecha)
      for (const n of names) {
        const p = sk.pose[n]; if (!p) continue; const v = vec(p);
        const lx = v.x, ly = v.y, lz = v.z;
        out[n] = [rb.x + lx * c - lz * s, rb.y + ly, rb.z + lx * s + lz * c];
      }
    } else {                                            // mundo (metros): re-anclar la raíz del provider a la de la sim
      const r0 = sk.root?.pos ? vec(sk.root.pos) : null;
      const dh = r0 && sk.root.yaw != null ? f.heading - headingFromYaw(sk.root.yaw) : 0;
      const cd = Math.cos(dh), sd = Math.sin(dh);
      for (const n of names) {
        const p = sk.pose[n]; if (!p) continue; const v = vec(p);
        if (!r0) { out[n] = [v.x, v.y, v.z]; continue; }
        const dx = v.x - r0.x, dz = v.z - r0.z;
        out[n] = [rb.x + dx * cd - dz * sd, v.y - r0.y + rb.y, rb.z + dx * sd + dz * cd];
      }
    }
    return { bones: names, parent, root, visualYaw: root.yaw, pose: out };
  }

  const geo = {
    kind: '3d',
    units: 'm', toBlocks, fromBlocks,
    bind(F) { geo.F = F; },

    place(A, B, startGap) {
      A.pos = { x: -startGap / 2, y: 0, z: 0 }; B.pos = { x: startGap / 2, y: 0, z: 0 };
      A.heading = 0; B.heading = Math.PI;
    },
    facingSign: () => 1,
    faceEachOther(A, B) { face(A, B); face(B, A); },
    axisX: (f) => f.pos.x,
    tickExtras: (f) => ({ pos: toM(f.pos).map((v) => Math.round(v * 1e3) / 1e3), yaw: Math.round(yawFromHeading(f.heading) * 1e4) / 1e4 }), // = root del contrato: metros / rad

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

    // ---- lectura (presentación): METROS, arrays [x,y,z] (igual que Skeleton3D) ----
    skeletonOf,
    boneWorldPos(f, joint) {
      const sk = skeletonOf(f);
      const p = sk.pose[boneName(joint)];
      if (!p) throw new Error('boneWorldPos: hueso sin pose ' + joint);
      return p;
    },
    /** Cápsulas entre cada hueso y su padre (parent del esqueleto): { a:[x,y,z], b:[x,y,z], radius (m), zone, bones }. */
    hurtboxes(f) {
      const sk = skeletonOf(f);
      const out = [];
      for (const name of sk.bones) {
        const z = ZONE_OF[kageName(name)];
        const par = sk.parent[name];
        if (!z || !par || !sk.pose[name] || !sk.pose[par]) continue;
        out.push({ a: sk.pose[par], b: sk.pose[name], radius: z[1], zone: z[0], bones: [par, name] });
      }
      return out;
    },
    /** Punto de contacto aproximado ([x,y,z] metros): de la articulación atacante al punto más cercano de las cápsulas de la zona objetivo. */
    contactPoint(attacker, defender, move) {
      if (!move || !move.limb) return null;
      const tip = vec(geo.boneWorldPos(attacker, move.limb));
      let best = null, bd = Infinity;
      for (const c of geo.hurtboxes(defender)) {
        if (move.zone && c.zone !== move.zone) continue;
        const q = closestOnSegment(tip, vec(c.a), vec(c.b));
        const d = Math.hypot(q.x - tip.x, q.y - tip.y, q.z - tip.z);
        if (d < bd) { bd = d; best = q; }
      }
      return best && [best.x, best.y, best.z];
    },
  };
  return geo;
}
