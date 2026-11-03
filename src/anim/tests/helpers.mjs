import { simulate, SCENARIOS } from '../scenarios.js';
export const clone = (sk) => { const pose = {}; for (const k in sk.pose) pose[k] = sk.pose[k].slice(); return { pose, tips: Object.fromEntries(Object.entries(sk.tips).map(([k, v]) => [k, v.slice()])), root: { pos: sk.root.pos.slice(), yaw: sk.root.yaw }, visualYaw: sk.visualYaw }; };
export function run(name, opts = {}) {
  const frames = [], feet = [], strike = [];
  simulate(name, { ...opts, onFrame: (t, sk, A) => { frames.push(clone(sk)); feet.push(A.feetWorld()); strike.push(!!(A.strike.active || A.clip)); } });
  return { frames, feet, strike };
}
export const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const SC = SCENARIOS;
