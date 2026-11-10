// scenarios.js — escenarios deterministas (el "sim" que mueve la raíz) para pruebas, viewer y captura.
// La raíz pertenece al sim: aquí se genera en función de t; el animador solo la lee.
import { createAnimator3D, pairAnimators } from './animator3d.js';
import { CLIPS } from './clips.js';
import { flat, stepTerrain } from './testTerrain.js';
import { climbPathAt, CLIMB_T } from './climb.js';

const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const ramp = (t, t0, dur) => { const u = Math.min(1, Math.max(0, (t - t0) / dur)); return u * u * (3 - 2 * u); };
// posición x(t) con velocidad vmax entre [t0,t1] (aceleración/frenada suaves de 0.4 s)
function walkX(t, x0, v, t0, t1, ramp_ = 0.4) {
  // integral de v*smooth: aproximación cerrada por tramos
  const I = (tt) => { // integral de smoothstep(0..ramp_) desde 0 hasta tt
    if (tt <= 0) return 0; const r = ramp_; if (tt >= r) return r / 2 + (tt - r);
    const u = tt / r; return r * (u * u * u - u * u * u * u / 2);
  };
  const up = I(t - t0), down = I(t - t1);
  return x0 + v * (up - down);
}

// tramos [t0, dur, dx, dz] (m): perfil suave de velocidad (smoothstep de la posición) — como los ticks de la sim, sin teletransporte
const FOOTWORK = [[1.0, 0.11, 0.30, 0], [1.9, 0.11, -0.25, 0], [2.8, 1.20, 0, 0.42], [4.4, 0.18, 0.36, 0], [5.2, 0.11, -0.28, 0]];
export const FOOTWORK_SEGS = FOOTWORK;
function footworkRoot(t) {
  let x = 0, z = 0;
  for (const [t0, d, dx, dz] of FOOTWORK) { const u = ramp(t, t0, d); x += dx * u; z += dz * u; }
  return { pos: [x, 0, z], yaw: Math.atan2(-z, 1.6 - x) };     // mira siempre al rival (circle = orbitar)
}
export const HURT_FORCE = [{ t: 1.0, zone: 'head', dmg: 6.0 }, { t: 2.5, zone: 'head', dmg: 19.4 }, { t: 4.0, zone: 'body', dmg: 6.0 }, { t: 5.5, zone: 'body', dmg: 19.4 }];
function hurtForceActions() {
  const PER = { head: 0.00176, body: 0.00276 }, dmg = { head: 0, body: 0, legs: 0 }, out = [];
  for (const h of HURT_FORCE) {
    out.push({ t: h.t - 0.05, state: { hurt: null, damage: { ...dmg } } });
    dmg[h.zone] += h.dmg * PER[h.zone];
    out.push({ t: h.t, state: { hurt: { zone: h.zone, age: 0 }, damage: { ...dmg } } });
    out.push({ t: h.t + 0.02, state: { hurt: { zone: h.zone, age: 0.02 }, damage: { ...dmg } } });
  }
  return out;
}

export const SCENARIOS = {
  guard: { blockM: 0.5, terrain: flat(), duration: 4, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: [] },
  walk: { blockM: 0.5, terrain: flat(), duration: 6, root: (t) => ({ pos: [walkX(t, 0, 0.8, 1.0, 5.0), 0, 0], yaw: 0 }), actions: [] },
  jab: { blockM: 0.5, terrain: flat(), duration: 4, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: [{ t: 1.5, play: 'jab' }, { t: 3.0, play: 'jab' }] },
  cross: { blockM: 0.5, terrain: flat(), duration: 4, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: [{ t: 1.5, play: 'cross' }, { t: 3.0, play: 'cross' }] },
  hook: { blockM: 0.5, terrain: flat(), duration: 4, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: [{ t: 1.5, play: 'hook' }, { t: 3.0, play: 'hook' }] },
  lowkick: { blockM: 0.5, terrain: flat(), duration: 4.5, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: [{ t: 1.5, play: 'lowkick' }, { t: 3.2, play: 'lowkick' }] },
  block: { blockM: 0.5, terrain: flat(), duration: 3, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: [{ t: 1.0, play: 'block' }] },
  // plataforma de 1 bloque (0.5 m) en x >= 3.0 m
  hurt: { blockM: 0.5, terrain: flat(), duration: 6, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: [{ t: 1.0, play: 'hurt_head', opts: { force: true } }, { t: 2.5, play: 'hurt_body', opts: { force: true } }, { t: 4.0, play: 'hurt_legs', opts: { force: true } }] },
  rocked: { blockM: 0.5, terrain: flat(), duration: 5, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: [{ t: 1.0, play: 'rocked', opts: { force: true } }, { t: 4.0, cancel: 0.3 }] },
  ko: { blockM: 0.5, terrain: flat(), duration: 6, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: [{ t: 1.0, play: 'ko', opts: { force: true } }, { t: 3.0, play: 'getUp', opts: { force: true } }] },
  step: { blockM: 0.5, terrain: stepTerrain(6, 1), duration: 8.5, groundY: (x) => 0.5 * smooth((x - 2.9) / 0.6),
    root: (t) => ({ pos: [walkX(t, 0, 0.8, 1.0, 4.3) + walkX(t, 0, 0.8, 5.3, 6.8), 0, 0], yaw: 0 }), actions: [] },
  // plataforma de 1 bloque de 1 m (BLOCK_M=1): caso extremo
  step1m: { blockM: 1.0, terrain: stepTerrain(3, 1), duration: 8.5, groundY: (x) => 1.0 * smooth((x - 2.9) / 0.6),
    root: (t) => ({ pos: [walkX(t, 0, 0.7, 1.0, 4.3) + walkX(t, 0, 0.7, 5.3, 7.0), 0, 0], yaw: 0 }), actions: [] },
  // trepar un saliente de 2 bloques (1 m) a 0.55 m: el "sim" acerca la raíz, la mantiene quieta, la sube por climbPathAt y se queda arriba.
  climb1m: { blockM: 0.5, terrain: (x, y, z) => y < (x >= 3 ? 2 : 0), duration: 7.6,
    root: (t) => { const t0 = 3.6, p = climbPathAt({ dist: 0.65, height: 1.0 }, Math.max(0, t - t0)); return { pos: [0.85 * ramp(t, 0.3, 2.0) + p.fwd, p.up, 0], yaw: 0 }; },
    actions: [{ t: 3.6, play: 'climb' }] },
  // el sim salta de rumbo 90° de golpe (quieto) y luego otros -135° caminando
  turn90: { blockM: 0.5, terrain: flat(), duration: 6, root: (t) => ({ pos: [0, 0, 0], yaw: t < 1.5 ? 0 : Math.PI / 2 }), actions: [] },
  turnWalk: { blockM: 0.5, terrain: flat(), duration: 7,
    root: (t) => { const yaw = t < 2.5 ? 0 : t < 4.5 ? Math.PI / 2 : -Math.PI * 0.75; const x = walkX(t, 0, 0.8, 1.0, 6.0); return { pos: [x, 0, 0], yaw }; }, actions: [] },

  // ronda 4: juego de pies de pelea con las velocidades MEDIDAS en la sim viva (createLiveFight seed 7): stepIn ~2.7 m/s x 0.11 s, stepOut ~2.3 m/s x 0.11 s,
  // circle ~0.36 m/s lateral con el rumbo siguiendo al rival, avance (walk de pelea) ~2.0 m/s x 0.18 s. Rival fijo en x = 1.6.
  footwork: { blockM: 0.5, terrain: flat(), duration: 6.5, root: (t) => footworkRoot(t), actions: [{ t: 0, state: { loco: { mode: 'guard', speed: 0 } } }] },
  // ronda 4: finta de gancho suelta, y el caso real (la sim aborta el hook a los 0.07 s: state.clip 'feint' + move 'hook' => cambia a feint_hook sin salto)
  feint_hook: { blockM: 0.5, terrain: flat(), duration: 3, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: [{ t: 1.5, play: 'feint_hook' }] },
  feintSwitch: { blockM: 0.5, terrain: flat(), duration: 3, root: () => ({ pos: [0, 0, 0], yaw: 0 }),
    actions: [{ t: 1.5, play: 'hook' }, { t: 1.567, state: { clip: 'feint', move: 'hook', animSeq: 4 } }, { t: 1.6, play: 'hook' }, { t: 2.2, state: { clip: 'guard', move: null, animSeq: 5 } }] },
  // ronda 4: reacciones con fuerza: el estado trae el salto de state.damage[zona] como la sim viva (golpe débil = 6 pts, fuerte = 19.4 pts)
  hurtForce: { blockM: 0.5, terrain: flat(), duration: 7, root: () => ({ pos: [0, 0, 0], yaw: 0 }), actions: hurtForceActions() },
};
// Ejecuta el escenario a 60 Hz; onFrame(t, skeleton, animator, i) en cada frame. Devuelve el animador.
export function simulate(name, { seed = 7, hz = 60, duration, onFrame } = {}) {
  const sc = typeof name === 'string' ? SCENARIOS[name] : name;
  const A = createAnimator3D({ seed, getBlock: sc.terrain, blockM: sc.blockM });
  const dt = 1 / hz, n = Math.round((duration ?? sc.duration) * hz);
  const acts = sc.actions.slice();
  for (let i = 0; i <= n; i++) {
    const t = i * dt;
    while (acts.length && acts[0].t <= t + 1e-9) { const a = acts.shift(); if (a.cancel !== undefined) A.cancel(a.cancel); else if (a.state) A.setState(a.state); else A.play(a.play, a.opts || {}); }
    const r = sc.root(t);
    if (sc.groundY) r.pos[1] = sc.groundY(r.pos[0]);
    const sk = A.update(dt, r);
    if (onFrame) onFrame(t, sk, A, i);
  }
  return A;
}
export function snapshot(sk, A) {
  const pose = {}; for (const k in sk.pose) pose[k] = sk.pose[k].slice();
  const tips = {}; for (const k in sk.tips) tips[k] = sk.tips[k].slice();
  return { pose, tips, root: { pos: sk.root.pos.slice(), yaw: sk.root.yaw }, feet: A.feetWorld(), strike: { ...A.strike, fist: A.strike.fist.slice() } };
}

// ---- ronda 6: duelo de dos animadores (contacto). A en x=0 mirando +X, B en x=dist mirando -X (pelvis–pelvis de pie = dist).
// A lanza `name` en t0; en el tick de impacto de la sim B recibe state.hurt {zone, age, power} (como live.js de combat-gap).
// closeTo (opcional): la raíz de A entra (lo que haría la sim) hasta quedar a `closeTo` del rival en el impacto.
export const DUEL_DIST = Object.freeze({ jab: 0.97, cross: 0.95, hook: 0.85, lowkick: 1.00 });   // combat-gap 397b6e3 (REACH_3D_M / distance-3d)
export const DUEL_ZONE = Object.freeze({ jab: 'head', cross: 'head', hook: 'head', lowkick: 'legs' });
export function simulateDuel(name, { dist = DUEL_DIST[name] ?? 0.95, link = true, power = 0.6, hz = 60, t0 = 1.0, tail = 0.9, closeTo = null, seedA = 7, seedB = 11, onFrame } = {}) {
  const a = createAnimator3D({ seed: seedA }), b = createAnimator3D({ seed: seedB });
  if (link) pairAnimators(a, b);
  const clip = CLIPS[name], dt = 1 / hz, n = Math.round((t0 + clip.duration + tail) * hz), zone = DUEL_ZONE[name] || 'head';
  let hurtAge = -1;
  for (let i = 0; i <= n; i++) {
    const t = i * dt;
    if (Math.abs(t - t0) < dt / 2) a.play(name);
    if (hurtAge < 0 && t >= t0 + clip.impactT - 1e-9) hurtAge = 0;
    let ax = 0;
    if (closeTo != null) { const k = Math.min(1, Math.max(0, (t - t0) / clip.impactT)); const s = k * k * (3 - 2 * k); ax = (dist - closeTo) * s * (t - t0 < clip.duration ? 1 : 1); }
    const ska = a.update(dt, { pos: [ax, 0, 0], yaw: 0 });
    if (hurtAge >= 0) { b.setState({ hurt: { zone, age: hurtAge, power } }); hurtAge += dt; }
    const skb = b.update(dt, { pos: [dist, 0, 0], yaw: Math.PI });
    if (onFrame) onFrame(t, ska, skb, a, b, i);
  }
  return { a, b };
}
