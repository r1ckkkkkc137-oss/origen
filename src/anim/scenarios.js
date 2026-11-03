// scenarios.js — escenarios deterministas (el "sim" que mueve la raíz) para pruebas, viewer y captura.
// La raíz pertenece al sim: aquí se genera en función de t; el animador solo la lee.
import { createAnimator3D } from './animator3d.js';
import { flat, stepTerrain } from './testTerrain.js';

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
  // el sim salta de rumbo 90° de golpe (quieto) y luego otros -135° caminando
  turn90: { blockM: 0.5, terrain: flat(), duration: 6, root: (t) => ({ pos: [0, 0, 0], yaw: t < 1.5 ? 0 : Math.PI / 2 }), actions: [] },
  turnWalk: { blockM: 0.5, terrain: flat(), duration: 7,
    root: (t) => { const yaw = t < 2.5 ? 0 : t < 4.5 ? Math.PI / 2 : -Math.PI * 0.75; const x = walkX(t, 0, 0.8, 1.0, 6.0); return { pos: [x, 0, 0], yaw }; }, actions: [] },
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
