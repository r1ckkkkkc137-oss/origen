// clips.js — canales de pose, guardia base, capas procedurales (idle, caminar) y clips por keyframes (jab).
//
// Todo se expresa en CANALES escalares (como el descriptor de KAGE): mezclar = interpolar canales => sin saltos.
// Unidades: metros y radianes. Marco de las manos: "marco de cara" = yaw del personaje (sin torsión del pecho),
// relativo al hombro correspondiente; así la torsión de cadera/pecho mueve el hombro (cadena cinética) sin desviar el golpe.
//   dy: agacharse (m, + = cadera más alta)   px,pz: desplazamiento de pelvis (m, marco de cara; x izq, z adelante)
//   hipYaw/Roll/Pitch: pelvis (rad; yaw - = hombro izq. adelante)   sp*: pecho vs pelvis   hd*: cabeza vs pecho
//   shrugL/R: hombro arriba   protL/R: hombro hacia adelante   h{L,R}{x,y,z}: muñeca vs hombro   elbL/R: codo hacia afuera
import { getEase, clamp, TAU } from './math3.js';

export const CHANNELS = [
  'dy', 'px', 'pz', 'hipYaw', 'hipRoll', 'hipPitch', 'spYaw', 'spPitch', 'spRoll', 'hdYaw', 'hdPitch', 'hdRoll',
  'shrugL', 'shrugR', 'protL', 'protR', 'hLx', 'hLy', 'hLz', 'hRx', 'hRy', 'hRz', 'elbL', 'elbR',
];

// Guardia MMA ortodoxa (izquierda adelante): cuerpo en ~30° de blade, mentón bajo, manos altas, codos pegados.
export const GUARD = Object.freeze({
  dy: 0, px: 0, pz: 0, hipYaw: -0.50, hipRoll: 0, hipPitch: 0.04, spYaw: 0.12, spPitch: 0.10, spRoll: 0, hdYaw: 0.34, hdPitch: 0.12, hdRoll: 0,
  shrugL: 0.06, shrugR: 0.06, protL: 0.05, protR: 0.0,
  hLx: -0.06, hLy: 0.07, hLz: 0.30, hRx: 0.07, hRy: 0.10, hRz: 0.17, elbL: 0.0, elbR: 0.0,
});

export const makeChannels = (src = null) => { const o = {}; for (const c of CHANNELS) o[c] = src ? src[c] : 0; return o; };

// ------------------------------------------------------------------ capas procedurales
// Idle: respiración + rebote de guardia + cambios de peso, todo sembrado (rng) y determinista.
export function makeIdleParams(rand) {
  return {
    breathRate: 0.30 + rand() * 0.08, breathPh: rand() * TAU,
    bounceRate: 1.6 + rand() * 0.3, bouncePh: rand() * TAU,
    swayRate: 0.17 + rand() * 0.08, swayPh: rand() * TAU, swayRate2: 0.11 + rand() * 0.05, swayPh2: rand() * TAU,
  };
}
export function idleLayer(t, p, amt, out) {
  const br = Math.sin(TAU * p.breathRate * t + p.breathPh);            // respiración
  const bn = Math.sin(TAU * p.bounceRate * t + p.bouncePh);            // rebote de pelea
  const sw = Math.sin(TAU * p.swayRate * t + p.swayPh) * 0.7 + Math.sin(TAU * p.swayRate2 * t + p.swayPh2) * 0.3;  // peso
  out.spPitch += 0.014 * br * amt; out.shrugL += 0.010 * br * amt; out.shrugR += 0.010 * br * amt;
  out.hLy += 0.004 * br * amt; out.hRy += 0.004 * br * amt;
  out.dy += (-0.010 * (bn * 0.5 + 0.5) - 0.004 * br) * amt;
  out.pz += 0.018 * sw * amt;                                           // peso adelante/atrás entre ambos pies
  out.px += 0.012 * Math.sin(TAU * p.swayRate * 1.3 * t + p.swayPh2) * amt;
  out.hipRoll += 0.012 * sw * amt; out.hdRoll += -0.01 * sw * amt;
}

// Caminar (capa sobre la guardia): contrabalanceo de brazos, giro de pelvis/pecho, inclinación. g ∈ [-1,1] = señal de paso
// (+ cuando el pie izquierdo está en el aire, - el derecho), amt = intensidad (0..1) ligada a la velocidad.
// La guardia se mantiene arriba: los brazos solo oscilan unos 3 cm y la mano atrasada ni se mueve de la cara.
export function walkLayer(g, amt, fwdSpeed, out) {
  out.hLz += 0.035 * -g * amt; out.hRz += 0.035 * g * amt;
  out.hLy += 0.012 * Math.abs(g) * amt; out.hRy += 0.012 * Math.abs(g) * amt;
  out.hipYaw += -0.10 * g * amt;                // la cadera acompaña la pierna que avanza
  out.spYaw += 0.07 * g * amt;                  // el pecho contra-rota
  out.hipRoll += 0.035 * g * amt; out.spRoll += -0.03 * g * amt;
  out.spPitch += 0.05 * clamp(fwdSpeed, -1, 1.4) * amt;  // inclinación al avanzar
  out.dy += -0.006 * amt;
}

// ------------------------------------------------------------------ clips por keyframes (deltas respecto a la guardia/base)
// clip = { name, duration, tracks:{canal:[[t, valor, ease?], ...]}, phases:[{name,t0,t1}], impactT, tip:'L'|'R' }
// Todas las pistas arrancan y terminan en 0 => el clip se mezcla con cualquier base sin saltos.
// JAB con cadena cinética: 1) anticipación: se hunde el peso y la cadera se carga hacia atrás; 2) la CADERA rota primero,
// 3) el PECHO/hombro la sigue ~25 ms después, 4) el puño sale ÚLTIMO (extensión rápida, snap) y llega al impacto con
// el brazo casi recto; 5) retracción rápida por la misma línea mientras el cuerpo aún está adelante; 6) retorno con overshoot leve.
const K = (t, v, e = 'easeInOutQuad') => [t, v, e];
export const JAB = {
  name: 'jab', duration: 0.46, impactT: 0.152, tip: 'L',
  phases: [
    { name: 'anticipation', t0: 0, t1: 0.085 },
    { name: 'strike', t0: 0.085, t1: 0.175 },     // activo (hitbox)
    { name: 'recovery', t0: 0.175, t1: 0.46 },
  ],
  tracks: {
    dy:      [K(0, 0), K(0.06, -0.030, 'easeOutQuad'), K(0.15, -0.022), K(0.30, -0.006), K(0.46, 0)],
    pz:      [K(0, 0), K(0.05, -0.020), K(0.15, 0.070, 'easeOutCubic'), K(0.20, 0.070), K(0.34, 0.012), K(0.46, 0)],   // peso al pie adelantado
    px:      [K(0, 0), K(0.15, 0.020, 'easeOutQuad'), K(0.46, 0)],
    hipYaw:  [K(0, 0), K(0.045, 0.07, 'easeOutQuad'), K(0.120, -0.30, 'easeInOutQuad'), K(0.17, -0.31), K(0.30, -0.05), K(0.36, 0.025), K(0.46, 0)],
    hipRoll: [K(0, 0), K(0.12, -0.04), K(0.30, 0), K(0.46, 0)],
    spYaw:   [K(0, 0), K(0.06, 0.04, 'easeOutQuad'), K(0.145, -0.36, 'easeInOutQuad'), K(0.19, -0.37), K(0.32, -0.04), K(0.38, 0.02), K(0.46, 0)],
    spPitch: [K(0, 0), K(0.06, -0.03), K(0.15, 0.11, 'easeOutQuad'), K(0.30, 0.03), K(0.46, 0)],
    spRoll:  [K(0, 0), K(0.15, 0.05), K(0.46, 0)],
    hdPitch: [K(0, 0), K(0.14, 0.07, 'easeOutQuad'), K(0.32, 0.01), K(0.46, 0)],
    hdYaw:   [K(0, 0), K(0.16, 0.20, 'easeInOutQuad'), K(0.34, 0.02), K(0.46, 0)],   // la cabeza sigue mirando al objetivo
    shrugL:  [K(0, 0), K(0.13, 0.05, 'easeOutQuad'), K(0.28, 0.01), K(0.46, 0)],     // hombro al mentón
    protL:   [K(0, 0), K(0.15, 0.07, 'easeOutQuad'), K(0.30, 0.01), K(0.46, 0)],     // escápula adelante
    // puño: sale último
    hLz: [K(0, 0), K(0.050, -0.030, 'easeOutQuad'), K(0.095, 0.060, 'easeInQuad'), K(0.152, 0.265, 'easeOutCubic'), K(0.175, 0.265, 'linear'), K(0.230, 0.01, 'easeOutQuad'), K(0.31, -0.005), K(0.46, 0)],
    hLx: [K(0, 0), K(0.152, -0.055, 'easeOutQuad'), K(0.175, -0.055, 'linear'), K(0.23, 0, 'easeOutQuad'), K(0.46, 0)],
    hLy: [K(0, 0), K(0.050, 0.010), K(0.152, 0.005), K(0.23, 0), K(0.46, 0)],
    elbL: [K(0, 0), K(0.06, 0.2), K(0.15, 0.0), K(0.46, 0)],
    // mano trasera: sube a proteger el mentón con ligero acompañamiento
    hRy: [K(0, 0), K(0.15, 0.025, 'easeOutQuad'), K(0.34, 0.005), K(0.46, 0)],
    hRz: [K(0, 0), K(0.15, 0.030, 'easeOutQuad'), K(0.34, 0.003), K(0.46, 0)],
    hRx: [K(0, 0), K(0.15, -0.020, 'easeOutQuad'), K(0.34, 0), K(0.46, 0)],
  },
};
export const CLIPS = { jab: JAB };

export function sampleTrack(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b[0]) {
      const a = keys[i - 1], u = (t - a[0]) / (b[0] - a[0] || 1);
      return a[1] + (b[1] - a[1]) * getEase(b[2])(u);
    }
  }
  return keys[keys.length - 1][1];
}
// Suma (w * delta) del clip a `out`.
export function addClip(clip, t, w, out) {
  for (const c in clip.tracks) out[c] += w * sampleTrack(clip.tracks[c], t);
}
export function phaseAt(clip, t) {
  for (const p of clip.phases) if (t < p.t1) return p.name;
  return clip.phases[clip.phases.length - 1].name;
}
