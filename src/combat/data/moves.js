// Tabla de movimientos de KAGE (Rick Combate).
// Unidades: ticks a 60 Hz (startup/active/recovery). Distancias en PÍXELES entre anclas (pelvis–pelvis, en x),
// arena ±260px, stickman ~150px de alto (contracts UNITS.PX_PER_M = 85).
// Alcance de golpes de pie: SALE DE LOS CLIPS de src/anim (contacts.tipAnchor.x en el frame de impacto, escala 1:1
// de Engine). rangeMin/rangeMax/rangeIdeal se calculan con CLIP_REACH + TARGET_OFFSET (ver reachWindow). Para
// re-medir tras cambiar un clip: node src/fight/reach.mjs (falla si CLIP_REACH quedó desactualizado).
// El resto de distancias (lunge, knockback, rangos de clinch/derribo) se escribe en "metros de stickman" y M() las
// pasa a px con PX_PER_M, salvo que el movimiento traiga rangePx.
// damage: puntos de daño a la zona (escala ~100 = zona destruida). ko: potencial de KO (0..1).
// accuracy: probabilidad base de conectar contra rival neutro. telegraph: 0 (invisible) .. 1 (se ve venir).
// limb: articulación de JOINTS que impacta. angle: dirección del impacto en grados, marco local del atacante
//   (+x adelante, +y abajo): 0 recto, negativo = hacia arriba (uppercut), positivo = hacia abajo (codo/GnP).
// arc: forma de la trayectoria para el Animador: straight | hook | upper | over | spin | push | knee | shoot.
// clip: clip de src/anim que representa el golpe (tick.animClip). phase: stand | clinch | ground. side (suelo): top | bottom.
import { UNITS } from '../kage-contracts.js';

export const PX_PER_M = UNITS.PX_PER_M; // 85: 1.75 m ≈ 150 px

/** Punta del miembro respecto del ancla (pelvis) del atacante en el frame de impacto (px, medido con src/fight/reach.mjs). */
export const CLIP_REACH = Object.freeze({
  jab: { tip: 91.9, y: -132 }, cross: { tip: 94.1, y: -131 }, hook: { tip: 79.2, y: -133 }, uppercut: { tip: 39.4, y: -176 },
  lowKick: { tip: 95.0, y: -38 }, highKick: { tip: 74.0, y: -142 }, knee: { tip: 56.2, y: -113 }, elbow: { tip: 68.3, y: -134 },
  shoot: { tip: 116.3, y: -45 },
});
/** Zona del rival en guardia, px desde SU ancla (pelvis) hacia el atacante (medido con reach.mjs sobre el esqueleto de src/anim):
 *  center = punto de contacto ideal, front = superficie. */
export const TARGET_OFFSET = Object.freeze({
  head: { center: 8.8, front: 20.8 },  // centro de la cabeza (radio 12)
  body: { center: 0.9, front: 11 },    // torso: punto medio cuello–columna
  legs: { center: 31.9, front: 35 },   // canilla de la pierna adelantada a la altura del lowKick (y −38)
});
/** Tolerancia (px) de la ventana de impacto: ni atraviesa ni se queda corto más que esto. */
export const REACH_TOL = 6;
/**
 * QUÉ MIDE `range`: distancia pelvis–pelvis (ancla–ancla, |a.x − b.x|) EN EL TICK DE IMPACTO.
 * rangeIdeal = tip del clip + centro de la zona del rival; ventana [ideal − REACH_TOL, ideal + REACH_TOL].
 * La sim ajusta el paso/estocada durante el startup para llegar al ideal; si en el impacto la distancia queda fuera
 * de la ventana el golpe es whiff ('short' si quedó largo, 'jammed' si quedó encima).
 */
export function reachWindow(clip, zone) {
  const r = CLIP_REACH[clip], t = TARGET_OFFSET[zone];
  const ideal = r.tip + t.center;
  const r1 = (x) => Math.round(x * 10) / 10;
  return { rangeMin: r1(ideal - REACH_TOL), rangeMax: r1(ideal + REACH_TOL), rangeIdeal: r1(ideal) };
}

/** Compensa el menor volumen/precisión de golpes (ritmo pro: menos golpes/min, jab 40% de lo lanzado): el daño por golpe de pie sube. */
export const STAND_DMG_MUL = Object.freeze({ punch: 2.2, other: 1.3 });
const PX_FIELDS = ['rangeMin', 'rangeMax', 'lunge', 'knockback'];
const M = (id, o) => {
  const out = { id, name: o.name ?? id, ...o };
  for (const k of PX_FIELDS) if (out[k] != null) out[k] = Math.round(out[k] * PX_PER_M * 10) / 10;
  if (o.rangePx) { out.rangeMin = o.rangePx[0]; out.rangeMax = o.rangePx[1]; out.rangeIdeal = o.rangePx[2] ?? Math.round((o.rangePx[0] + o.rangePx[1]) / 2); delete out.rangePx; }
  if (out.phase === 'stand' && out.kind === 'strike') out.damage = Math.round(out.damage * (out.limb.startsWith('hand') ? STAND_DMG_MUL.punch : STAND_DMG_MUL.other) * 100) / 100;
  if (out.phase === 'stand' && out.kind === 'strike') Object.assign(out, reachWindow(out.clip, out.zone));
  return Object.freeze(out);
};

const _MOVES = {
  // ---------- De pie: puños ----------
  jab:        M('jab',        { clip: 'jab', kind: 'strike', phase: 'stand', startup: 6,  active: 3, recovery: 10,  stamina: 1.6, damage: 3,  zone: 'head', limb: 'handL', arc: 'straight', angle: 0,   accuracy: 0.40, telegraph: 0.10, ko: 0.04, counterable: 0.25 }),
  cross:      M('cross',      { cut: 0.02, clip: 'cross', kind: 'strike', phase: 'stand', startup: 9,  active: 3, recovery: 14,  stamina: 2.6, damage: 7,  zone: 'head', limb: 'handR', arc: 'straight', angle: 0,   accuracy: 0.60, telegraph: 0.25, ko: 0.30, counterable: 0.45 }),
  hook:       M('hook',       { cut: 0.035, clip: 'hook', kind: 'strike', phase: 'stand', startup: 11, active: 3, recovery: 15,  stamina: 3.0, damage: 9,  zone: 'head', limb: 'handL', arc: 'hook',     angle: 0,   accuracy: 0.50, telegraph: 0.35, ko: 0.55, counterable: 0.55 }),
  uppercut:   M('uppercut',   { short: true, cut: 0.015, clip: 'uppercut', kind: 'strike', phase: 'stand', startup: 11, active: 3, recovery: 15,  stamina: 3.0, damage: 9,  zone: 'head', limb: 'handR', arc: 'upper',    angle: -70, accuracy: 0.50, telegraph: 0.30, ko: 0.50, counterable: 0.55 }),
  overhand:   M('overhand',   { cut: 0.025, clip: 'cross', kind: 'strike', phase: 'stand', startup: 14, active: 3, recovery: 18,   stamina: 3.6, damage: 10, zone: 'head', limb: 'handR', arc: 'over',     angle: 30,  accuracy: 0.44, telegraph: 0.50, ko: 0.55, counterable: 0.6 }),
  bodyHook:   M('bodyHook',   { clip: 'hook', kind: 'strike', phase: 'stand', startup: 11, active: 3, recovery: 15,  stamina: 2.8, damage: 8,  zone: 'body', limb: 'handL', arc: 'hook',     angle: 10,  accuracy: 0.56, telegraph: 0.30, ko: 0.20, counterable: 0.5 }),
  bodyCross:  M('bodyCross',  { clip: 'cross', kind: 'strike', phase: 'stand', startup: 9,  active: 3, recovery: 14,  stamina: 2.5, damage: 6,  zone: 'body', limb: 'handR', arc: 'straight', angle: 15,  accuracy: 0.60, telegraph: 0.25, ko: 0.10, counterable: 0.45 }),
  supermanPunch: M('supermanPunch', { clip: 'cross', name: 'superman punch', kind: 'strike', phase: 'stand', startup: 16, active: 3, recovery: 18,  stamina: 4.2, damage: 9, zone: 'head', limb: 'handR', arc: 'over', angle: 15, accuracy: 0.42, telegraph: 0.45, ko: 0.45, counterable: 0.5, lunge: 0.45, expert: true}),
  spinningBackfist: M('spinningBackfist', { clip: 'hook', name: 'spinning backfist', kind: 'strike', phase: 'stand', startup: 18, active: 4, recovery: 22,  stamina: 4.5, damage: 11, zone: 'head', limb: 'handR', arc: 'spin', angle: 0, accuracy: 0.32, telegraph: 0.55, ko: 0.65, counterable: 0.7, expert: true}),

  // ---------- De pie: patadas / rodillas / codos ----------
  teep:       M('teep',       { clip: 'lowKick', kind: 'strike', phase: 'stand', startup: 12, active: 4, recovery: 15,   stamina: 3.0, damage: 5,  zone: 'body', limb: 'footL', arc: 'push',     angle: 0,   accuracy: 0.62, telegraph: 0.35, ko: 0.02, counterable: 0.3, knockback: 0.45 }),
  lowKick:    M('lowKick',    { clip: 'lowKick', kind: 'strike', phase: 'stand', startup: 14, active: 4, recovery: 18,  stamina: 3.5, damage: 8,  zone: 'legs', limb: 'footR', arc: 'hook',     angle: 20,  accuracy: 0.70, telegraph: 0.35, ko: 0.0,  counterable: 0.55, checkable: true, catchable: 0.15 }),
  calfKick:   M('calfKick',   { clip: 'lowKick', name: 'calf kick', kind: 'strike', phase: 'stand', startup: 12, active: 4, recovery: 16,  stamina: 3.2, damage: 7, zone: 'legs', limb: 'footR', arc: 'hook', angle: 35, accuracy: 0.72, telegraph: 0.30, ko: 0.0, counterable: 0.5, checkable: true, catchable: 0.05 }),
  bodyKick:   M('bodyKick',   { clip: 'highKick', kind: 'strike', phase: 'stand', startup: 16, active: 4, recovery: 20,   stamina: 4.4, damage: 11, zone: 'body', limb: 'footR', arc: 'hook',     angle: 0,   accuracy: 0.55, telegraph: 0.45, ko: 0.25, counterable: 0.55, catchable: 0.35 }),
  highKick:   M('highKick',   { clip: 'highKick', kind: 'strike', phase: 'stand', startup: 19, active: 4, recovery: 24,   stamina: 5.2, damage: 15, zone: 'head', limb: 'footR', arc: 'hook',     angle: -20, accuracy: 0.36, telegraph: 0.55, ko: 0.85, counterable: 0.65, catchable: 0.2 }),
  flyingKnee: M('flyingKnee', { short: true, clip: 'knee', name: 'flying knee', kind: 'strike', phase: 'stand', startup: 20, active: 4, recovery: 26,  stamina: 6.0, damage: 15, zone: 'head', limb: 'kneeR', arc: 'knee', angle: -40, accuracy: 0.33, telegraph: 0.55, ko: 0.9, counterable: 0.75, lunge: 0.6, expert: true}),
  standElbow: M('standElbow', { short: true, clip: 'elbow', name: 'elbow', kind: 'strike', phase: 'stand', startup: 9, active: 3, recovery: 14,  stamina: 2.8, damage: 10, zone: 'head', limb: 'elbowR', arc: 'over', angle: 25, accuracy: 0.50, telegraph: 0.35, ko: 0.5, counterable: 0.5, cut: 0.36 }),

  // ---------- Clinch ----------
  clinchEntry: M('clinchEntry', { clip: 'guard', name: 'collar tie', kind: 'clinch', phase: 'stand', startup: 10, active: 4, recovery: 10,  rangePx: [44, 82, 62], stamina: 2.5, damage: 0, zone: 'body', limb: 'handR', arc: 'push', angle: 0, accuracy: 0.6, telegraph: 0.35, ko: 0 }),
  clinchKnee:  M('clinchKnee',  { clip: 'knee', name: 'knee to body', kind: 'strike', phase: 'clinch', startup: 10, active: 3, recovery: 14, rangeMin: 0, rangeMax: 1, stamina: 3.0, damage: 9, zone: 'body', limb: 'kneeR', arc: 'knee', angle: -30, accuracy: 0.68, telegraph: 0.25, ko: 0.2 }),
  clinchKneeHead: M('clinchKneeHead', { cut: 0.1, clip: 'knee', name: 'thai clinch knee', kind: 'strike', phase: 'clinch', startup: 12, active: 3, recovery: 16, rangeMin: 0, rangeMax: 1, stamina: 3.6, damage: 12, zone: 'head', limb: 'kneeL', arc: 'knee', angle: -50, accuracy: 0.52, telegraph: 0.35, ko: 0.65 }),
  clinchElbow: M('clinchElbow', { clip: 'elbow', name: 'clinch elbow', kind: 'strike', phase: 'clinch', startup: 9, active: 3, recovery: 13, rangeMin: 0, rangeMax: 1, stamina: 2.8, damage: 9, zone: 'head', limb: 'elbowR', arc: 'hook', angle: 20, accuracy: 0.52, telegraph: 0.3, ko: 0.45, cut: 0.4 }),
  dirtyUppercut: M('dirtyUppercut', { clip: 'uppercut', name: 'short uppercut', kind: 'strike', phase: 'clinch', startup: 8, active: 3, recovery: 12, rangeMin: 0, rangeMax: 1, stamina: 2.2, damage: 6, zone: 'head', limb: 'handR', arc: 'upper', angle: -70, accuracy: 0.6, telegraph: 0.2, ko: 0.3 }),
  bodyLockTrip: M('bodyLockTrip', { clip: 'shoot', name: 'body lock trip', kind: 'takedown', phase: 'clinch', startup: 14, active: 8, recovery: 16, rangeMin: 0, rangeMax: 1, stamina: 5.0, damage: 3, zone: 'body', limb: 'footR', arc: 'push', angle: 60, accuracy: 0.5, telegraph: 0.35, ko: 0, lands: 'half' }),
  breakClinch: M('breakClinch', { clip: 'guard', name: 'break', kind: 'escape', phase: 'clinch', startup: 8, active: 4, recovery: 8, rangeMin: 0, rangeMax: 1, stamina: 2.0, damage: 0, zone: 'body', limb: 'handL', arc: 'push', angle: 0, accuracy: 0.6, telegraph: 0.2, ko: 0 }),

  // ---------- Derribos ----------
  doubleLeg:  M('doubleLeg',  { clip: 'shoot', name: 'double leg', kind: 'takedown', phase: 'stand', startup: 14, active: 8, recovery: 20,  rangePx: [70, 150, 128], stamina: 6.0, damage: 3, zone: 'body', limb: 'shoulderR', arc: 'shoot', angle: 10, accuracy: 0.5, telegraph: 0.55, ko: 0, lands: 'guard', lunge: 0.5 }),
  singleLeg:  M('singleLeg',  { clip: 'shoot', name: 'single leg', kind: 'takedown', phase: 'stand', startup: 12, active: 10, recovery: 18,  rangePx: [66, 142, 124], stamina: 5.0, damage: 2, zone: 'legs', limb: 'handR', arc: 'shoot', angle: 20, accuracy: 0.48, telegraph: 0.4, ko: 0, lands: 'half', lunge: 0.4 }),

  // ---------- Suelo: arriba ----------
  gnpPunch:   M('gnpPunch',   { clip: 'cross', name: 'ground punch', kind: 'strike', phase: 'ground', side: 'top', pos: ['guard', 'half', 'side', 'mount', 'back'], startup: 9, active: 3, recovery: 12, rangeMin: 0, rangeMax: 1, stamina: 2.4, damage: 6, zone: 'head', limb: 'handR', arc: 'over', angle: 80, accuracy: 0.55, telegraph: 0.25, ko: 0.25 }),
  gnpElbow:   M('gnpElbow',   { clip: 'elbow', name: 'ground elbow', kind: 'strike', phase: 'ground', side: 'top', pos: ['half', 'side', 'mount'], startup: 11, active: 3, recovery: 14, rangeMin: 0, rangeMax: 1, stamina: 3.0, damage: 9, zone: 'head', limb: 'elbowR', arc: 'over', angle: 85, accuracy: 0.5, telegraph: 0.3, ko: 0.35, cut: 0.38 }),
  gnpBody:    M('gnpBody',    { clip: 'jab', name: 'ground body shot', kind: 'strike', phase: 'ground', side: 'top', pos: ['guard', 'half', 'side'], startup: 9, active: 3, recovery: 12, rangeMin: 0, rangeMax: 1, stamina: 2.2, damage: 6, zone: 'body', limb: 'handL', arc: 'over', angle: 70, accuracy: 0.62, telegraph: 0.2, ko: 0.05 }),
  pass:       M('pass',       { name: 'guard pass', kind: 'advance', phase: 'ground', side: 'top', pos: ['guard', 'half', 'side'], startup: 18, active: 10, recovery: 10, rangeMin: 0, rangeMax: 1, stamina: 4.0, damage: 0, zone: 'body', limb: 'handR', arc: 'push', angle: 0, accuracy: 0.42, telegraph: 0.4, ko: 0 }),
  takeBack:   M('takeBack',   { name: 'take the back', kind: 'advance', phase: 'ground', side: 'top', pos: ['side', 'mount'], startup: 16, active: 10, recovery: 10, rangeMin: 0, rangeMax: 1, stamina: 4.0, damage: 0, zone: 'body', limb: 'handR', arc: 'push', angle: 0, accuracy: 0.35, telegraph: 0.4, ko: 0 }),
  disengage:  M('disengage',  { clip: 'getUp', name: 'stand up (top)', kind: 'escape', phase: 'ground', side: 'top', pos: ['guard', 'half'], startup: 14, active: 6, recovery: 10, rangeMin: 0, rangeMax: 1, stamina: 2.0, damage: 0, zone: 'body', limb: 'footL', arc: 'push', angle: 0, accuracy: 0.8, telegraph: 0.2, ko: 0 }),
  // Sumisiones animadas (Ronda 17). clip = id exacto para Animador; emitir subClipOf(mv).
  // Canonical ids internos (rnc/armbarTop/…) conservan RNG; aliases: rearNaked, juji, americana, heelhook, kneebar.
  rnc:        M('rnc',        { clip: 'rearNaked', name: 'rear naked choke', kind: 'sub', phase: 'ground', side: 'top', pos: ['back'], startup: 14, active: 1, recovery: 14, rangeMin: 0, distanceMax: 1, stamina: 5.0, damage: 0, zone: 'head', limb: 'elbowR', arc: 'push', angle: 0, accuracy: 0.6, telegraph: 0.3, ko: 0, subPower: 1.35, choke: true }),
  armbarTop:  M('armbarTop',  { clip: 'armbar', name: 'armbar (mount)', kind: 'sub', phase: 'ground', side: 'top', pos: ['mount'], startup: 18, active: 1, recovery: 18, rangeMin: 0, distanceMax: 1, stamina: 5.5, damage: 0, zone: 'body', limb: 'hipR', arc: 'push', angle: 0, accuracy: 0.5, telegraph: 0.4, ko: 0, subPower: 1.0, lose: 'guardBottom', joint: 'elbowR' }),
  heelHook:   M('heelHook',   { clip: 'heelHook', name: 'heel hook', kind: 'sub', phase: 'ground', side: 'top', pos: ['half', 'side'], startup: 16, active: 1, recovery: 16, rangeMin: 0, distanceMax: 1, stamina: 5.0, damage: 0, zone: 'legs', limb: 'handR', arc: 'push', angle: 0, accuracy: 0.48, telegraph: 0.4, ko: 0, subPower: 0.95, joint: 'kneeR' }),
  kneeBar:    M('kneeBar',    { clip: 'kneeBar', name: 'knee bar', kind: 'sub', phase: 'ground', side: 'top', pos: ['mount', 'side'], startup: 18, active: 1, recovery: 18, distanceMin: 0, distanceMax: 1, stamina: 5.2, damage: 0, zone: 'legs', limb: 'hipR', arc: 'push', angle: 0, accuracy: 0.46, telegraph: 0.4, ko: 0, subPower: 0.7, joint: 'kneeR' }),
  armTriangle: M('armTriangle', { clip: 'armTriangle', name: 'arm triangle', kind: 'sub', phase: 'ground', side: 'top', pos: ['side', 'mount'], startup: 16, active: 1, recovery: 16, distanceMin: 0, distanceMax: 1, stamina: 5.0, damage: 0, zone: 'head', limb: 'shoulderR', arc: 'push', angle: 0, accuracy: 0.5, telegraph: 0.35, ko: 0, subPower: 0.78, choke: true }),
  kimura:     M('kimura',     { clip: 'kimura', name: 'kimura', kind: 'sub', phase: 'ground', side: 'top', pos: ['half', 'side'], startup: 16, active: 1, recovery: 16, distanceMin: 0, distanceMax: 1, stamina: 4.8, damage: 0, zone: 'body', limb: 'handR', arc: 'push', angle: 0, accuracy: 0.5, telegraph: 0.35, ko: 0, subPower: 0.85, joint: 'shoulderR' }),
  // ---------- Suelo: abajo ----------
  sweep:      M('sweep',      { name: 'sweep', kind: 'sweep', phase: 'ground', side: 'bottom', pos: ['guard', 'half'], startup: 16, active: 8, recovery: 14, rangeMin: 0, rangeMax: 1, stamina: 4.5, damage: 0, zone: 'body', limb: 'footR', arc: 'push', angle: -40, accuracy: 0.36, telegraph: 0.4, ko: 0 }),
  getUp:      M('getUp',      { clip: 'getUp', name: 'wall walk / technical stand-up', kind: 'escape', phase: 'ground', side: 'bottom', pos: ['guard', 'half', 'side'], startup: 18, active: 12, recovery: 10, rangeMin: 0, rangeMax: 1, stamina: 5.0, damage: 0, zone: 'body', limb: 'handL', arc: 'push', angle: -60, accuracy: 0.42, telegraph: 0.4, ko: 0 }),
  shrimp:     M('shrimp',     { name: 'shrimp / recover guard', kind: 'escape', phase: 'ground', side: 'bottom', pos: ['side', 'mount', 'back'], startup: 14, active: 8, recovery: 10, rangeMin: 0, rangeMax: 1, stamina: 4.0, damage: 0, zone: 'body', limb: 'hipL', arc: 'push', angle: 0, accuracy: 0.42, telegraph: 0.3, ko: 0 }),
  guardElbow: M('guardElbow', { clip: 'elbow', name: 'elbow from guard', kind: 'strike', phase: 'ground', side: 'bottom', pos: ['guard'], startup: 10, active: 3, recovery: 13, rangeMin: 0, rangeMax: 1, stamina: 2.4, damage: 5, zone: 'head', limb: 'elbowL', arc: 'over', angle: -10, accuracy: 0.5, telegraph: 0.3, ko: 0.12, cut: 0.25 }),
  armbarGuard: M('armbarGuard', { clip: 'armbar', name: 'armbar (guard)', kind: 'sub', phase: 'ground', side: 'bottom', pos: ['guard'], startup: 16, active: 1, recovery: 18, distanceMin: 0, distanceMax: 1, stamina: 5.2, damage: 0, zone: 'body', limb: 'hipL', arc: 'push', angle: 0, accuracy: 0.45, telegraph: 0.4, ko: 0, subPower: 0.9, joint: 'elbowL' }),
  triangle:   M('triangle',   { clip: 'triangle', name: 'triangle choke', kind: 'sub', phase: 'ground', side: 'bottom', pos: ['guard'], startup: 16, active: 1, recovery: 18, distanceMin: 0, distanceMax: 1, stamina: 5.2, damage: 0, zone: 'head', limb: 'kneeR', arc: 'push', angle: 0, accuracy: 0.45, telegraph: 0.35, ko: 0, subPower: 0.95, choke: true }),
  guillotine: M('guillotine', { clip: 'guillotine', name: 'guillotine', kind: 'sub', phase: 'ground', side: 'bottom', pos: ['guard', 'half'], startup: 12, active: 1, recovery: 16, distanceMin: 0, distanceMax: 1, stamina: 5.0, damage: 0, zone: 'head', limb: 'elbowR', arc: 'push', angle: 0, accuracy: 0.45, telegraph: 0.3, ko: 0, subPower: 0.65, choke: true }),
};

// Alias Animador (Ronda 17): misma entrada; subClipOf usa clip||id canónico.
_MOVES.rearNaked = _MOVES.rnc;
_MOVES.juji = _MOVES.armbarTop;
_MOVES.americana = _MOVES.kimura;
_MOVES.heelhook = _MOVES.heelHook;
_MOVES.kneebar = _MOVES.kneeBar;
export const MOVES = Object.freeze(_MOVES);

/** Id de clip de sumisión para Animador (armbar, kimura, triangle, rearNaked, heelHook, kneeBar, guillotine, armTriangle). */
export const subClipOf = (mv) => (typeof mv === 'string' ? (MOVES[mv]?.clip || mv) : (mv?.clip || mv?.id));

export const MOVE_IDS = Object.freeze(Object.keys(MOVES).filter((k) => MOVES[k].id === k)); // sin aliases duplicados en listas

// Listas útiles para la IA
export const STAND_STRIKES = MOVE_IDS.filter((k) => MOVES[k].phase === 'stand' && MOVES[k].kind === 'strike');
export const CLINCH_MOVES = MOVE_IDS.filter((k) => MOVES[k].phase === 'clinch');
export const GROUND_MOVES = MOVE_IDS.filter((k) => MOVES[k].phase === 'ground');
export const TAKEDOWNS = MOVE_IDS.filter((k) => MOVES[k].kind === 'takedown' && MOVES[k].phase === 'stand');

// Guillotina de pie: si el rival dispara mal y queda la cabeza afuera, se puede cazar desde el sprawl.
export const FRONT_HEADLOCK_SUB = 'guillotine';

// Jerarquía de posiciones en el suelo (desde la perspectiva de arriba).
export const GROUND_POSITIONS = Object.freeze(['guard', 'half', 'side', 'mount', 'back']);
export const POSITION_VALUE = Object.freeze({ guard: 1, half: 2, side: 3, mount: 4, back: 5 });
export const NEXT_POSITION = Object.freeze({ guard: 'half', half: 'side', side: 'mount', mount: 'mount', back: 'back' });
