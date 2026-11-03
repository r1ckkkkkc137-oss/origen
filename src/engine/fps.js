export function createFpsMeter(el) {
  let frames = 0, t0 = performance.now(), fps = 0;
  return {
    frame() {
      frames++;
      const t = performance.now();
      if (t - t0 >= 500) { fps = (frames * 1000) / (t - t0); frames = 0; t0 = t; if (el) el.textContent = `fps ${fps.toFixed(0)}`; }
    },
    get fps() { return fps; },
  };
}
