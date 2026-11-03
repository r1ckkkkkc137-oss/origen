// ik.js — IK analítica de 2 huesos en 3D con vector polo (dirección de rodilla/codo). Puro, sin alocar si se pasa `out`.
//  solveTwoBone(root, target, l1, l2, pole, out?) -> { mid, end, reached, clamped, d, bend }
//  - Las longitudes nunca se estiran: |mid-root| = l1 y |end-mid| = l2 (error ~1e-16).
//  - El alcance se clampa a [|l1-l2|+eps, (l1+l2)*MAX_REACH]; si el objetivo está fuera, `end` queda sobre la línea
//    root->target a distancia máxima (reached=false). Alcanzable => end == target (error < 1e-9 m).
//  - pole: el codo/rodilla va hacia el lado del polo (componente del polo perpendicular al eje root->target).
//    Si el polo es colineal con el eje (degenerado) se usa `prevBend` (continuidad) o una perpendicular estable.
import { norm, cross, dot, len } from './math3.js';

export const MAX_REACH = 0.9995;

export function makeIKOut() { return { mid: [0, 0, 0], end: [0, 0, 0], reached: true, clamped: false, d: 0, bend: [0, 0, 1] }; }

export function solveTwoBone(root, target, l1, l2, pole, out = makeIKOut(), prevBend = null) {
  let dx = target[0] - root[0], dy = target[1] - root[1], dz = target[2] - root[2];
  let d = Math.hypot(dx, dy, dz);
  const maxD = (l1 + l2) * MAX_REACH, minD = Math.abs(l1 - l2) + 1e-3;
  let ux, uy, uz;
  if (d < 1e-9) { ux = pole[0]; uy = pole[1]; uz = pole[2]; const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l; }
  else { ux = dx / d; uy = dy / d; uz = dz / d; }
  const reached = d <= maxD && d >= minD;
  const dc = d < minD ? minD : d > maxD ? maxD : d;
  // perpendicular del polo al eje
  const pd = pole[0] * ux + pole[1] * uy + pole[2] * uz;
  let nx = pole[0] - ux * pd, ny = pole[1] - uy * pd, nz = pole[2] - uz * pd;
  let nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-4 * (Math.hypot(pole[0], pole[1], pole[2]) || 1)) {
    if (prevBend) { const pb = prevBend[0] * ux + prevBend[1] * uy + prevBend[2] * uz; nx = prevBend[0] - ux * pb; ny = prevBend[1] - uy * pb; nz = prevBend[2] - uz * pb; nl = Math.hypot(nx, ny, nz); }
    if (nl < 1e-6) { // eje de referencia estable
      const rx = Math.abs(uy) < 0.9 ? 0 : 1, ry = Math.abs(uy) < 0.9 ? 1 : 0;
      nx = ry * uz; ny = -(rx * uz - 0 * ux); nz = rx * uy - ry * ux; // cross(r, u)
      nl = Math.hypot(nx, ny, nz) || 1;
    }
  }
  nx /= nl; ny /= nl; nz /= nl;
  let c = (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc);
  c = c < -1 ? -1 : c > 1 ? 1 : c;
  const along = l1 * c, h = l1 * Math.sqrt(Math.max(0, 1 - c * c));
  out.mid[0] = root[0] + ux * along + nx * h; out.mid[1] = root[1] + uy * along + ny * h; out.mid[2] = root[2] + uz * along + nz * h;
  out.end[0] = root[0] + ux * dc; out.end[1] = root[1] + uy * dc; out.end[2] = root[2] + uz * dc;
  out.reached = reached; out.clamped = !reached; out.d = dc;
  out.bend[0] = nx; out.bend[1] = ny; out.bend[2] = nz;
  return out;
}

// ángulo interior de la articulación (rad): pi = recto
export function jointAngle(l1, l2, d) {
  const c = (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2);
  return Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
}
