// Atlas de texturas procedural (canvas 2D -> THREE.CanvasTexture). Determinista por seed.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const TILE = 16;
export const TILES = ['grass_top', 'grass_side', 'dirt', 'stone', 'log_side', 'log_top', 'planks', 'leaves',
  'sand', 'snow', 'gravel', 'coal_ore', 'iron_ore', 'water']; // orden fijo: solo se agrega al final
const COLS = 4;

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[(r() * a.length) | 0];
function px(g, x, y, c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); }
function shade(hex, k) { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }

const PAINT = {
  grass_top(g, r) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(g, x, y, shade(pick(r, PALETTE.grass), 0.93 + r() * 0.1)); for (let i = 0; i < 10; i++) px(g, (r() * TILE) | 0, (r() * TILE) | 0, shade(PALETTE.grass[3], 1.12)); },
  dirt(g, r) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(g, x, y, shade(pick(r, PALETTE.dirt), 0.8 + r() * 0.3)); for (let i = 0; i < 5; i++) px(g, (r() * TILE) | 0, (r() * TILE) | 0, shade(PALETTE.stone[0], 0.9)); },
  grass_side(g, r) { PAINT.dirt(g, r); for (let x = 0; x < TILE; x++) { const h = 3 + ((r() * 3) | 0); for (let y = 0; y < h; y++) px(g, x, y, shade(pick(r, PALETTE.grass), 0.9 + r() * 0.1)); } },
  stone(g, r) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(g, x, y, shade(pick(r, PALETTE.stone), 0.85 + r() * 0.2)); for (let i = 0; i < 3; i++) { let x = (r() * TILE) | 0, y = (r() * TILE) | 0; for (let k = 0; k < 6; k++) { px(g, x & 15, y & 15, shade(PALETTE.stone[2], 0.6)); x += r() < 0.5 ? 1 : 0; y += 1; } } },
  log_side(g, r) { for (let x = 0; x < TILE; x++) { const c = pick(r, PALETTE.bark); for (let y = 0; y < TILE; y++) px(g, x, y, shade(c, (x % 4 === 0 ? 0.65 : 0.9) + r() * 0.15)); } },
  log_top(g, r) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const d = Math.hypot(x - 7.5, y - 7.5); const c = d > 6.8 ? PALETTE.bark[0] : PALETTE.wood[(d | 0) % 2 ? 1 : 0]; px(g, x, y, shade(c, 0.85 + r() * 0.15)); } },
  planks(g, r) { for (let y = 0; y < TILE; y++) { const c = PALETTE.wood[(y >> 2) % 4]; for (let x = 0; x < TILE; x++) px(g, x, y, shade(c, (y % 4 === 3 ? 0.55 : 0.85) + r() * 0.15)); } },
  leaves(g, r) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { if (r() < 0.12) { g.clearRect(x, y, 1, 1); continue; } px(g, x, y, shade(pick(r, PALETTE.leaves), 0.7 + r() * 0.35)); } },
  sand(g, r) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(g, x, y, shade(pick(r, PALETTE.sand), 0.88 + r() * 0.18)); },
  snow(g, r) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(g, x, y, shade(pick(r, PALETTE.snow), 0.92 + r() * 0.1)); },
  gravel(g, r) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(g, x, y, shade(PALETTE.gravel[2], 0.95)); for (let i = 0; i < 22; i++) { const x = (r() * 15) | 0, y = (r() * 15) | 0, c = pick(r, PALETTE.gravel); px(g, x, y, shade(c, 1.05)); px(g, x + 1, y, shade(c, 0.9)); px(g, x, y + 1, shade(c, 0.75)); } },
  coal_ore(g, r) { PAINT.stone(g, r); ore(g, r, PALETTE.coal, 5); },
  iron_ore(g, r) { PAINT.stone(g, r); ore(g, r, PALETTE.iron, 4); },
  water(g, r) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const w = Math.sin((x + y * 0.5) * 0.9 + r() * 0.6) > 0.7; px(g, x, y, shade(pick(r, PALETTE.water), w ? 1.25 : 0.9 + r() * 0.1)); } },
};
// Vetas de mineral: grumos de 2-4 px con borde oscuro, legibles a distancia.
function ore(g, r, cols, n) { for (let i = 0; i < n; i++) { const x0 = 1 + ((r() * 11) | 0), y0 = 1 + ((r() * 11) | 0); for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) { if ((dx + dy === 4 || dx + dy === 0) && r() < 0.6) continue; px(g, x0 + dx, y0 + dy, shade(pick(r, cols), 0.85 + r() * 0.25)); } px(g, x0 + 1, y0, shade(cols[cols.length - 1], 1.6)); } }

// Promedio 2x2 dentro de cada tile, nivel por nivel, hasta 1 px por tile.
function buildTileMips(cv, doc, rows) {
  const levels = [cv]; let src = cv, t = TILE;
  while (t > 1) {
    const w = src.width >> 1, h = src.height >> 1, d = doc.createElement('canvas'); d.width = w; d.height = h;
    const a = src.getContext('2d').getImageData(0, 0, src.width, src.height).data, o = d.getContext('2d').createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) {
      const i = (sy, sx) => a[((y * 2 + sy) * src.width + x * 2 + sx) * 4 + k];
      o.data[(y * w + x) * 4 + k] = (i(0, 0) + i(0, 1) + i(1, 0) + i(1, 1) + 2) >> 2;
    }
    d.getContext('2d').putImageData(o, 0, 0); levels.push(d); src = d; t >>= 1;
  }
  return levels;
}

/** Crea el atlas. Devuelve { texture, canvas, uv(name) -> [u0,v0,u1,v1] }. */
export function createAtlas(seed = 1, doc = globalThis.document, { mipmaps = true } = {}) {
  const rows = Math.ceil(TILES.length / COLS);
  const cv = doc.createElement('canvas'); cv.width = COLS * TILE; cv.height = rows * TILE;
  const g = cv.getContext('2d');
  TILES.forEach((name, i) => {
    g.save(); g.translate((i % COLS) * TILE, ((i / COLS) | 0) * TILE);
    g.beginPath(); g.rect(0, 0, TILE, TILE); g.clip();
    PAINT[name](g, rng(seed * 977 + i * 131));
    g.restore();
  });
  const texture = new THREE.CanvasTexture(cv);
  texture.magFilter = THREE.NearestFilter; texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false;
  if (mipmaps) { // mips por tile (sin mezclar vecinos): pixelado de cerca, sin moiré de lejos
    texture.mipmaps = buildTileMips(cv, doc, rows); texture.minFilter = THREE.NearestMipmapLinearFilter;
  } else texture.minFilter = THREE.NearestFilter;
  const uv = (name) => { const i = TILES.indexOf(name); const c = i % COLS, rr = (i / COLS) | 0; const e = 0.01 / cv.width;
    return [c / COLS + e, 1 - (rr + 1) / rows + e, (c + 1) / COLS - e, 1 - rr / rows - e]; };
  return { texture, canvas: cv, uv };
}
