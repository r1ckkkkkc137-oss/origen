// PRNG determinista (sfc32) + utilidades. Nada de Math.random en la simulación.
// Mismo seed => misma secuencia en cualquier plataforma (solo aritmética entera 32-bit).

// Hash de string/número a 32 bits (xmur3) para derivar seeds.
export function hashSeed(input) {
  const str = String(input);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function createRng(seed = 1) {
  let a = hashSeed('a:' + seed), b = hashSeed('b:' + seed), c = hashSeed('c:' + seed), d = hashSeed('d:' + seed) | 1;
  function next() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  for (let i = 0; i < 12; i++) next(); // calentar
  const rng = {
    next,
    float: (lo = 0, hi = 1) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusivo
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // Ruido gaussiano aproximado (suma de 3 uniformes), media 0, sd ~1
    gauss: () => (next() + next() + next() - 1.5) * 2,
    // Elección ponderada: items [{w, ...}] o (items, weightFn)
    weighted(items, wf = (x) => x.w) {
      let total = 0;
      for (const it of items) total += Math.max(0, wf(it));
      if (total <= 0) return items[0];
      let r = next() * total;
      for (const it of items) { r -= Math.max(0, wf(it)); if (r <= 0) return it; }
      return items[items.length - 1];
    },
    // Softmax sobre utilidades con temperatura: variedad sin ruido puro.
    softmax(items, uf, temp = 1) {
      let max = -Infinity;
      for (const it of items) max = Math.max(max, uf(it));
      const ws = items.map((it) => Math.exp((uf(it) - max) / Math.max(0.01, temp)));
      let total = 0; for (const w of ws) total += w;
      let r = next() * total;
      for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
      return items[items.length - 1];
    },
    fork: (label) => createRng(hashSeed(seed + '/' + label)),
  };
  return rng;
}
