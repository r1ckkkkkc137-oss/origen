// math3.js — matemática 3D mínima, pura, sin dependencias. Vec3 = [x,y,z], Quat = [x,y,z,w]. Y arriba, metros.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// mínimo suave (polinómico): continuo y con derivada continua
export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

export const add = (a, b, o = [0, 0, 0]) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; };
export const sub = (a, b, o = [0, 0, 0]) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; };
export const scale = (a, s, o = [0, 0, 0]) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; };
export const addScaled = (a, b, s, o = [0, 0, 0]) => { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; };
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b, o = [0, 0, 0]) => {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  o[0] = x; o[1] = y; o[2] = z; return o;
};
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a, o = [0, 0, 0]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o; };
export const copy = (a, o = [0, 0, 0]) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
export const lerp3 = (a, b, t, o = [0, 0, 0]) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };

// ---- cuaterniones [x,y,z,w] ----
export const qIdent = () => [0, 0, 0, 1];
export function qMul(a, b, o = [0, 0, 0, 1]) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  o[0] = aw * bx + ax * bw + ay * bz - az * by;
  o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
  return o;
}
export const qConj = (a, o = [0, 0, 0, 1]) => { o[0] = -a[0]; o[1] = -a[1]; o[2] = -a[2]; o[3] = a[3]; return o; };
export function qNorm(a, o = [0, 0, 0, 1]) {
  const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1; o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; o[3] = a[3] / l; return o;
}
export function qAxisAngle(axis, ang, o = [0, 0, 0, 1]) {
  const s = Math.sin(ang / 2); o[0] = axis[0] * s; o[1] = axis[1] * s; o[2] = axis[2] * s; o[3] = Math.cos(ang / 2); return o;
}
// rotar vector
export function qRot(q, v, o = [0, 0, 0]) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  o[0] = v[0] + w * tx + (y * tz - z * ty);
  o[1] = v[1] + w * ty + (z * tx - x * tz);
  o[2] = v[2] + w * tz + (x * ty - y * tx);
  return o;
}
// yaw (Y) luego pitch (X) luego roll (Z):  q = Ry * Rx * Rz.  pitch + = inclina +Y hacia +Z (hacia adelante).
export function qFromYPR(yaw, pitch, roll, o = [0, 0, 0, 1]) {
  const qy = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], qx = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)], qz = [0, 0, Math.sin(roll / 2), Math.cos(roll / 2)];
  return qMul(qMul(qy, qx), qz, o);
}
export function qFromUnitVectors(a, b, o = [0, 0, 0, 1]) {
  const d = dot(a, b);
  if (d < -0.999999) {
    let ax = cross([1, 0, 0], a); if (len(ax) < 1e-6) ax = cross([0, 1, 0], a);
    norm(ax, ax); return qAxisAngle(ax, Math.PI, o);
  }
  const c = cross(a, b); o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; o[3] = 1 + d; return qNorm(o, o);
}
export function qSlerp(a, b, t, o = [0, 0, 0, 1]) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0, s1;
  if (c > 0.9995) { s0 = 1 - t; s1 = t; } else { const th = Math.acos(c), sn = Math.sin(th); s0 = Math.sin((1 - t) * th) / sn; s1 = Math.sin(t * th) / sn; }
  o[0] = a[0] * s0 + bx * s1; o[1] = a[1] * s0 + by * s1; o[2] = a[2] * s0 + bz * s1; o[3] = a[3] * s0 + bw * s1;
  return qNorm(o, o);
}
// Orientación de un hueso rígido: gira restDir -> dir (swing mínimo) y luego torsiona alrededor de dir para que
// restHint (ya girado) apunte lo más cerca posible de hintNow. Devuelve quat MUNDO relativo a la pose de reposo (identidad).
export function qBone(restDir, restHint, dir, hintNow, o = [0, 0, 0, 1]) {
  const q1 = qFromUnitVectors(restDir, dir);
  const h1 = qRot(q1, restHint);
  const p1 = addScaled(h1, dir, -dot(h1, dir)), p2 = addScaled(hintNow, dir, -dot(hintNow, dir));
  if (len(p1) < 1e-6 || len(p2) < 1e-6) return copyQ(q1, o);
  const ang = Math.atan2(dot(cross(p1, p2), dir), dot(p1, p2));
  return qMul(qAxisAngle(dir, ang), q1, o);
}
export const copyQ = (a, o = [0, 0, 0, 1]) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; o[3] = a[3]; return o; };

// ---- easing (t en [0,1]) ----
export const ease = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  smooth: (t) => t * t * (3 - 2 * t),
};
export const getEase = (n) => (typeof n === 'function' ? n : ease[n] || ease.easeInOutCubic);

// ---- resortes deterministas ----
export const spring = (x = 0) => ({ x, v: 0 });
export function springCritical(s, target, omega, dt) {   // solución analítica exacta (estable con cualquier dt)
  const d = s.x - target, e = Math.exp(-omega * dt), tmp = (s.v + omega * d) * dt;
  s.x = target + (d + tmp) * e; s.v = (s.v - omega * tmp) * e; return s;
}
const SUB = 1 / 240;
export function springDamped(s, target, omega, zeta, dt) {  // sub-pasos fijos: mismo dt => mismo resultado
  let rem = dt;
  while (rem > 1e-9) { const h = rem > SUB ? SUB : rem; s.v += (-2 * zeta * omega * s.v - omega * omega * (s.x - target)) * h; s.x += s.v * h; rem -= h; }
  return s;
}
