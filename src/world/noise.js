// Ruido de gradiente (Perlin mejorado) 2D/3D determinista por seed + fbm.
// Tabla de permutación de 256 entradas barajada con createRng(seed) de src/shared/rng.js: rápido y sin RNG nativo.
// Periodo de la red: 256 celdas por eje (las octavas llevan offsets distintos para no alinearse).
import { createRng } from '../shared/rng.js';
import { normalizeSeed } from './seed.js';

const GX = new Float64Array([1, -1, 0, 0, 0.70710678, -0.70710678, 0.70710678, -0.70710678]);
const GZ = new Float64Array([0, 0, 1, -1, 0.70710678, 0.70710678, -0.70710678, -0.70710678]);
// 12 gradientes clásicos 3D
const G3 = new Int8Array([1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1]);

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function createNoise(seed) {
  const s = normalizeSeed(seed);
  const rnd = createRng((s ^ 0x5bd1e995) >>> 0);
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) { const j = rnd.int(0, i); const t = base[i]; base[i] = base[j]; base[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];

  /** Ruido 2D aprox. en [-1,1]. */
  function noise2(x, z) {
    const xf = Math.floor(x), zf = Math.floor(z);
    const xi = xf & 255, zi = zf & 255;
    const fx = x - xf, fz = z - zf;
    const u = fade(fx), v = fade(fz);
    const a = p[p[xi] + zi], b = p[p[xi + 1] + zi], c = p[p[xi] + zi + 1], d = p[p[xi + 1] + zi + 1];
    const ga = a & 7, gb = b & 7, gc = c & 7, gd = d & 7;
    const n00 = GX[ga] * fx + GZ[ga] * fz;
    const n10 = GX[gb] * (fx - 1) + GZ[gb] * fz;
    const n01 = GX[gc] * fx + GZ[gc] * (fz - 1);
    const n11 = GX[gd] * (fx - 1) + GZ[gd] * (fz - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.4142;
  }

  const g = (h, dx, dy, dz) => { const k = (p[h] % 12) * 3; return G3[k] * dx + G3[k + 1] * dy + G3[k + 2] * dz; };

  /** Ruido 3D aprox. en [-1,1]. */
  function noise3(x, y, z) {
    const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
    const xi = xf & 255, yi = yf & 255, zi = zf & 255;
    const fx = x - xf, fy = y - yf, fz = z - zf;
    const u = fade(fx), v = fade(fy), w = fade(fz);
    const a = p[xi] + yi, aa = p[a] + zi, ab = p[a + 1] + zi;
    const b = p[xi + 1] + yi, ba = p[b] + zi, bb = p[b + 1] + zi;
    const x0 = g(aa, fx, fy, fz) + u * (g(ba, fx - 1, fy, fz) - g(aa, fx, fy, fz));
    const x1 = g(ab, fx, fy - 1, fz) + u * (g(bb, fx - 1, fy - 1, fz) - g(ab, fx, fy - 1, fz));
    const x2 = g(aa + 1, fx, fy, fz - 1) + u * (g(ba + 1, fx - 1, fy, fz - 1) - g(aa + 1, fx, fy, fz - 1));
    const x3 = g(ab + 1, fx, fy - 1, fz - 1) + u * (g(bb + 1, fx - 1, fy - 1, fz - 1) - g(ab + 1, fx, fy - 1, fz - 1));
    const y0 = x0 + v * (x1 - x0);
    const y1 = x2 + v * (x3 - x2);
    return y0 + w * (y1 - y0);
  }

  /** fbm 2D normalizado a ~[-1,1]. */
  function fbm2(x, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise2(x * freq + i * 37.31, z * freq - i * 19.77);
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  /** fbm 3D normalizado a ~[-1,1]. */
  function fbm3(x, y, z, octaves = 3, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise3(x * freq + i * 37.31, y * freq + i * 11.13, z * freq - i * 19.77);
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged fbm 2D en [0,1] (crestas = 1). */
  function ridged2(x, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(noise2(x * freq + i * 37.31, z * freq - i * 19.77));
      sum += amp * n * n; norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  return { noise2, noise3, fbm2, fbm3, ridged2 };
}

export const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
