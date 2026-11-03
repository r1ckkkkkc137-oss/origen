// Radio de carga adaptativo por tiempo de frame (solo presentación: no toca la sim).
export function createAdaptiveRadius({ max, min = 2.5, step = 0.5, slowMs = 33, fastMs = 22, onChange, now = () => performance.now() }) {
  let radius = max, last = 0, ema = 16.7, slowFor = 0, fastFor = 0;
  return {
    get radius() { return radius; }, get frameMs() { return ema; },
    frame() {
      const t = now(); if (!last) { last = t; return; }
      const dt = Math.min(t - last, 250); last = t; ema += (dt - ema) * 0.1;
      if (ema > slowMs) { slowFor += dt; fastFor = 0; } else if (ema < fastMs) { fastFor += dt; slowFor = 0; } else { slowFor = fastFor = 0; }
      if (slowFor > 2000 && radius > min) { radius = Math.max(min, radius - step); slowFor = 0; onChange(radius); }
      else if (fastFor > 4000 && radius < max) { radius = Math.min(max, radius + step); fastFor = 0; onChange(radius); }
    },
  };
}
