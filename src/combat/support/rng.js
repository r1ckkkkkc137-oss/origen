// RNG determinista por seed (mulberry32). Sin estado global: cada rng es un objeto.
// El estado interno es un uint32 serializable (rng.state) para guardar/reanudar.

/** Hash FNV-1a de string -> uint32 (para derivar seeds legibles). */
export function hashSeed(input) {
  const s = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Normaliza un seed (número o string) a uint32. */
export function toSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  return hashSeed(seed);
}

/** Un paso de mulberry32 sobre un estado uint32. Devuelve [float01, nextState]. */
export function mulberry32Step(state) {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/**
 * @param {number|string} seed
 * @returns {{state:number, next():number, range(a:number,b:number):number, int(a:number,b:number):number,
 *   chance(p:number):boolean, pick<T>(arr:T[]):T, fork(label?:string|number):any}}
 */
export function createRng(seed) {
  const rng = {
    state: toSeed(seed),
    /** float en [0,1) */
    next() {
      const [v, s] = mulberry32Step(rng.state);
      rng.state = s;
      return v;
    },
    /** float en [a,b) */
    range(a, b) { return a + (b - a) * rng.next(); },
    /** entero en [a,b] inclusive */
    int(a, b) { return a + Math.floor(rng.next() * (b - a + 1)); },
    chance(p) { return rng.next() < p; },
    pick(arr) { return arr[Math.floor(rng.next() * arr.length)]; },
    /** Sub-RNG independiente y determinista (no avanza mucho al padre: consume 1 valor). */
    fork(label = '') {
      const base = Math.floor(rng.next() * 4294967296) >>> 0;
      return createRng((base ^ hashSeed(label)) >>> 0);
    },
  };
  return rng;
}
