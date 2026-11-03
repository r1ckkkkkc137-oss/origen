import { TICK_HZ } from '../shared/contracts.js';
// Timestep fijo para la sim; render libre con alpha de interpolación.
export function createLoop({ update, render, hz = TICK_HZ, maxSteps = 5 }) {
  const dt = 1 / hz;
  let acc = 0, last = 0, tick = 0, running = false, raf = 0;
  function frame(tMs) {
    const t = tMs / 1000;
    acc += Math.min(0.25, last ? t - last : 0); last = t;
    let steps = 0;
    while (acc >= dt && steps < maxSteps) { update(dt, tick++); acc -= dt; steps++; }
    if (steps === maxSteps) acc = 0;
    render(acc / dt, t);
    if (running) raf = requestAnimationFrame(frame);
  }
  return {
    start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    get tick() { return tick; },
  };
}
