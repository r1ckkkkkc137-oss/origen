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
  'elvL', 'elvR',                                                   // elevación del codo (0 = cuelga, 0.5 = horizontal, hacia afuera)
  'fLx', 'fLy', 'fLz', 'fLyaw', 'fLpitch', 'fRx', 'fRy', 'fRz', 'fRyaw', 'fRpitch',   // pie: desplazamiento (marco de cara; x izq, y arriba, z adelante), giro, cabeceo (- = talón arriba)
  // ronda 4: polo del codo en marco de cara (dirección deseada del húmero) con peso (0 = polo normal). Lo usa el gancho.
  'pLx', 'pLy', 'pLz', 'pLw', 'pRx', 'pRy', 'pRz', 'pRw',
  // ronda 4: piernas por FK (KO peso muerto): kw = peso FK (0 = IK a los pies plantados), kH* = flexión de cadera (rad, + = muslo adelante),
  // kK* = flexión de rodilla (rad, + = tibia hacia atrás), kA* = apertura del muslo (rad, + = hacia afuera), kF* = cabeceo del pie vs tibia.
  'kw', 'kHL', 'kKL', 'kAL', 'kFL', 'kHR', 'kKR', 'kAR', 'kFR',
];

// Guardia MMA ortodoxa (izquierda adelante): cuerpo en ~30° de blade, mentón bajo, manos altas, codos pegados.
export const GUARD = Object.freeze({
  dy: 0, px: 0, pz: 0, hipYaw: -0.50, hipRoll: 0, hipPitch: 0.04, spYaw: 0.12, spPitch: 0.04, spRoll: 0, hdYaw: 0.34, hdPitch: 0.20, hdRoll: 0,
  shrugL: 0.10, shrugR: 0.14, protL: 0.08, protR: 0.04,
  hLx: 0.00, hLy: 0.03, hLz: 0.17, hRx: 0.14, hRy: 0.04, hRz: 0.15, elbL: -0.18, elbR: -0.18,
  elvL: 0, elvR: 0, fLx: 0, fLy: 0, fLz: 0, fLyaw: 0, fLpitch: 0, fRx: 0, fRy: 0, fRz: 0, fRyaw: 0, fRpitch: 0,
  pLx: 0, pLy: 0, pLz: 0, pLw: 0, pRx: 0, pRy: 0, pRz: 0, pRw: 0,
  kw: 0, kHL: 0, kKL: 0, kAL: 0, kFL: 0, kHR: 0, kKR: 0, kAR: 0, kFR: 0,
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
    hLz: [K(0, 0), K(0.050, -0.030, 'easeOutQuad'), K(0.095, 0.060, 'easeInQuad'), K(0.152, 0.385, 'easeOutCubic'), K(0.175, 0.385, 'linear'), K(0.230, 0.01, 'easeOutQuad'), K(0.31, -0.005), K(0.46, 0)],
    hLx: [K(0, 0), K(0.152, -0.055, 'easeOutQuad'), K(0.175, -0.055, 'linear'), K(0.23, 0, 'easeOutQuad'), K(0.46, 0)],
    hLy: [K(0, 0), K(0.050, 0.010), K(0.152, 0.005), K(0.23, 0), K(0.46, 0)],
    elbL: [K(0, 0), K(0.06, 0.2), K(0.15, 0.0), K(0.46, 0)],
    // mano trasera: sube a proteger el mentón con ligero acompañamiento
    hRy: [K(0, 0), K(0.15, 0.025, 'easeOutQuad'), K(0.34, 0.005), K(0.46, 0)],
    hRz: [K(0, 0), K(0.15, 0.030, 'easeOutQuad'), K(0.34, 0.003), K(0.46, 0)],
    hRx: [K(0, 0), K(0.15, -0.020, 'easeOutQuad'), K(0.34, 0), K(0.46, 0)],
  },
};
// Paso del jab: el pie adelantado avanza 13 cm (sale del suelo, aterriza al IMPACTO, se queda, vuelve levantándose). Sólo se mueve en el aire.
JAB.feet = true;
Object.assign(JAB.tracks, {
  fLz: [K(0, 0), K(0.10, 0.13), K(0.20, 0.13, 'linear'), K(0.31, 0), K(0.46, 0)],
  fLy: [K(0, 0), K(0.045, 0.03, 'easeOutQuad'), K(0.10, 0, 'easeInQuad'), K(0.20, 0, 'linear'), K(0.25, 0.025, 'easeOutQuad'), K(0.31, 0, 'easeInQuad'), K(0.46, 0)],
});

// CROSS (mano trasera R): 1) carga: se hunde y la cadera se arma hacia atrás; 2) el talón trasero pivota sobre la bola del pie y la CADERA
// gira entera (≈35°) primero; 3) el pecho la sigue ~30 ms después; 4) el puño sale ÚLTIMO, llega recto al impacto; 5) retorno por la misma línea.
export const CROSS = {
  name: 'cross', duration: 0.52, impactT: 0.17, tip: 'R', feet: true, ball: { R: true },
  phases: [{ name: 'anticipation', t0: 0, t1: 0.09 }, { name: 'strike', t0: 0.09, t1: 0.20 }, { name: 'recovery', t0: 0.20, t1: 0.52 }],
  tracks: {
    dy:      [K(0, 0), K(0.07, -0.035, 'easeOutQuad'), K(0.17, -0.03), K(0.34, -0.01), K(0.52, 0)],
    pz:      [K(0, 0), K(0.06, -0.03), K(0.17, 0.09, 'easeOutCubic'), K(0.22, 0.09), K(0.38, 0.01), K(0.52, 0)],
    hipYaw:  [K(0, 0), K(0.05, -0.06, 'easeOutQuad'), K(0.13, 0.62), K(0.19, 0.64), K(0.34, 0.10), K(0.42, -0.03), K(0.52, 0)],
    spYaw:   [K(0, 0), K(0.06, -0.04, 'easeOutQuad'), K(0.16, 0.14), K(0.21, 0.15), K(0.36, 0.02), K(0.52, 0)],
    spPitch: [K(0, 0), K(0.06, -0.03), K(0.17, 0.10, 'easeOutQuad'), K(0.34, 0.03), K(0.52, 0)],
    hdYaw:   [K(0, 0), K(0.17, -0.45), K(0.36, -0.05), K(0.52, 0)],
    hdPitch: [K(0, 0), K(0.17, 0.05), K(0.52, 0)],
    shrugR:  [K(0, 0), K(0.15, 0.07, 'easeOutQuad'), K(0.34, 0.01), K(0.52, 0)],
    protR:   [K(0, 0), K(0.17, 0.10, 'easeOutQuad'), K(0.36, 0.01), K(0.52, 0)],
    hRz: [K(0, 0), K(0.05, -0.03, 'easeOutQuad'), K(0.10, 0.05, 'easeInQuad'), K(0.17, 0.38, 'easeOutCubic'), K(0.20, 0.38, 'linear'), K(0.26, 0.02, 'easeOutQuad'), K(0.36, -0.005), K(0.52, 0)],
    hRx: [K(0, 0), K(0.17, 0.04), K(0.20, 0.04, 'linear'), K(0.27, 0), K(0.52, 0)],
    hRy: [K(0, 0), K(0.05, 0.01), K(0.17, 0.025), K(0.28, 0), K(0.52, 0)],
    elbR: [K(0, 0), K(0.06, 0.12), K(0.16, 0), K(0.52, 0)],
    hLy: [K(0, 0), K(0.17, 0.03), K(0.36, 0), K(0.52, 0)],
    hLz: [K(0, 0), K(0.17, -0.02), K(0.36, 0), K(0.52, 0)],
    hLx: [K(0, 0), K(0.17, 0.03), K(0.36, 0), K(0.52, 0)],
    fRyaw:   [K(0, 0), K(0.05, -0.05, 'easeOutQuad'), K(0.14, 0.70), K(0.30, 0.55), K(0.42, 0), K(0.52, 0)],
    fRpitch: [K(0, 0), K(0.06, -0.15), K(0.14, -0.55, 'easeOutQuad'), K(0.30, -0.45), K(0.42, 0), K(0.52, 0)],
  },
};

// GANCHO (mano delantera L) — ronda 3: BRAZO BLOQUEADO. El codo queda fijo (~92°, ver HOOK_E) y a la altura del hombro durante TODO el golpe
// (carga → impacto → retorno inicial): el arco horizontal lo hace la ROTACIÓN del cuerpo (cadera primero, pecho/hombros después), no la extensión del brazo.
// El puño va colgado del hombro (vector muñeca-hombro de largo constante en el marco del pecho) y sólo gira en la articulación del hombro (aducción
// horizontal, un "snap" final ~15° para que el puño salga último). Pie delantero: pivote sobre la bola, talón hacia afuera. Termina frente a la línea central.
// Los canales hLx/hLy/hLz del gancho se HORNEAN abajo a partir de las pistas de cadera/pecho (la muñeca depende de la rotación del pecho).
export const HOOK_E = 92 * Math.PI / 180;                       // ángulo del codo (rad), constante
const HOOK_UA = 0.31, HOOK_FA = 0.27;                             // = DIM.upperArm, DIM.foreArm (skeleton3d.js)
export const HOOK_R = Math.sqrt(HOOK_UA * HOOK_UA + HOOK_FA * HOOK_FA - 2 * HOOK_UA * HOOK_FA * Math.cos(HOOK_E));   // |muñeca - hombro|
export const HOOK = {
  name: 'hook', duration: 0.50, impactT: 0.17, tip: 'L', feet: true, ball: { L: true },
  phases: [{ name: 'anticipation', t0: 0, t1: 0.09 }, { name: 'strike', t0: 0.09, t1: 0.21 }, { name: 'recovery', t0: 0.21, t1: 0.50 }],
  lock: { tLoad: 0.09, tRelease: 0.22, tFree: 0.36, y: -0.02 },
  tracks: {
    dy:      [K(0, 0), K(0.06, -0.03, 'easeOutQuad'), K(0.17, -0.035), K(0.34, -0.01), K(0.50, 0)],
    pz:      [K(0, 0), K(0.17, 0.03), K(0.50, 0)],
    hipYaw:  [K(0, 0), K(0.065, 0.17, 'easeOutQuad'), K(0.14, -0.30, 'easeInOutQuad'), K(0.20, -0.33), K(0.34, -0.08), K(0.42, 0.02), K(0.50, 0)],
    spYaw:   [K(0, 0), K(0.085, 0.14, 'easeOutQuad'), K(0.165, -0.22, 'easeInOutQuad'), K(0.215, -0.24), K(0.35, -0.05), K(0.50, 0)],
    spRoll:  [K(0, 0), K(0.17, 0.04), K(0.50, 0)],
    spPitch: [K(0, 0), K(0.17, 0.04), K(0.50, 0)],
    hdYaw:   [K(0, 0), K(0.17, 0.42), K(0.36, 0.04), K(0.50, 0)],
    shrugL:  [K(0, 0), K(0.17, 0.06, 'easeOutQuad'), K(0.34, 0.01), K(0.50, 0)],
    protL:   [K(0, 0), K(0.17, 0.05, 'easeOutQuad'), K(0.36, 0.01), K(0.50, 0)],
    elvL: [K(0, 0), K(0.09, 0.5, 'easeInOutQuad'), K(0.21, 0.5, 'linear'), K(0.36, 0.1), K(0.50, 0)],
    elbL: [K(0, 0), K(0.09, 0.35, 'easeInOutQuad'), K(0.21, 0.35, 'linear'), K(0.36, 0), K(0.50, 0)],
    hRy: [K(0, 0), K(0.17, 0.02), K(0.36, 0), K(0.50, 0)],
    fLyaw:   [K(0, 0), K(0.06, 0.05), K(0.14, -0.70), K(0.30, -0.58), K(0.42, 0), K(0.50, 0)],
    fLpitch: [K(0, 0), K(0.06, -0.12), K(0.14, -0.50, 'easeOutQuad'), K(0.30, -0.42), K(0.42, 0), K(0.50, 0)],
  },
};
// Hornea hLx/hLy/hLz: muñeca = hombro + vector de largo HOOK_R girado por el yaw del pecho (cadera+columna, rel. a la cara).
// Ángulo del brazo en el marco del pecho: a(t) (0 = adelante, + = izquierda). Va de A0 (carga) a A1 (snap del hombro, tarde en el golpe).
export const HOOK_A0 = 84 * Math.PI / 180, HOOK_A1 = 42 * Math.PI / 180;
(function bakeHook() {
  const T = HOOK.tracks, L = HOOK.lock, G = GUARD, dt = 0.01, n = Math.round(HOOK.duration / dt);
  const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const X = [], Y = [], Z = [];
  for (let i = 0; i <= n; i++) {
    const t = +(i * dt).toFixed(4);
    const psi = G.hipYaw + G.spYaw + sampleTrack(T.hipYaw, t) + sampleTrack(T.spYaw, t);
    const snap = sm((t - 0.12) / 0.065);                                   // aducción horizontal tardía: el puño sale último
    const a = HOOK_A0 + (HOOK_A1 - HOOK_A0) * snap;
    const lam = sm(t / L.tLoad) * (1 - sm((t - L.tRelease) / (L.tFree - L.tRelease)));   // 0 = guardia, 1 = bloqueado
    const h = Math.sqrt(Math.max(1e-6, HOOK_R * HOOK_R - L.y * L.y));      // radio horizontal
    const th = a + psi, lx = h * Math.sin(th), lz = h * Math.cos(th);
    X.push(K(t, lam * (lx - G.hLx), 'linear')); Z.push(K(t, lam * (lz - G.hLz), 'linear')); Y.push(K(t, lam * (L.y - G.hLy), 'linear'));
  }
  T.hLx = X; T.hLy = Y; T.hLz = Z;
})();

// PATADA BAJA TRASERA (pierna R, roundhouse): 1) el pie delantero da un pequeño paso hacia afuera y PIVOTA sobre la bola (~70°);
// 2) la cadera gira entera; 3) la rodilla sube (chamber), 4) el tibia barre y pega a la altura del muslo (impacto 0.30 s),
// 5) la pierna se pliega y el pie vuelve al suelo en su sitio, 6) el pie de apoyo desanda el pivote y regresa a la guardia.
export const LOWKICK = {
  name: 'lowkick', duration: 0.84, impactT: 0.30, tip: 'kickR', feet: true, ball: { L: true },
  phases: [{ name: 'anticipation', t0: 0, t1: 0.24 }, { name: 'strike', t0: 0.24, t1: 0.37 }, { name: 'recovery', t0: 0.37, t1: 0.84 }],
  tracks: {
    dy:      [K(0, 0), K(0.10, -0.03), K(0.30, -0.025), K(0.62, -0.03), K(0.84, 0)],
    px:      [K(0, 0), K(0.12, 0.02), K(0.28, 0.06), K(0.62, 0.03), K(0.84, 0)],
    pz:      [K(0, 0), K(0.10, 0.05), K(0.30, 0.02), K(0.62, 0.02), K(0.84, 0)],
    hipYaw:  [K(0, 0), K(0.10, -0.08), K(0.30, 1.15), K(0.40, 1.10, 'linear'), K(0.56, 0.5), K(0.72, 0.05), K(0.84, 0)],
    spYaw:   [K(0, 0), K(0.10, 0), K(0.31, 0.18), K(0.44, 0.12), K(0.62, 0), K(0.84, 0)],
    spRoll:  [K(0, 0), K(0.30, -0.12), K(0.62, -0.06), K(0.84, 0)],
    spPitch: [K(0, 0), K(0.30, 0.05), K(0.84, 0)],
    hdYaw:   [K(0, 0), K(0.30, -0.55), K(0.50, -0.30), K(0.84, 0)],
    hRx:     [K(0, 0), K(0.30, -0.06), K(0.84, 0)],
    hRz:     [K(0, 0), K(0.30, -0.04), K(0.84, 0)],
    elvR:    [K(0, 0), K(0.30, 0.15), K(0.84, 0)],
    hLx:     [K(0, 0), K(0.30, 0.04), K(0.84, 0)],
    // pie de apoyo (L): paso hacia afuera y pivote sobre la bola
    fLx:     [K(0, 0), K(0.02, 0), K(0.09, 0.08), K(0.64, 0.08, 'linear'), K(0.78, 0), K(0.84, 0)],
    fLz:     [K(0, 0), K(0.02, 0), K(0.09, 0.12), K(0.64, 0.12, 'linear'), K(0.78, 0), K(0.84, 0)],
    fLy:     [K(0, 0), K(0.02, 0.012, 'easeOutQuad'), K(0.05, 0.035, 'easeOutQuad'), K(0.09, 0, 'easeInQuad'), K(0.64, 0, 'linear'), K(0.69, 0.03, 'easeOutQuad'), K(0.78, 0, 'easeInQuad'), K(0.84, 0)],
    fLyaw:   [K(0, 0), K(0.12, 0), K(0.30, 1.25), K(0.46, 1.25, 'linear'), K(0.64, 1.25, 'linear'), K(0.78, 0.0), K(0.84, 0)],
    fLpitch: [K(0, 0), K(0.14, 0), K(0.24, -0.35), K(0.32, -0.6), K(0.50, -0.5), K(0.64, -0.5, 'linear'), K(0.78, 0), K(0.84, 0)],
    // pie que patea (R): chamber -> barrido -> pliega -> baja
    fRx: [K(0, 0), K(0.10, 0.05), K(0.20, 0.14), K(0.30, 0.29), K(0.35, 0.29, 'linear'), K(0.44, 0.15), K(0.62, 0), K(0.84, 0)],
    fRz: [K(0, 0), K(0.10, 0.10), K(0.20, 0.22), K(0.30, 1.10, 'easeInCubic'), K(0.35, 1.10, 'linear'), K(0.44, 0.28), K(0.62, 0), K(0.84, 0)],
    fRy: [K(0, 0), K(0.10, 0.12, 'easeOutQuad'), K(0.20, 0.26), K(0.30, 0.50, 'easeOutQuad'), K(0.35, 0.50, 'linear'), K(0.44, 0.28), K(0.58, 0.06, 'easeInQuad'), K(0.64, 0), K(0.84, 0)],
    fRyaw: [K(0, 0), K(0.20, 0.2), K(0.30, 1.3), K(0.44, 0.6), K(0.64, 0), K(0.84, 0)],
    fRpitch: [K(0, 0), K(0.30, -0.4), K(0.50, -0.2), K(0.64, 0), K(0.84, 0)],
  },
};

// BLOQUEO: pose sostenida (deltas sobre la guardia): codos adentro, antebrazos tapando la cara, mentón al pecho, cuerpo hundido y encogido.
export const BLOCK_POSE = Object.freeze({
  dy: -0.035, spPitch: 0.12, hdPitch: 0.16, shrugL: 0.07, shrugR: 0.07, protL: 0.05, protR: 0.05,
  hLx: -0.07, hLy: 0.09, hLz: -0.02, hRx: 0.05, hRy: 0.08, hRz: -0.02, elbL: -0.10, elbR: -0.10,
});
const blockTracks = () => { const t = {}; for (const c in BLOCK_POSE) t[c] = [K(0, 0), K(0.09, BLOCK_POSE[c], 'easeOutQuad'), K(0.45, BLOCK_POSE[c], 'linear'), K(0.60, 0)]; return t; };
export const BLOCK = { name: 'block', duration: 0.60, impactT: 0.30, tip: 'L', phases: [{ name: 'raise', t0: 0, t1: 0.09 }, { name: 'hold', t0: 0.09, t1: 0.45 }, { name: 'lower', t0: 0.45, t1: 0.6 }], tracks: blockTracks() };

export const CLIPS = { jab: JAB, cross: CROSS, hook: HOOK, lowkick: LOWKICK, block: BLOCK };


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
