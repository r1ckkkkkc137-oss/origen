// Contacto golpe–rival (ronda 6). Funciones puras en el MARCO INTERNO del animador (+Z adelante, +X izquierda; mundo->interno = (-wz, wy, wx)).
// El rival se aproxima con primitivas sacadas de SUS huesos (Skeleton3D mundo): cabeza = esfera, torso = cápsula pelvis->cuello,
// muslos/espinillas = cápsulas. Sin aleatoriedad, sin asignaciones por frame salvo los arrays de colisores (reutilizados).
export const CONTACT = Object.freeze({
  head: 0.105,            // radio de la cabeza (la cara exportada está a 0,11 del centro)
  headC: 0.55,            // centro de la cabeza: head + 0.55·(headTop-head)
  torso: 0.14, torsoBot: 0.06, torsoTop: 0.09,   // cápsula del torso: de pelvis+0,06 a cuello−0,09 (no tapa mentón ni muslos)
  neck: 0.06, shoulders: 0.07,   // cápsula hombro–hombro (trapecios/deltoides)
  thigh: 0.075, shin: 0.055,
  fist: 0.02,             // la punta del puño (nudillos) es la punta de la mano: piel/guante
  shinTip: 0.045,         // la espinilla (30 % desde el tobillo): radio de la pierna
});
const ZONES = ['head', 'body', 'legs', 'legs', 'legs', 'legs', 'head', 'body'];

const I = (w, o) => { o[0] = -w[2]; o[1] = w[1]; o[2] = w[0]; return o; };
const v3 = () => [0, 0, 0];

/** Colisores del rival (marco interno) desde su Skeleton3D mundo. Reutiliza `cols` si se pasa. */
export function buildColliders(sk, cols, prev = null) {
  if (!cols) cols = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ kind: i ? 'cap' : 'sph', zone: ZONES[i], a: v3(), b: v3(), r: 0 }));
  const P = sk.pose, h = cols[0], hb = I(P.head, h.b), ht = I(sk.tips.headTop, v3());
  for (let k = 0; k < 3; k++) h.a[k] = hb[k] + (ht[k] - hb[k]) * CONTACT.headC;
  h.r = CONTACT.head;
  I(P.pelvis, cols[1].a); I(P.neck, cols[1].b); cols[1].a[1] += CONTACT.torsoBot; cols[1].b[1] -= CONTACT.torsoTop; cols[1].r = CONTACT.torso;
  I(P.neck, cols[6].a); I(P.head, cols[6].b); cols[6].r = CONTACT.neck;
  I(P.shoulderL, cols[7].a); I(P.shoulderR, cols[7].b); cols[7].r = CONTACT.shoulders;
  I(P.hipL, cols[2].a); I(P.kneeL, cols[2].b); cols[2].r = CONTACT.thigh;
  I(P.hipR, cols[3].a); I(P.kneeR, cols[3].b); cols[3].r = CONTACT.thigh;
  I(P.kneeL, cols[4].a); I(P.footL, cols[4].b); cols[4].r = CONTACT.shin;
  I(P.kneeR, cols[5].a); I(P.footR, cols[5].b); cols[5].r = CONTACT.shin;
  return cols;
}
/** Extrapola un frame (el rival se actualiza DESPUÉS en el mismo tick): cols += cols - prev. prev se reescribe con la pose leída. */
export function extrapolate(cols, prev, k = 1) {
  for (let i = 0; i < cols.length; i++) for (const e of ['a', 'b']) for (let j = 0; j < 3; j++) {
    const v = cols[i][e][j], d = v - prev[i][e][j]; prev[i][e][j] = v; cols[i][e][j] = v + d * k;
  }
  return cols;
}

/** Punto del eje más cercano a p: devuelve el parámetro u (0..1; esfera: 0). */
export function axisU(c, p) {
  if (c.kind === 'sph') return 0;
  const ax = c.b[0] - c.a[0], ay = c.b[1] - c.a[1], az = c.b[2] - c.a[2], L2 = ax * ax + ay * ay + az * az || 1;
  const u = ((p[0] - c.a[0]) * ax + (p[1] - c.a[1]) * ay + (p[2] - c.a[2]) * az) / L2;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}
export function axisAt(c, u, o) {
  if (c.kind === 'sph') { o[0] = c.a[0]; o[1] = c.a[1]; o[2] = c.a[2]; return o; }
  for (let k = 0; k < 3; k++) o[k] = c.a[k] + (c.b[k] - c.a[k]) * u;
  return o;
}
const _q = v3();
/** Distancia firmada de p a la superficie de c (negativa = dentro). */
export function sdist(c, p) { axisAt(c, axisU(c, p), _q); return Math.hypot(p[0] - _q[0], p[1] - _q[1], p[2] - _q[2]) - c.r; }

/** Penetración máxima de una punta de radio rt: { pen (>0 dentro), i }. */
export function penetration(cols, p, rt) {
  let pen = -Infinity, i = -1;
  for (let k = 0; k < cols.length; k++) { const d = rt - sdist(cols[k], p); if (d > pen) { pen = d; i = k; } }
  return { pen, i };
}

const _p = v3();
const at = (O, T, s, o) => { o[0] = O[0] + (T[0] - O[0]) * s; o[1] = O[1] + (T[1] - O[1]) * s; o[2] = O[2] + (T[2] - O[2]) * s; return o; };
const fmin = (cols, p, rt) => { let m = Infinity; for (const c of cols) { const d = sdist(c, p) - rt; if (d < m) m = d; } return m; };

/**
 * Si la punta T (radio rt) está dentro de algún colisor, devuelve el PRIMER punto de contacto a lo largo del rayo O->T
 * (O = hombro o cadera): { point, i, s }. Si no penetra: null. Si O ya está dentro, empuja T fuera por la normal.
 */
export function firstContact(cols, O, T, rt, out) {
  if (fmin(cols, T, rt) >= 0) {                                           // la punta está fuera: ¿la atravesó? (barrido del rayo O->T, anti-túnel)
    let hit = false; for (let k = 1; k < 24; k++) if (fmin(cols, at(O, T, k / 24, _p), rt) < 0) { hit = true; break; }
    if (!hit) return null;
  }
  out = out || v3();
  if (fmin(cols, O, rt) < 0) { const r = penetration(cols, T, rt); out[0] = T[0]; out[1] = T[1]; out[2] = T[2]; pushOut(cols, out, rt); return { point: out, i: r.i, s: 1 }; }
  const N = 24; let lo = 0, hi = 1;
  for (let k = 1; k <= N; k++) { const s = k / N; if (fmin(cols, at(O, T, s, _p), rt) < 0) { hi = s; lo = (k - 1) / N; break; } }
  for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (fmin(cols, at(O, T, m, _p), rt) < 0) hi = m; else lo = m; }
  at(O, T, lo, out);
  let bi = 0, bd = Infinity; for (let k = 0; k < cols.length; k++) { const d = sdist(cols[k], out); if (d < bd) { bd = d; bi = k; } }
  return { point: out, i: bi, s: lo };
}

/** Penetración máxima del SEGMENTO O->T (radio rt) en cualquier colisor (0 si no lo toca). Un puño que atravesó la cabeza da ~R. */
export function segPenetration(cols, O, T, rt, N = 24) {
  let m = 0; const p = [0, 0, 0];
  for (let k = 0; k <= N; k++) { at(O, T, k / N, p); for (const c of cols) { const d = rt - sdist(c, p); if (d > m) m = d; } }
  return m;
}
/** Profundidad del golpe "a través" del rival: distancia de la punta al primer contacto en el rayo O->T (0 si no lo toca). */
export function tunnelDepth(cols, O, T, rt) {
  const fc = firstContact(cols, O, T, rt, [0, 0, 0]);
  return fc ? Math.hypot(T[0] - fc.point[0], T[1] - fc.point[1], T[2] - fc.point[2]) : 0;
}

/** Saca p de todos los colisores por la normal (proyección a la superficie + rt). Devuelve cuánto lo movió. */
export function pushOut(cols, p, rt) {
  let moved = 0;
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (const c of cols) {
      axisAt(c, axisU(c, p), _q);
      const dx = p[0] - _q[0], dy = p[1] - _q[1], dz = p[2] - _q[2], d = Math.hypot(dx, dy, dz), R = c.r + rt;
      if (d < R - 1e-6) { const k = d > 1e-6 ? R / d : 0; const nx = d > 1e-6 ? _q[0] + dx * k : _q[0], ny = d > 1e-6 ? _q[1] + dy * k : _q[1] + R, nz = d > 1e-6 ? _q[2] + dz * k : _q[2];
        moved += Math.hypot(nx - p[0], ny - p[1], nz - p[2]); p[0] = nx; p[1] = ny; p[2] = nz; any = true; }
    }
    if (!any) break;
  }
  return moved;
}

/** Lleva p a la superficie de c a distancia rs del eje (hacia dentro o fuera), por la normal. */
export function pushIn(c, p, rs) {
  axisAt(c, axisU(c, p), _q);
  const dx = p[0] - _q[0], dy = p[1] - _q[1], dz = p[2] - _q[2], d = Math.hypot(dx, dy, dz) || 1, R = c.r + rs;
  p[0] = _q[0] + dx / d * R; p[1] = _q[1] + dy / d * R; p[2] = _q[2] + dz / d * R; return p;
}
