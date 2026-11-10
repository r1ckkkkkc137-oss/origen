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
  // kK* = flexión de rodilla (rad, + = tibia hacia atrás), kA* = apertura del muslo (rad, + = hacia afuera), kF* = pie 0 = plano en el suelo .. 1 = alineado con la tibia (empeine).
  'kw', 'kHL', 'kKL', 'kAL', 'kFL', 'kHR', 'kKR', 'kAR', 'kFR',
  // ronda 7: pie R en punta alineado con la tibia (0 = pie normal, 1 = empeine en la línea de la espinilla): patadas media/alta
  'ptR',
  // ronda 8: golpe de suelo: envolvente (0..1) de la inclinación por posición del de arriba (GROUND_LEAN en ground.js)
  'gLean',
];

// Guardia MMA ortodoxa (izquierda adelante): cuerpo en ~30° de blade, mentón bajo, manos altas, codos pegados.
export const GUARD = Object.freeze({
  dy: 0, px: 0, pz: 0, hipYaw: -0.50, hipRoll: 0, hipPitch: 0.04, spYaw: 0.12, spPitch: 0.04, spRoll: 0, hdYaw: 0.34, hdPitch: 0.20, hdRoll: 0,
  shrugL: 0.10, shrugR: 0.14, protL: 0.08, protR: 0.04,
  hLx: 0.00, hLy: 0.03, hLz: 0.17, hRx: 0.14, hRy: 0.04, hRz: 0.15, elbL: -0.18, elbR: -0.18,
  elvL: 0, elvR: 0, fLx: 0, fLy: 0, fLz: 0, fLyaw: 0, fLpitch: 0, fRx: 0, fRy: 0, fRz: 0, fRyaw: 0, fRpitch: 0,
  pLx: 0, pLy: 0, pLz: 0, pLw: 0, pRx: 0, pRy: 0, pRz: 0, pRw: 0,
  kw: 0, kHL: 0, kKL: 0, kAL: 0, kFL: 0, kHR: 0, kKR: 0, kAR: 0, kFR: 0, ptR: 0, gLean: 0,
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
// ---------------------------------------------------------------- RONDA 4: peso y rapidez (feedback de Benja) + tiempos de la sim
// Los cuatro golpes usan EXACTAMENTE los tiempos base de la sim (src/combat/data/moves.js, 60 ticks/s, speedMul 1): impactT = startup/60,
// duration = (startup+active+recovery)/60. liveAnim los lanza a 1x en windupSeconds − impactT => el impacto del clip cae en el tick de impacto.
// Estructura común: anticipación CORTA (2–3 frames) con carga de cadera -> golpe con ease-in FUERTE (el pico de velocidad llega AL impacto, no antes)
// -> HIT-STOP de ~2,5 frames (el puño/espinilla queda clavado mientras el peso sigue entrando: pie trasero empuja, pelvis baja, torso avanza)
// -> recuperación rápida a la guardia.
export const SIM_TICKS = Object.freeze({ jab: [6, 3, 10], cross: [9, 3, 14], hook: [11, 3, 15], lowkick: [14, 4, 18] });   // [startup, active, recovery]
const simT = (n) => { const [s, a, r] = SIM_TICKS[n]; return { i: s / 60, d: (s + a + r) / 60 }; };
export const HITSTOP = 0.042;                                    // 2,5 frames a 60 fps
const K = (t, v, e = 'easeInOutQuad') => [t, v, e];
const EI = 'easeInQuad', EO = 'easeOutQuad', LIN = 'linear';

// JAB (mano adelantada L) + paso del pie adelantado (13 cm, sólo en el aire, aterriza antes del impacto para que el peso entre).
const JI = simT('jab').i, JD = simT('jab').d, JH = JI + HITSTOP;   // 0.100, 0.317, 0.142
export const JAB = {
  name: 'jab', duration: JD, impactT: JI, tip: 'L', feet: true, ball: { R: true },
  phases: [{ name: 'anticipation', t0: 0, t1: 0.035 }, { name: 'strike', t0: 0.035, t1: JH }, { name: 'recovery', t0: JH, t1: JD }],
  tracks: {
    dy:      [K(0, 0), K(0.03, -0.02, EO), K(JI, -0.03, EI), K(JH, -0.045), K(0.23, -0.01), K(JD, 0)],
    pz:      [K(0, 0), K(0.03, -0.015), K(JI, 0.11, EI), K(JH, 0.125), K(0.23, 0.02), K(JD, 0)],
    px:      [K(0, 0), K(JI, 0.02, EO), K(JD, 0)],
    hipYaw:  [K(0, 0), K(0.03, 0.07, EO), K(0.085, -0.30, EI), K(JH, -0.32), K(0.22, -0.05), K(0.26, 0.02), K(JD, 0)],
    hipRoll: [K(0, 0), K(0.09, -0.04), K(0.22, 0), K(JD, 0)],
    spYaw:   [K(0, 0), K(0.035, 0.04, EO), K(0.097, -0.36, EI), K(JH, -0.38), K(0.23, -0.03), K(0.27, 0.015), K(JD, 0)],
    spPitch: [K(0, 0), K(0.03, -0.03), K(JI, 0.11, EI), K(JH, 0.145), K(0.24, 0.02), K(JD, 0)],
    spRoll:  [K(0, 0), K(JI, 0.05), K(JD, 0)],
    hdPitch: [K(0, 0), K(JI, 0.07, EO), K(0.24, 0.01), K(JD, 0)],
    hdYaw:   [K(0, 0), K(JI, 0.20), K(0.26, 0.02), K(JD, 0)],
    shrugL:  [K(0, 0), K(0.09, 0.05, EO), K(0.22, 0.01), K(JD, 0)],
    protL:   [K(0, 0), K(JI, 0.07, EO), K(0.22, 0.01), K(JD, 0)],
    hLz: [K(0, 0), K(0.015, -0.005, EO), K(JI, 0.405, EI), K(JH, 0.41, LIN), K(0.21, 0.03, EO), K(0.25, -0.005), K(JD, 0)],
    hLx: [K(0, 0), K(JI, -0.055, EI), K(JH, -0.055, LIN), K(0.20, 0, EO), K(JD, 0)],
    hLy: [K(0, 0), K(0.035, 0.010), K(JI, 0.005), K(0.20, 0), K(JD, 0)],
    elbL: [K(0, 0), K(0.04, 0.2), K(JI, 0.0), K(JD, 0)],
    hRy: [K(0, 0), K(JI, 0.025, EO), K(0.24, 0.005), K(JD, 0)],
    hRz: [K(0, 0), K(JI, 0.030, EO), K(0.24, 0.003), K(JD, 0)],
    hRx: [K(0, 0), K(JI, -0.020, EO), K(0.24, 0), K(JD, 0)],
    // paso: el pie adelantado sale, avanza 13 cm en el aire y aterriza a 0.075 s; vuelve levantándose en 0.17–0.25
    fLz: [K(0, 0), K(0.075, 0.24), K(0.17, 0.24, LIN), K(0.25, 0), K(JD, 0)],
    fLy: [K(0, 0), K(0.03, 0.03, EO), K(0.075, 0, EI), K(0.17, 0, LIN), K(0.205, 0.025, EO), K(0.25, 0, EI), K(JD, 0)],
    // el pie trasero EMPUJA: el talón sube sobre la bola hasta el hit-stop
    fRpitch: [K(0, 0), K(0.05, -0.08), K(JI, -0.30, EI), K(JH, -0.34), K(0.24, 0), K(JD, 0)],
  },
};

// CROSS (mano trasera R): carga corta (cadera atrás), talón trasero pivota sobre la bola y la cadera gira entera primero, el pecho sigue, el puño
// sale ÚLTIMO con ease-in hasta el impacto, hit-stop con el peso entrando (pelvis baja, torso adelante) y vuelta rápida.
const CI = simT('cross').i, CD = simT('cross').d, CH = CI + HITSTOP;   // 0.150, 0.433, 0.192
export const CROSS = {
  name: 'cross', duration: CD, impactT: CI, tip: 'R', feet: true, ball: { R: true },
  phases: [{ name: 'anticipation', t0: 0, t1: 0.065 }, { name: 'strike', t0: 0.065, t1: CH }, { name: 'recovery', t0: CH, t1: CD }],
  tracks: {
    dy:      [K(0, 0), K(0.045, -0.03, EO), K(CI, -0.035, EI), K(CH, -0.052), K(0.30, -0.01), K(CD, 0)],
    pz:      [K(0, 0), K(0.045, -0.03), K(CI, 0.20, LIN), K(CH, 0.215), K(0.31, 0.02), K(CD, 0)],
    hipYaw:  [K(0, 0), K(0.045, -0.08, EO), K(0.12, 0.70, EI), K(CH, 0.73), K(0.29, 0.10), K(0.35, -0.03), K(CD, 0)],
    spYaw:   [K(0, 0), K(0.05, -0.04, EO), K(0.142, 0.20, EI), K(CH, 0.22), K(0.30, 0.02), K(CD, 0)],
    spPitch: [K(0, 0), K(0.045, -0.03), K(CI, 0.12, EI), K(CH, 0.15), K(0.30, 0.03), K(CD, 0)],
    hdYaw:   [K(0, 0), K(CI, -0.45), K(0.30, -0.05), K(CD, 0)],
    hdPitch: [K(0, 0), K(CI, 0.05), K(CD, 0)],
    shrugR:  [K(0, 0), K(0.14, 0.07, EO), K(0.28, 0.01), K(CD, 0)],
    protR:   [K(0, 0), K(CI, 0.10, EO), K(0.30, 0.01), K(CD, 0)],
    hRz: [K(0, 0), K(0.065, -0.03, EO), K(CI, 0.395, EI), K(CH, 0.40, LIN), K(0.25, 0.02, EO), K(0.31, -0.005), K(CD, 0)],
    hRx: [K(0, 0), K(CI, 0.04, EI), K(CH, 0.04, LIN), K(0.25, 0), K(CD, 0)],
    hRy: [K(0, 0), K(0.05, 0.01), K(CI, 0.025), K(0.25, 0), K(CD, 0)],
    elbR: [K(0, 0), K(0.06, 0.12), K(0.14, 0), K(CD, 0)],
    hLy: [K(0, 0), K(CI, 0.03), K(0.30, 0), K(CD, 0)],
    hLz: [K(0, 0), K(CI, -0.02), K(0.30, 0), K(CD, 0)],
    hLx: [K(0, 0), K(CI, 0.03), K(0.30, 0), K(CD, 0)],
    // ronda 5: desliz del pie delantero (en el aire, aterriza antes del impacto) para que la pelvis entre y el cross llegue a 1,0 m
    fLz: [K(0, 0), K(0.10, 0.21), K(0.24, 0.21, LIN), K(0.33, 0), K(CD, 0)],
    fLy: [K(0, 0), K(0.04, 0.025, EO), K(0.10, 0, EI), K(0.24, 0, LIN), K(0.285, 0.02, EO), K(0.33, 0, EI), K(CD, 0)],
    fRyaw:   [K(0, 0), K(0.045, -0.05, EO), K(0.125, 0.70, EI), K(0.25, 0.55), K(0.36, 0), K(CD, 0)],
    fRpitch: [K(0, 0), K(0.05, -0.15), K(0.125, -0.55, EO), K(CH, -0.62), K(0.25, -0.45), K(0.36, 0), K(CD, 0)],
  },
};

// GANCHO (mano delantera L) — ronda 4 (Rick: "todavía parece un brazo recto hacia adelante, el húmero apunta al rival").
// En el impacto el HÚMERO va ABDUCIDO ~85° (paralelo al suelo) y abierto al costado: forma ≥60° con la dirección al rival. El codo queda FIJO en 90°
// y AL LADO del puño (no detrás): el antebrazo cruza hacia adelante/adentro y un poco hacia arriba => en la vista front se lee la 'L' acostada.
// El arco lo hace la ROTACIÓN del cuerpo (cadera primero, pecho/hombros después) con el brazo bloqueado como cuerpo rígido en el marco del pecho
// + un "snap" final de aducción horizontal del hombro (HOOK_A0 -> HOOK_A1, ease-in: el puño sale último y llega a tope de velocidad al impacto).
// La muñeca (hLx/hLy/hLz) y el polo del codo en marco de cara (pLx/pLy/pLz, peso pLw) se HORNEAN abajo desde las pistas de cadera/pecho:
// el polo = dirección deseada del húmero => la IK pone el codo exactamente ahí. Pie delantero: pivote sobre la bola.
const HI = simT('hook').i, HD = simT('hook').d, HH = HI + HITSTOP;     // 0.183, 0.483, 0.225
// ronda 6 (contacto, sólo con rival enlazado): zona, altura del blanco (centro de la cabeza + dy) y punta libre en el impacto en el marco
// de la raíz [izq, altura, adelante] (medida sin rival, semilla 7; round6.test.mjs comprueba que sigue valiendo).
JAB.aim = { zone: 'head', dy: -0.02, ref: [-0.035, 1.342, 1.004], sref: [0.032, 1.293, 0.311] };   // sref: hombro libre en el impacto (la pelvis entra menos si el blanco está cerca)
CROSS.aim = { zone: 'head', dy: -0.03, ref: [0.096, 1.402, 1.018], sref: [-0.121, 1.314, 0.362] };
export const HOOK_E = 90 * Math.PI / 180;                       // ángulo del codo (rad), constante de la carga al impacto
const HOOK_UA = 0.31, HOOK_FA = 0.27;                             // = DIM.upperArm, DIM.foreArm (skeleton3d.js)
export const HOOK_R = Math.sqrt(HOOK_UA * HOOK_UA + HOOK_FA * HOOK_FA - 2 * HOOK_UA * HOOK_FA * Math.cos(HOOK_E));   // |muñeca - hombro|
export const HOOK_DROP = 1 * Math.PI / 180;                      // el húmero cae 1° bajo la horizontal (r6: era 5°; abducción ≈88°, el puño sube a la mandíbula)
export const HOOK_RISE = 28 * Math.PI / 180;                     // el antebrazo sube 28° (r6: era 22°; puño a la mandíbula del rival en guardia)
export const HOOK_A0 = 110 * Math.PI / 180, HOOK_A1 = 97 * Math.PI / 180;   // húmero en el marco del pecho (0 = adelante, 90° = costado)
export const HOOK = {
  name: 'hook', duration: HD, impactT: HI, tip: 'L', feet: true, ball: { L: true },
  phases: [{ name: 'anticipation', t0: 0, t1: 0.06 }, { name: 'strike', t0: 0.06, t1: HH }, { name: 'recovery', t0: HH, t1: HD }],
  lock: { tLoad: 0.12, tRelease: HH + 0.01, tFree: 0.34, snap0: 0.13 },
  tracks: {
    dy:      [K(0, 0), K(0.05, -0.035, EO), K(HI, -0.04), K(HH, -0.058), K(0.33, -0.01), K(HD, 0)],
    pz:      [K(0, 0), K(0.05, 0.01), K(HI, 0.05, EI), K(HH, 0.07), K(0.32, 0.01), K(HD, 0)],
    px:      [K(0, 0), K(HI, -0.03), K(0.38, 0), K(HD, 0)],
    hipYaw:  [K(0, 0), K(0.07, 0.34, EO), K(0.165, -0.34), K(HI, -0.36, LIN), K(HH, -0.38), K(0.33, -0.08), K(0.40, 0.02), K(HD, 0)],
    spYaw:   [K(0, 0), K(0.07, 0.08, EO), K(HI, 0.13), K(HH, 0.12), K(0.34, 0.02), K(HD, 0)],
    spRoll:  [K(0, 0), K(HI, -0.05), K(HD, 0)],
    spPitch: [K(0, 0), K(HI, 0.10, EI), K(HH, 0.125), K(0.32, 0.04), K(HD, 0)],
    hdYaw:   [K(0, 0), K(0.07, -0.10), K(HI, 0.26), K(0.34, 0.04), K(HD, 0)],
    shrugL:  [K(0, 0), K(HI, 0.06, EO), K(0.32, 0.01), K(HD, 0)],
    protL:   [K(0, 0), K(HI, 0.04, EO), K(0.34, 0.01), K(HD, 0)],
    elvL: [K(0, 0), K(0.12, 0.5), K(HH + 0.01, 0.5, LIN), K(0.34, 0.1), K(HD, 0)],
    elbL: [K(0, 0), K(0.12, 0.35), K(HH + 0.01, 0.35, LIN), K(0.34, 0), K(HD, 0)],
    hRy: [K(0, 0), K(HI, 0.02), K(0.34, 0), K(HD, 0)],
    fLyaw:   [K(0, 0), K(0.05, 0.05), K(0.15, -0.70, EI), K(0.28, -0.58), K(0.38, 0), K(HD, 0)],
    fLpitch: [K(0, 0), K(0.05, -0.12), K(0.15, -0.50, EO), K(0.28, -0.42), K(0.38, 0), K(HD, 0)],
    // el pie trasero también empuja un poco (talón arriba sobre la bola) en el hit-stop
    fRpitch: [K(0, 0), K(0.10, -0.05), K(HI, -0.18, EI), K(HH, -0.20), K(0.32, 0), K(HD, 0)],
  },
};
HOOK.ball.R = true;
// ronda 6: con rival enlazado, la punta apunta a la altura de la zona (mandíbula = centro de la cabeza + dy) en el impacto
HOOK.aim = { zone: 'head', dy: -0.08, ref: [0.192, 1.474, 0.667], ref1: [0.142, 1.462, 0.852] };   // ref = entrada k=0, ref1 = k=1
// ronda 6 (Rick + Combate combat-gap): el gancho conecta desde ~0,85 m SIN que la raíz entre (gap de pie >= 0,80 m). La entrada es un paso del pie
// delantero (en el aire, aterriza antes del impacto) + la pelvis que entra, sólo durante el golpe, y sale en la recuperación.
// Capa aparte (`entry`), escalada por el animador según la distancia REAL al rival prevista para el impacto: k = (d - d0) / (d1 - d0), 0..1.25.
// Sin rival conocido k = 1 (la sim lo lanza a ~0,86). Si la raíz de la sim ya se acerca, k baja solo => no se duplica la entrada.
HOOK.entry = {
  d0: 0.70, d1: 0.86, kMax: 1.25, kMin: -0.35, bias: 0.015,   // con rival: k desde la profundidad de SU cabeza (ver animator3d entryFactor); kMin<0 = la pelvis queda algo atrás
  tracks: {
    pz:  [K(0, 0), K(0.05, 0.015), K(HI, 0.185, EI), K(HH, 0.195), K(0.36, 0.02), K(HD, 0)],
    px:  [K(0, 0), K(0.08, 0), K(HI, -0.05, EI), K(HH, -0.05), K(0.36, 0), K(HD, 0)],   // el peso cruza hacia la línea central
    dy:  [K(0, 0), K(HI, -0.012), K(HH, -0.02), K(0.36, 0), K(HD, 0)],
    fLz: [K(0, 0), K(0.11, 0.19), K(0.30, 0.19, LIN), K(0.40, 0), K(HD, 0)],
    fLy: [K(0, 0), K(0.04, 0.03, EO), K(0.11, 0, EI), K(0.30, 0, LIN), K(0.35, 0.025, EO), K(0.40, 0, EI), K(HD, 0)],
  },
};
// Geometría del brazo bloqueado (marco de cara: x izq, y arriba, z adelante) para un ángulo del húmero `th` respecto de la mirada (+ = hacia la izquierda).
// Devuelve { u: dirección del húmero, v: dirección del antebrazo, rel: muñeca − hombro }. u ⟂ v => codo = 90° exacto.
export function hookArm(th, drop = HOOK_DROP, rise = HOOK_RISE) {
  const cd = Math.cos(drop), u = [cd * Math.sin(th), -Math.sin(drop), cd * Math.cos(th)];
  const h = [-Math.cos(th), 0, Math.sin(th)];                    // horizontal, ⟂ al húmero, hacia adelante/adentro
  let v = [h[0] * Math.cos(rise), Math.sin(rise), h[2] * Math.cos(rise)];
  const k = v[0] * u[0] + v[1] * u[1] + v[2] * u[2]; v = [v[0] - k * u[0], v[1] - k * u[1], v[2] - k * u[2]];   // Gram-Schmidt contra u
  const n = Math.hypot(v[0], v[1], v[2]); v = v.map((x) => x / n);
  return { u, v, rel: [HOOK_UA * u[0] + HOOK_FA * v[0], HOOK_UA * u[1] + HOOK_FA * v[1], HOOK_UA * u[2] + HOOK_FA * v[2]] };
}
// Hornea hLx/hLy/hLz + pLx/pLy/pLz/pLw de un clip de gancho: yaw del pecho psi (cadera+columna rel. a la cara) + ángulo del brazo en el pecho a(t) => th = a + psi.
export function bakeHookArm(clip, tImpact) {
  const T = clip.tracks, L = clip.lock, G = GUARD, dt = 0.005, n = Math.round(clip.duration / dt);
  const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const X = [], Y = [], Z = [], PX = [], PY = [], PZ = [], PW = [];
  for (let i = 0; i <= n; i++) {
    const t = i === n ? clip.duration : +(i * dt).toFixed(4);
    const psi = G.hipYaw + G.spYaw + sampleTrack(T.hipYaw, t) + sampleTrack(T.spYaw, t);
    const q = Math.max(0, Math.min(1, (t - L.snap0) / Math.max(1e-3, tImpact - L.snap0))), snap = q * q;   // ease-in: tope de velocidad al impacto
    const a = HOOK_A0 + (HOOK_A1 - HOOK_A0) * snap;
    const lam = i === n ? 0 : sm(t / L.tLoad) * (1 - sm((t - L.tRelease) / (L.tFree - L.tRelease)));   // 0 = guardia, 1 = bloqueado
    const { u, rel } = hookArm(a + psi);
    X.push(K(t, lam * (rel[0] - G.hLx), LIN)); Y.push(K(t, lam * (rel[1] - G.hLy), LIN)); Z.push(K(t, lam * (rel[2] - G.hLz), LIN));
    PX.push(K(t, lam * u[0], LIN)); PY.push(K(t, lam * u[1], LIN)); PZ.push(K(t, lam * u[2], LIN)); PW.push(K(t, lam, LIN));
  }
  T.hLx = X; T.hLy = Y; T.hLz = Z; T.pLx = PX; T.pLy = PY; T.pLz = PZ; T.pLw = PW;
}
// el PECHO (cadera + columna) gira con ease-in desde la carga hasta el impacto: la cadera ya pasó su pico (≈0.11 s) y el tronco "latiguea"
// => el pico de velocidad del puño cae en el impacto. spYaw se hornea = pecho deseado − cadera.
(function bakeHookChest() {
  const T = HOOK.tracks, t0 = 0.09, dt = 0.005, G = GUARD;
  const c0 = sampleTrack(T.hipYaw, t0) + sampleTrack(T.spYaw, t0), c1 = sampleTrack(T.hipYaw, HI) + sampleTrack(T.spYaw, HI);
  const keys = T.spYaw.filter((k) => k[0] <= t0 + 1e-9);
  for (let t = t0 + dt; t < HI - 1e-9; t += dt) { const u = (t - t0) / (HI - t0); keys.push(K(+t.toFixed(4), c0 + (c1 - c0) * u * u - sampleTrack(T.hipYaw, t), LIN)); }
  T.spYaw = keys.concat(T.spYaw.filter((k) => k[0] >= HI - 1e-9).map((k, i) => i === 0 ? K(k[0], k[1], LIN) : k)); void G;
})();
bakeHookArm(HOOK, HI);

// FINTA DE GANCHO (ronda 4): Combate aborta el hook en el startup (el rival se fue de rango) => state.clip = 'feint' con state.move = 'hook'
// (src/combat/core/core.js: act.feint = act.aborted = true; al cerrar el startup emite X.FEINT con move 'hook' -> actionStart).
// El clip ES el arranque del gancho (mismas pistas hasta FEINT_CUT: la cadera abre/carga, el hombro y el codo suben al costado, el peso baja)
// y sigue cargando hasta 0.13 s; ahí se CORTA: cadera, hombros y brazo vuelven secos a la guardia. Como coincide con el gancho hasta el corte, el animador cambia de clip a la
// misma fase sin salto (setState). No es un jab: el puño nunca va hacia adelante, sólo se abre y vuelve.
export const FEINT_CUT = 0.06;     // hasta acá idéntico al gancho (pico de apertura de cadera); la sim aborta antes de ~0.13 s
export const FEINT_HOOK = (() => {
  const d = 0.38, tL = 0.13, tC = 0.21, tr = {};
  // después del arranque común la finta SIGUE cargando (cadera abre más, pecho enrolla, hombro L sube, peso abajo) y en tL se corta en seco
  const EXTRA = { hipYaw: 0.16, spYaw: 0.10, dy: -0.02, shrugL: 0.07, spPitch: 0.03 };
  const arm = /^(hL|pL|elvL|elbL|protL|wrL)/;
  for (const c of new Set([...Object.keys(HOOK.tracks), ...Object.keys(EXTRA)])) {
    const T = HOOK.tracks[c], k = [];
    for (let t = 0; t <= FEINT_CUT + 1e-9; t += 0.01) k.push(K(+t.toFixed(3), T ? sampleTrack(T, t) : 0, LIN));
    const vc = k[k.length - 1][1], v = T && arm.test(c) ? 0.85 * sampleTrack(T, 0.10) : vc + (EXTRA[c] || 0);
    k.push(K(tL, v, EO), K(tC, v * 0.18, EO), K(0.29, v * -0.03), K(d, 0));
    tr[c] = k;
  }
  return { name: 'feint_hook', duration: d, impactT: tL, tip: 'L', feet: true, ball: { L: true }, feint: 'hook',
    phases: [{ name: 'load', t0: 0, t1: tL }, { name: 'cut', t0: tL, t1: tC }, { name: 'recovery', t0: tC, t1: d }], tracks: tr };
})();

// PATADA BAJA TRASERA (pierna R) — ronda 4: el pie de apoyo (L) da un PASO adelante/afuera en el aire (0–0.08 s) y PIVOTA sobre la bola (~70°),
// la pelvis viaja con él y el torso se INCLINA HACIA ATRÁS (contrapeso) => la espinilla llega a 1,0 m horizontales de la raíz (= pelvis de la sim).
// Cadera carga hacia atrás, gira entera (≈65°) con ease-in; la tibia barre con ease-in y pega a la altura del muslo; hit-stop con el peso adentro;
// la pierna se pliega rápido, baja en su sitio y el pie de apoyo desanda el paso en el aire.
const KI = simT('lowkick').i, KD = simT('lowkick').d, KH = KI + HITSTOP;   // 0.233, 0.600, 0.275
export const LOWKICK = {
  name: 'lowkick', duration: KD, impactT: KI, tip: 'kickR', feet: true, ball: { L: true },
  phases: [{ name: 'anticipation', t0: 0, t1: 0.08 }, { name: 'strike', t0: 0.08, t1: KH + 0.025 }, { name: 'recovery', t0: KH + 0.025, t1: KD }],
  tracks: {
    dy:      [K(0, 0), K(0.06, -0.03), K(KI, -0.035), K(KH, -0.06), K(0.44, -0.03), K(KD, 0)],
    px:      [K(0, 0), K(0.08, 0.04), K(KI, 0.08), K(0.44, 0.05), K(0.55, 0), K(KD, 0)],
    pz:      [K(0, 0), K(0.08, 0.15), K(KI, 0.30, EI), K(KH, 0.32), K(0.44, 0.22), K(0.55, 0.01), K(KD, 0)],
    hipYaw:  [K(0, 0), K(0.06, -0.10, EO), K(0.215, 1.15, EI), K(KH, 1.12), K(0.40, 0.5), K(0.52, 0.05), K(KD, 0)],
    spYaw:   [K(0, 0), K(0.06, 0), K(KI, 0.18), K(0.33, 0.12), K(0.46, 0), K(KD, 0)],
    spRoll:  [K(0, 0), K(KI, -0.14), K(0.44, -0.06), K(KD, 0)],
    spPitch: [K(0, 0), K(0.08, -0.06), K(KI, -0.30), K(KH, -0.32), K(0.44, -0.10), K(0.56, 0), K(KD, 0)],
    hdPitch: [K(0, 0), K(KI, 0.22), K(0.44, 0.06), K(KD, 0)],
    hdYaw:   [K(0, 0), K(KI, -0.55), K(0.40, -0.30), K(KD, 0)],
    hRx:     [K(0, 0), K(KI, -0.06), K(KD, 0)],
    hRz:     [K(0, 0), K(KI, -0.04), K(KD, 0)],
    elvR:    [K(0, 0), K(KI, 0.15), K(KD, 0)],
    hLx:     [K(0, 0), K(KI, 0.04), K(KD, 0)],
    // pie de apoyo (L): paso adelante/afuera EN EL AIRE y pivote sobre la bola; vuelve en el aire (0.44–0.54)
    fLx:     [K(0, 0), K(0.08, 0.10), K(0.44, 0.10, LIN), K(0.54, 0), K(KD, 0)],
    fLz:     [K(0, 0), K(0.08, 0.36), K(0.44, 0.36, LIN), K(0.54, 0), K(KD, 0)],
    fLy:     [K(0, 0), K(0.035, 0.04, EO), K(0.08, 0, EI), K(0.44, 0, LIN), K(0.49, 0.035, EO), K(0.54, 0, EI), K(KD, 0)],
    fLyaw:   [K(0, 0), K(0.08, 0), K(KI, 1.25, EI), K(0.44, 1.25, LIN), K(0.54, 0.0), K(KD, 0)],
    fLpitch: [K(0, 0), K(0.09, 0), K(KI, -0.55), K(0.30, -0.5), K(0.44, -0.5, LIN), K(0.54, 0), K(KD, 0)],
    // pie que patea (R): sale, chamber -> barrido con ease-in -> hit-stop -> pliega -> baja en su sitio
    fRx: [K(0, 0), K(0.06, 0.03), K(0.13, 0.12), K(KI, 0.29, EI), K(KH, 0.29, LIN), K(0.36, 0.15), K(0.48, 0), K(KD, 0)],
    fRz: [K(0, 0), K(0.06, 0.08), K(0.13, 0.30), K(KI, 1.30, EI), K(KH, 1.30, LIN), K(0.36, 0.40), K(0.48, 0), K(KD, 0)],
    fRy: [K(0, 0), K(0.06, 0.08, EO), K(0.13, 0.24), K(KI, 0.50, EO), K(KH, 0.50, LIN), K(0.36, 0.28), K(0.45, 0.05, EI), K(0.50, 0), K(KD, 0)],
    fRyaw: [K(0, 0), K(0.13, 0.2), K(KI, 1.3), K(0.36, 0.6), K(0.50, 0), K(KD, 0)],
    fRpitch: [K(0, 0), K(KI, -0.4), K(0.38, -0.2), K(0.50, 0), K(KD, 0)],
  },
};
LOWKICK.aim = { zone: 'legs', dy: null, ref: [0.130, 0.646, 0.977] };   // ronda 6: la espinilla para en el muslo más cercano, a su altura

// BLOQUEO: pose sostenida (deltas sobre la guardia): codos adentro, antebrazos tapando la cara, mentón al pecho, cuerpo hundido y encogido.
export const BLOCK_POSE = Object.freeze({
  dy: -0.035, spPitch: 0.12, hdPitch: 0.16, shrugL: 0.07, shrugR: 0.07, protL: 0.05, protR: 0.05,
  hLx: -0.07, hLy: 0.09, hLz: -0.02, hRx: 0.05, hRy: 0.08, hRz: -0.02, elbL: -0.10, elbR: -0.10,
});
const blockTracks = () => { const t = {}; for (const c in BLOCK_POSE) t[c] = [K(0, 0), K(0.09, BLOCK_POSE[c], 'easeOutQuad'), K(0.45, BLOCK_POSE[c], 'linear'), K(0.60, 0)]; return t; };
export const BLOCK = { name: 'block', duration: 0.60, impactT: 0.30, tip: 'L', phases: [{ name: 'raise', t0: 0, t1: 0.09 }, { name: 'hold', t0: 0.09, t1: 0.45 }, { name: 'lower', t0: 0.45, t1: 0.6 }], tracks: blockTracks() };

export const CLIPS = { jab: JAB, cross: CROSS, hook: HOOK, lowkick: LOWKICK, block: BLOCK, feint_hook: FEINT_HOOK };


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
// wHead (ronda 4): peso aparte para los canales de cabeza (hd*): las reacciones escalan cuerpo/pelvis con la fuerza más que el cuello.
export function addClip(clip, t, w, out, wHead = w) {
  for (const c in clip.tracks) out[c] += (c.charCodeAt(0) === 104 && c.charCodeAt(1) === 100 ? wHead : w) * sampleTrack(clip.tracks[c], t);
}
export function phaseAt(clip, t) {
  for (const p of clip.phases) if (t < p.t1) return p.name;
  return clip.phases[clip.phases.length - 1].name;
}
