// ground.js — ronda 7: SUELO (ground and pound). La sim (combat-gap) en fase de suelo deja las dos raíces en el MISMO punto con rumbos
// opuestos y marca state.stance = 'groundTop' | 'groundBottom' y state.groundPos = 'guard'|'half'|'side'|'mount'|'back'.
// Capa de pose ABSOLUTA (reemplaza la guardia de pie, con peso por resorte) + piernas por FK (kw = 1, como el KO):
//   abajo  : tendido boca arriba, cabeza hacia ADELANTE del de arriba (detrás de su propia raíz); piernas según la posición
//            (mount: rodillas arriba, pies plantados; guard: piernas abiertas alrededor de la cintura; side: rodillas hacia el lado).
//   arriba : de rodillas. mount: sentado sobre el abdomen, tronco ~50° adelante; guard: de rodillas entre las piernas;
//            side: cruzado sobre el pecho (cadera girada 90°).
// Golpes: gnp_punch (puño R a la cabeza), gnp_elbow (CODO R a la cabeza: punta = codo), gnp_body (puño L al torso). Se suman sobre la capa.
// Reacción: hurt_ground (la cabeza del que está abajo va contra el suelo y rebota; el animador la limita a la superficie del suelo).
import { CLIPS, HITSTOP } from './clips.js';

const K = (t, v, e = 'easeInOutQuad') => [t, v, e];
const EI = 'easeInQuad', EO = 'easeOutQuad', LIN = 'linear';

// valores ABSOLUTOS de canal (los que faltan van a su valor de guardia). Pelvis: dy relativo a ~0,80 (tobillo + cadera de guardia).
const BOT_BASE = {
  dy: -0.68, pz: 0.10, px: 0, hipYaw: 0, hipRoll: 0, hipPitch: -1.50, spYaw: 0, spPitch: 0.02, spRoll: 0,
  hdYaw: 0, hdPitch: 0.30, hdRoll: 0, shrugL: 0, shrugR: 0, protL: 0.05, protR: 0.05,
  // manos: guardia de suelo delante de la cara (rel = muñeca - hombro en el marco de rumbo: x izq, y arriba, z adelante)
  hLx: 0.12, hLy: 0.14, hLz: -0.16, hRx: -0.12, hRy: 0.14, hRz: -0.16, elbL: 0.25, elbR: 0.25, elvL: 0.3, elvR: 0.3,
  kw: 1, kHL: 0.85, kKL: 1.55, kAL: 0.10, kFL: 0, kHR: 0.85, kKR: 1.55, kAR: 0.10, kFR: 0,
};
const TOP_BASE = {
  dy: -0.40, pz: 0.12, px: 0, hipYaw: 0, hipRoll: 0, hipPitch: 0.62, spYaw: 0, spPitch: 0.55, spRoll: 0,
  hdYaw: 0, hdPitch: -0.35, hdRoll: 0, shrugL: 0.08, shrugR: 0.08, protL: 0.1, protR: 0.1,
  hLx: -0.04, hLy: -0.12, hLz: 0.26, hRx: 0.06, hRy: -0.05, hRz: 0.22, elbL: -0.05, elbR: -0.05, elvL: 0.15, elvR: 0.15,
  kw: 1, kHL: 0.57, kKL: 1.74, kAL: 0.55, kFL: 1, kHR: 0.57, kKR: 1.74, kAR: 0.55, kFR: 1,
};
export const GROUND_POSES = {
  bottom: {
    mount: { ...BOT_BASE },
    guard: { ...BOT_BASE, pz: 0.08, hipPitch: -1.35, kHL: 1.45, kKL: 1.35, kAL: 0.55, kFL: 0.6, kHR: 1.45, kKR: 1.35, kAR: 0.55, kFR: 0.6 },
    half:  { ...BOT_BASE, pz: 0.0, kHL: 1.20, kKL: 1.40, kAL: 0.40, kHR: 0.30, kKR: 0.60, kAR: 0.15 },
    side:  { ...BOT_BASE, kHL: 1.00, kKL: 1.50, kAL: -0.10, kHR: 1.00, kKR: 1.50, kAR: 0.30, hipRoll: 0.20 },
    back:  { ...BOT_BASE },
  },
  top: {
    mount: { ...TOP_BASE },
    guard: { ...TOP_BASE, dy: -0.33, pz: -0.16, hipPitch: 0.55, spPitch: 0.50, kHL: 0.15, kKL: 1.65, kAL: 0.25, kHR: 0.15, kKR: 1.65, kAR: 0.25 },
    half:  { ...TOP_BASE, dy: -0.36, pz: -0.05, kAL: 0.35, kAR: 0.45 },
    side:  { ...TOP_BASE, dy: -0.46, px: 0.40, pz: 0.56, hipYaw: -1.45, hipPitch: 0.55, spPitch: 0.45, kHL: 0.55, kKL: 2.10, kAL: 0.35, kHR: 0.55, kKR: 2.10, kAR: 0.35 },
    back:  { ...TOP_BASE, pz: -0.10 },
  },
};
export const GROUND_KEYS = ['guard', 'half', 'side', 'mount', 'back'];

// ---- golpes de suelo (deltas sobre la capa del de arriba). Tiempos de la sim: gnpPunch [9,3,12], gnpElbow [11,3,14], gnpBody [9,3,12] ticks.
export const GNP_TICKS = Object.freeze({ gnp_punch: [9, 3, 12], gnp_elbow: [11, 3, 14], gnp_body: [9, 3, 12] });
const tk = (n) => { const [s, a, r] = GNP_TICKS[n]; return { I: s / 60, D: (s + a + r) / 60, H: s / 60 + HITSTOP }; };
function gnpPunch() {
  const { I, D, H } = tk('gnp_punch'), tW = I * 0.45;
  return {
    name: 'gnp_punch', duration: D, impactT: I, tip: 'R', ground: true,
    phases: [{ name: 'load', t0: 0, t1: tW }, { name: 'strike', t0: tW, t1: H }, { name: 'recover', t0: H, t1: D }],
    tracks: {
      // carga: el puño sube junto a la oreja, el hombro se abre; golpe: cadera y hombro bajan y giran hacia el blanco, el brazo se estira
      hRy:   [K(0, 0), K(tW, 0.12, EO), K(I, -0.27, EI), K(H, -0.27), K(D, 0)],
      hRz:   [K(0, 0), K(tW, -0.14, EO), K(I, -0.12, EI), K(H, -0.12), K(D, 0)],
      hRx:   [K(0, 0), K(tW, -0.04), K(I, -0.04, EI), K(H, -0.04), K(D, 0)],
      elbR:  [K(0, 0), K(tW, 0.30), K(I, 0.05), K(D, 0)], elvR: [K(0, 0), K(tW, 0.35), K(I, 0.10), K(D, 0)],
      spYaw: [K(0, 0), K(tW, -0.15, EO), K(I, 0.25, EI), K(H, 0.25), K(D, 0)],
      spPitch:[K(0, 0), K(tW, -0.10), K(I, 0.15, EI), K(H, 0.15), K(D, 0)],
      dy:    [K(0, 0), K(tW, 0.04), K(I, -0.03, EI), K(H, -0.03), K(D, 0)],
      hLy:   [K(0, 0), K(I, -0.05), K(D, 0)],
    },
    aim: { zone: 'head', center: true, dy: 0 },
  };
}
function gnpElbow() {
  const { I, D, H } = tk('gnp_elbow'), tW = I * 0.5;
  return {
    name: 'gnp_elbow', duration: D, impactT: I, tip: 'elbowR', ground: true,
    phases: [{ name: 'load', t0: 0, t1: tW }, { name: 'strike', t0: tW, t1: H }, { name: 'recover', t0: H, t1: D }],
    tracks: {
      // carga: el codo sube por encima del hombro (mano junto a la oreja, polo arriba/afuera); golpe: el antebrazo plegado, el polo apunta
      // abajo/adelante y el tronco cae con el peso => la PUNTA DEL CODO baja sobre la cara
      hRx:   [K(0, 0), K(tW, -0.04), K(I, 0.17, EI), K(H, 0.17), K(D, 0)],
      hRy:   [K(0, 0), K(tW, 0.12, EO), K(I, -0.02, EI), K(H, -0.02), K(D, 0)],
      hRz:   [K(0, 0), K(tW, -0.18, EO), K(I, -0.30, EI), K(H, -0.30), K(D, 0)],
      pRw:   [K(0, 0), K(tW * 0.6, 1), K(H, 1), K(D, 0)],
      pRx:   [K(0, 0), K(tW, -0.35), K(I, 0.05, EI), K(H, 0.05), K(D, 0)],
      pRy:   [K(0, 0), K(tW, 0.35), K(I, -0.8, EI), K(H, -0.8), K(D, 0)],
      pRz:   [K(0, 0), K(tW, 0.9), K(I, 0.9, EI), K(H, 0.9), K(D, 0)],
      spYaw: [K(0, 0), K(tW, -0.25, EO), K(I, 0.25, EI), K(H, 0.25), K(D, 0)],
      spPitch:[K(0, 0), K(tW, -0.15), K(I, 0.10, EI), K(H, 0.10), K(D, 0)],
      hipPitch:[K(0, 0), K(tW, -0.05), K(I, 0.05, EI), K(H, 0.05), K(D, 0)],
      dy:    [K(0, 0), K(tW, 0.06), K(I, -0.04, EI), K(H, -0.04), K(D, 0)],
    },
    aim: { zone: 'head', center: true, dy: 0 },
  };
}
function gnpBody() {
  const { I, D, H } = tk('gnp_body'), tW = I * 0.45;
  return {
    name: 'gnp_body', duration: D, impactT: I, tip: 'L', ground: true,
    phases: [{ name: 'load', t0: 0, t1: tW }, { name: 'strike', t0: tW, t1: H }, { name: 'recover', t0: H, t1: D }],
    tracks: {
      hLy:   [K(0, 0), K(tW, 0.20, EO), K(I, -0.30, EI), K(H, -0.30), K(D, 0)],
      hLz:   [K(0, 0), K(tW, -0.10, EO), K(I, -0.36, EI), K(H, -0.36), K(D, 0)],
      hLx:   [K(0, 0), K(tW, 0.05), K(I, -0.04), K(D, 0)],
      spPitch:[K(0, 0), K(I, 0.10, EI), K(H, 0.10), K(D, 0)],
      elbL:  [K(0, 0), K(tW, 0.25), K(I, 0.05), K(D, 0)],
      spYaw: [K(0, 0), K(tW, 0.20, EO), K(I, -0.25, EI), K(H, -0.25), K(D, 0)],
      dy:    [K(0, 0), K(I, -0.03, EI), K(H, -0.03), K(D, 0)],
    },
    aim: { zone: 'body', center: true, u: 0.8, dy: 0 },
  };
}
export const GNP_PUNCH = gnpPunch(), GNP_ELBOW = gnpElbow(), GNP_BODY = gnpBody();
// ---- reacción del que está abajo: la cabeza se va contra el suelo (el animador la frena EN la superficie) y rebota; el tronco se encoge.
export const HURT_GROUND = {
  name: 'hurt_ground', duration: 0.55, impactT: 0, tip: 'L', ground: true,
  phases: [{ name: 'snap', t0: 0, t1: 0.06 }, { name: 'bounce', t0: 0.06, t1: 0.20 }, { name: 'settle', t0: 0.20, t1: 0.55 }],
  tracks: {
    hdPitch: [K(0, 0), K(0.05, -0.75, EI), K(0.13, 0.12, EO), K(0.22, -0.10), K(0.32, 0.04), K(0.55, 0)],
    hdYaw:   [K(0, 0), K(0.06, 0.25, EO), K(0.30, 0.08), K(0.55, 0)],
    spPitch: [K(0, 0), K(0.06, -0.06), K(0.16, 0.06), K(0.55, 0)],
    hLy:     [K(0, 0), K(0.08, -0.06), K(0.55, 0)], hRy: [K(0, 0), K(0.08, -0.06), K(0.55, 0)],
  },
};
// cuerpo (gnp_body): el tronco se encoge (rodillas y codos adentro), la cabeza apenas se levanta y vuelve; sin sentarse
export const HURT_GROUND_BODY = {
  name: 'hurt_ground_body', duration: 0.50, impactT: 0, tip: 'L', ground: true,
  phases: [{ name: 'snap', t0: 0, t1: 0.07 }, { name: 'curl', t0: 0.07, t1: 0.22 }, { name: 'settle', t0: 0.22, t1: 0.50 }],
  tracks: {
    spPitch: [K(0, 0), K(0.07, 0.12, EO), K(0.22, 0.08), K(0.50, 0)],
    hipPitch:[K(0, 0), K(0.07, 0.05, EO), K(0.50, 0)],
    hdPitch: [K(0, 0), K(0.07, 0.15, EO), K(0.25, 0.05), K(0.50, 0)],
    kHL:     [K(0, 0), K(0.10, 0.15, EO), K(0.50, 0)], kHR: [K(0, 0), K(0.10, 0.15, EO), K(0.50, 0)],
    elbL:    [K(0, 0), K(0.08, -0.15), K(0.50, 0)], elbR: [K(0, 0), K(0.08, -0.15), K(0.50, 0)],
    hLy:     [K(0, 0), K(0.08, -0.08), K(0.50, 0)], hRy: [K(0, 0), K(0.08, -0.08), K(0.50, 0)],
  },
};
CLIPS.hurt_ground_body = HURT_GROUND_BODY;
// punta LIBRE prevista en el impacto por posición (marco raíz [izq, altura, adelante]; medida con link:false) para el ajuste al blanco
GNP_PUNCH.aim.refPos = {mount: [-0.01, 0.23, 0.69], guard: [-0.012, 0.35, 0.404], side: [0.004, 0.256, 0.685], half: [-0.01, 0.27, 0.52], back: [-0.01, 0.23, 0.47]};
GNP_ELBOW.aim.refPos = {mount: [0.031, 0.364, 0.727], guard: [0.029, 0.479, 0.426], side: [0.113, 0.362, 0.608], half: [0.031, 0.404, 0.557], back: [0.031, 0.364, 0.507]};
GNP_BODY.aim.refPos = {mount: [-0.028, 0.137, 0.422], guard: [-0.03, 0.25, 0.126], side: [-0.116, 0.133, 0.554], half: [-0.028, 0.177, 0.252], back: [-0.028, 0.137, 0.202]};
for (const c of [GNP_PUNCH, GNP_ELBOW, GNP_BODY]) CLIPS[c.name] = c;
CLIPS.hurt_ground = HURT_GROUND;
// moves de la sim -> clips (para opts.clipMap de createLiveAnimation; el animador además remapea 'jab'/'lowkick' por state.move)
export const GROUND_MOVE_CLIP = Object.freeze({ gnpPunch: 'gnp_punch', gnpElbow: 'gnp_elbow', gnpBody: 'gnp_body' });   // guardElbow (codo desde abajo): pendiente
