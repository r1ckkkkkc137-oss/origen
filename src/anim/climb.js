// climb.js — TREPAR un saliente (1 m = 2 bloques): clip dedicado "climb".
//
// El sim sigue siendo dueño de la raíz (sin root motion de vuelta): durante el trepado sube la raíz por la trayectoria
// `climbPathAt(info, t)` (adelante+arriba, suave) y termina de pie sobre el saliente (A.climbInfo.endRoot). El animador:
//   1) detecta el saliente con el muestreador de terreno (distancia a la pared + altura) al empezar el clip;
//   2) dibuja manos / pies / pelvis ANCLADOS EN EL MUNDO a ese saliente (marco de pared: u = hacia la pared desde la raíz inicial,
//      v = izquierda, y = altura sobre la raíz inicial), mezclados con la pose normal al entrar y al salir (sin saltos);
//   3) lo que el sim haga con la raíz solo importa al final (mezcla 0.4 s hacia la pose normal sobre la raíz).
// Línea de tiempo (s):  0-.30 se acerca y se aferra al borde · .30-.80 tira (pie contra la pared) · .80-1.15 rodilla alta al borde
//   · 1.15-1.55 empuja con los brazos (flexiones) y se sube · 1.45-1.75 suelta las manos y se endereza · hasta 1.95 vuelve a guardia.
import { clamp } from './math3.js';
import { CLIPS } from './clips.js';

const K = (t, v, e = 'easeInOutQuad') => [t, v, e];
export const CLIMB_T = 1.95;

// Hermite/Catmull-Rom no uniforme sobre filas [t, a, b, c, ...] (velocidad continua → sin saltos de velocidad en los empalmes)
function sampleW(rows, t) {                       // pesos: interpolación monótona (smoothstep por tramo), sin sobreimpulso
  const n = rows.length;
  if (t <= rows[0][0]) return [rows[0][1]];
  if (t >= rows[n - 1][0]) return [rows[n - 1][1]];
  let i = 0; while (rows[i + 1][0] < t) i++;
  const u = (t - rows[i][0]) / (rows[i + 1][0] - rows[i][0]);
  return [rows[i][1] + (rows[i + 1][1] - rows[i][1]) * u * u * (3 - 2 * u)];
}
function sampleRows(rows, t) {
  const n = rows.length, nv = rows[0].length - 1;
  if (t <= rows[0][0]) return rows[0].slice(1);
  if (t >= rows[n - 1][0]) return rows[n - 1].slice(1);
  let i = 0; while (rows[i + 1][0] < t) i++;
  const r0 = rows[i], r1 = rows[i + 1], h = r1[0] - r0[0], u = (t - r0[0]) / h, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const out = new Array(nv);
  for (let k = 1; k <= nv; k++) {
    const slope = (a, b) => (b[k] - a[k]) / (b[0] - a[0]);
    const m0 = i > 0 ? 0.5 * (slope(rows[i - 1], r0) + slope(r0, r1)) : 0;
    const m1 = i + 2 < n ? 0.5 * (slope(r0, r1) + slope(r1, rows[i + 2])) : 0;
    out[k - 1] = h00 * r0[k] + h10 * h * m0 + h01 * r1[k] + h11 * h * m1;
  }
  return out;
}
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => smooth((t - a) / (b - a));

// Detecta el saliente delante de la raíz. root = [x,y,z] interno, yaw visual. opts.dist / opts.height lo fuerzan.
export function planClimb(top, root, yaw, opts = {}) {
  const F = [Math.sin(yaw), Math.cos(yaw)], at = (d) => top(root[0] + F[0] * d, root[2] + F[1] * d, root[1] + 0.9) - root[1];
  let dist = opts.dist, height = opts.height;
  if (dist === undefined) {
    let lo = 0, hi = -1;
    for (let d = 0.05; d <= 1.3; d += 0.025) if (at(d) >= 0.45) { hi = d; break; }
    if (hi > 0) { lo = hi - 0.025; for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (at(m) >= 0.45) hi = m; else lo = m; } dist = hi; }
    else dist = 0.42;
  }
  if (height === undefined) { const h = at(dist + 0.12); height = h >= 0.45 ? h : 1.0; }
  return { dist: clamp(dist, 0.25, 1.2), height: clamp(height, 0.45, 1.5), T: CLIMB_T };
}

// Trayectoria de raíz que debe seguir el sim: adelante (m) y arriba (m) respecto a la raíz inicial, t en s de clip.
export function climbPathAt(info, t) {
  const f = ramp(t, 0.35, 1.75), y = ramp(t, 0.55, 1.65);
  return { fwd: (info.dist + 0.35) * f, up: info.height * y };
}

// Construye las pistas absolutas (marco de pared) a partir del estado inicial. st = { pelvis:[u,y,v], footL:[u,sole,v,yawOff], footR:[...] }
export function buildClimb(info, st) {
  const w = info.dist, H = info.height, fl = st.footL, fr = st.footR, hx = 0.22;
  const hand = (s) => [[0, w - 0.05, 1.15, s * hx], [0.34, w + 0.08, H + 0.03, s * hx], [1.00, w + 0.10, H + 0.03, s * hx], [1.18, w + 0.12, H + 0.06, s * hx], [1.32, w + 0.22, H + 0.22, s * (hx - 0.03)], [1.46, w + 0.38, H + 0.46, s * 0.28], [1.62, w + 0.50, H + 0.75, s * 0.28], [1.80, w + 0.62, H + 1.05, s * 0.26], [1.95, w + 0.70, H + 1.30, s * 0.24]];
  return {
    info,
    pel: [[0, ...st.pelvis], [0.30, w - 0.34, 0.80, 0], [0.62, w - 0.30, 0.96, 0], [0.95, w - 0.20, H + 0.20, 0.03], [1.18, w - 0.10, H + 0.36, 0.0], [1.60, w + 0.24, H + 0.56, 0], [1.95, w + 0.35, H + 0.73, 0]],
    hL: hand(1), hR: hand(-1),
    // pies [t, u, tobillo y, v, pitch(+ punta arriba)]
    fL: [[0, fl[0], fl[1] + 0.08, fl[2], 0], [0.30, fl[0] + 0.08, fl[1] + 0.08, fl[2], 0], [0.58, w - 0.26, 0.55, 0.10, -0.45], [0.88, w - 0.26, 0.58, 0.10, -0.45], [1.15, w - 0.04, H + 0.14, 0.12, -0.35], [1.40, w + 0.22, H + 0.08, 0.10, 0], [1.95, w + 0.22, H + 0.08, 0.10, 0]],
    fR: [[0, fr[0], fr[1] + 0.08, fr[2], 0], [0.30, fr[0] + 0.10, fr[1] + 0.08, fr[2], 0], [0.62, w - 0.28, 0.22, -0.14, -0.45], [0.90, w - 0.28, 0.46, -0.14, -0.45], [1.15, w - 0.28, 0.50, -0.14, -0.45], [1.50, w + 0.04, H + 0.20, -0.16, -0.25], [1.74, w + 0.14, H + 0.08, -0.14, 0], [1.95, w + 0.14, H + 0.08, -0.14, 0]],
    wP: [[0, 0], [0.25, 1], [1.62, 1], [1.95, 0]],
    wH: [[0, 0], [0.04, 0.0], [0.34, 1], [1.55, 1], [1.95, 0]],
    wF: [[0, 1], [1.76, 1], [1.95, 0]],
    yawL: fl[3], yawR: fr[3],
  };
}
// Muestra en el instante s -> { wP,wH,wF, pel:[u,y,v], hL:[u,y,v], hR, fL:[u,y,v,pitch], fR }
export function sampleClimb(C, s) {
  const t = clamp(s, 0, CLIMB_T);
  return { wP: sampleW(C.wP, t)[0], wH: sampleW(C.wH, t)[0], wF: sampleW(C.wF, t)[0], pel: sampleRows(C.pel, t), hL: sampleRows(C.hL, t), hR: sampleRows(C.hR, t),
    fL: sampleRows(C.fL, t), fR: sampleRows(C.fR, t) };
}
// (u,v) del marco de pared -> interno xz. O = origen [x,z]; yaw del frente.
export const wallToXZ = (O, yaw, u, v) => [O[0] + u * Math.sin(yaw) + v * Math.cos(yaw), O[1] + u * Math.cos(yaw) - v * Math.sin(yaw)];
export const xzToWall = (O, yaw, x, z) => { const dx = x - O[0], dz = z - O[1]; return [dx * Math.sin(yaw) + dz * Math.cos(yaw), dx * Math.cos(yaw) - dz * Math.sin(yaw)]; };

// Pistas de tronco (deltas sobre la guardia; arrancan y terminan en 0)
export const CLIMB = {
  name: 'climb', duration: CLIMB_T, impactT: 1.45, tip: 'L', climb: true,
  phases: [{ name: 'grab', t0: 0, t1: 0.30 }, { name: 'pull', t0: 0.30, t1: 0.80 }, { name: 'knee', t0: 0.80, t1: 1.15 }, { name: 'push', t0: 1.15, t1: 1.60 }, { name: 'stand', t0: 1.60, t1: CLIMB_T }],
  tracks: {
    hipYaw: [K(0, 0), K(0.30, 0.50), K(1.45, 0.50), K(1.95, 0)],
    spYaw: [K(0, 0), K(0.30, -0.12), K(1.45, -0.12), K(1.95, 0)],
    hdYaw: [K(0, 0), K(0.30, -0.34), K(1.45, -0.34), K(1.95, 0)],
    hipPitch: [K(0, 0), K(0.30, 0.25), K(0.70, 0.45), K(1.00, 0.55), K(1.30, 0.75), K(1.60, 0.25), K(1.95, 0)],
    spPitch: [K(0, 0), K(0.30, 0.20), K(0.75, 0.30), K(1.25, 0.45), K(1.60, 0.0), K(1.95, 0)],
    hdPitch: [K(0, 0), K(0.30, -0.25), K(1.0, -0.40), K(1.45, -0.20), K(1.95, 0)],
    hipRoll: [K(0, 0), K(0.8, 0), K(1.05, 0.10), K(1.45, -0.06), K(1.95, 0)],
    shrugL: [K(0, 0), K(0.30, 0.12), K(1.2, 0.05), K(1.95, 0)], shrugR: [K(0, 0), K(0.30, 0.12), K(1.2, 0.05), K(1.95, 0)],
  },
};

CLIPS.climb = CLIMB;
