import { TICK_HZ } from '../shared/contracts.js';
// Timestep fijo para la sim; render libre con alpha de interpolación.
// cpu: ms de CPU por frame (performance.now, solo medición; la sim no lo lee) de sim (suma de ticks del frame) y render.
// Comparables con la box saturada, a diferencia de los fps. cpu.stats() -> { frames, sim:{avg,p50,p95}, render:{...}, perTick }.
export function createLoop({ update, render, hz = TICK_HZ, maxSteps = 5, window = 600 }) {
  const dt = 1 / hz;
  let acc = 0, last = 0, tick = 0, running = false, raf = 0;
  const simMs = new Float64Array(window), renMs = new Float64Array(window), stepsN = new Uint8Array(window);
  let n = 0;
  const now = () => performance.now();
  function frame(tMs) {
    const t = tMs / 1000;
    acc += Math.min(0.25, last ? t - last : 0); last = t;
    let steps = 0;
    const t0 = now();
    while (acc >= dt && steps < maxSteps) { update(dt, tick++); acc -= dt; steps++; }
    if (steps === maxSteps) acc = 0;
    const t1 = now();
    render(acc / dt, t);
    const t2 = now();
    const i = n++ % window; simMs[i] = t1 - t0; renMs[i] = t2 - t1; stepsN[i] = steps;
    if (running) raf = requestAnimationFrame(frame);
  }
  const summ = (a, m) => { const s = Array.from(a.subarray(0, m)).sort((x, y) => x - y); const avg = s.reduce((p, q) => p + q, 0) / (m || 1);
    const q = (f) => +(s[Math.min(m - 1, Math.floor(f * m))] ?? 0).toFixed(3); return { avg: +avg.toFixed(3), p50: q(0.5), p95: q(0.95) }; };
  return {
    start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    get tick() { return tick; },
    cpu: {
      reset() { n = 0; },
      stats() {
        const m = Math.min(n, window); let st = 0, ss = 0; for (let k = 0; k < m; k++) { st += stepsN[k]; ss += simMs[k]; }
        return { frames: m, sim: summ(simMs, m), render: summ(renMs, m), perTick: +(st ? ss / st : 0).toFixed(3) };
      },
    },
  };
}
