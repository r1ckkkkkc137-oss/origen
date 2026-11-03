// Generación determinista de chunks. generateChunk(seed, cx, cz) es una FUNCIÓN PURA de (seed, cx, cz):
// no depende de qué chunks se generaron antes. Todo se deriva de funciones puras por columna (x,z) o por voxel (x,y,z).
//
// Capas, en orden: terreno (altura por fbm + clima) -> minerales/grava -> cuevas -> árboles.
// Árboles: grilla de celdas de 7x7; cada celda tiene como mucho 1 árbol, con tronco en (celda*7 + jitter 0..2): dos troncos
// de celdas vecinas distan >= 5 en algún eje y la copa llega a +-2, así que NUNCA se superponen. Si el árbol existe depende solo de
// hash(celda) y de las columnas de su tronco (altura/bioma/pendiente, funciones puras), por eso cualquier chunk que toque la copa
// dibuja exactamente los mismos bloques, sin importar el orden de generación.
import { B } from './blocks.js';
import { Chunk, CHUNK_Y, SEA_LEVEL } from './chunk.js';
import { createNoise, smoothstep } from './noise.js';
import { hash3 } from '../shared/rng.js';
import { normalizeSeed } from './seed.js';

export const BIOME = Object.freeze({ PLAINS: 0, FOREST: 1, DESERT: 2, SNOWY_MOUNTAIN: 3 });
export const BIOME_NAMES = ['plains', 'forest', 'desert', 'snowy_mountain'];

export const TREE_CELL = 7;        // tamaño de celda de la grilla de árboles
export const TREE_JITTER = 3;      // el tronco se desplaza 0..2 dentro de la celda -> separación mínima 7-2 = 5
export const TREE_CROWN_RADIUS = 2;
const GRID_PAD = 4;                // padding de columnas alrededor del chunk (copa r=2 + vecino de pendiente 1 + margen)
const HEIGHT_MAX = CHUNK_Y - 2;
const TREE_SALT = 0x7ee5;
const MIN_CAVE_DEPTH = 4;

// ---------- sampler (ruido por seed) ----------
const samplers = new Map();
function getSampler(seed) {
  const s = normalizeSeed(seed);
  let S = samplers.get(s);
  if (S) return S;
  S = {
    seed: s,
    cont: createNoise(s ^ 0x1001), detail: createNoise(s ^ 0x1002), ridge: createNoise(s ^ 0x1003),
    temp: createNoise(s ^ 0x1004), humid: createNoise(s ^ 0x1005),
    ore: createNoise(s ^ 0x2001), gravel: createNoise(s ^ 0x2002),
    caveA: createNoise(s ^ 0x3001), caveB: createNoise(s ^ 0x3002), cavern: createNoise(s ^ 0x3003), mouth: createNoise(s ^ 0x3004),
  };
  if (samplers.size >= 4) samplers.delete(samplers.keys().next().value);
  samplers.set(s, S);
  return S;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Temperatura y humedad en [0,1] (escala ~ 400 bloques). */
function climate(S, x, z, out) {
  out.t = clamp01(0.5 + S.temp.fbm2(x / 420, z / 420, 3) * 1.7);
  out.hum = clamp01(0.5 + S.humid.fbm2(x / 380 + 50, z / 380 - 50, 3) * 1.7);
}

export function biomeFromClimate(t, hum) {
  if (t < 0.25) return BIOME.SNOWY_MOUNTAIN;
  if (t > 0.66 && hum < 0.45) return BIOME.DESERT;
  return hum > 0.5 ? BIOME.FOREST : BIOME.PLAINS;
}

/** Altura de terreno (y del bloque superior), pura en (x,z) dado el clima. */
function terrainHeight(S, x, z, t, hum) {
  const cont = S.cont.fbm2(x / 210, z / 210, 4);
  const det = S.detail.fbm2(x / 47, z / 47, 3);
  const wm = smoothstep(0.31, 0.19, t);
  const wd = smoothstep(0.60, 0.72, t) * smoothstep(0.53, 0.37, hum);
  let h = SEA_LEVEL + 3 + cont * 16 * lerp(1, 0.45, wd) + det * lerp(3, 1.5, wd);
  if (wm > 0) {
    const r = S.ridge.ridged2(x / 95, z / 95, 4);
    h += wm * (5 + r * 28);
  }
  h = Math.floor(h);
  return h < 2 ? 2 : h > HEIGHT_MAX ? HEIGHT_MAX : h;
}

/** Rejilla de datos por columna sobre un rectángulo. */
function buildGrid(S, minX, minZ, w, d) {
  const n = w * d;
  const g = { minX, minZ, w, d, h: new Int16Array(n), biome: new Uint8Array(n), t: new Float32Array(n), hum: new Float32Array(n) };
  const c = { t: 0, hum: 0 };
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const x = minX + i, z = minZ + j, k = i + j * w;
    climate(S, x, z, c);
    g.t[k] = c.t; g.hum[k] = c.hum; g.biome[k] = biomeFromClimate(c.t, c.hum);
    g.h[k] = terrainHeight(S, x, z, c.t, c.hum);
  }
  return g;
}

/** Máxima diferencia de altura con los 4 vecinos. Requiere que (i,j) no esté en el borde de la rejilla. */
function steepAt(g, i, j) {
  const k = i + j * g.w, h = g.h[k];
  return Math.max(Math.abs(h - g.h[k - 1]), Math.abs(h - g.h[k + 1]), Math.abs(h - g.h[k - g.w]), Math.abs(h - g.h[k + g.w]));
}

function isMouth(S, x, z, h) { return h >= SEA_LEVEL + 6 && S.mouth.noise2(x / 62, z / 62) > 0.55; }

/** Superficie de una columna: { top, filler, depth } (depth = bloques de filler bajo el top). */
function surfaceOf(biome, h, steep) {
  if (h <= SEA_LEVEL + 1) {
    if (biome === BIOME.SNOWY_MOUNTAIN) return { top: B.GRAVEL, filler: B.GRAVEL, depth: 2 };
    if (h < SEA_LEVEL - 5) return { top: B.GRAVEL, filler: B.GRAVEL, depth: 2 };
    return { top: B.SAND, filler: B.SAND, depth: 3 };
  }
  if (biome === BIOME.DESERT) return { top: B.SAND, filler: B.SAND, depth: 4 };
  if (biome === BIOME.SNOWY_MOUNTAIN) {
    if (steep >= 2) return { top: B.STONE, filler: B.STONE, depth: 0 };
    return { top: B.SNOW, filler: B.DIRT, depth: 2 };
  }
  if (steep >= 3) return { top: B.STONE, filler: B.STONE, depth: 0 };
  return { top: B.GRASS, filler: B.DIRT, depth: 3 };
}

// ---------- árboles ----------
/** ¿La columna (i,j) de la rejilla admite un árbol? Solo sobre pasto, fuera del agua y sin pendiente fuerte ni boca de cueva. */
function treeColumnOk(S, g, i, j) {
  const k = i + j * g.w, h = g.h[k], biome = g.biome[k];
  if (biome !== BIOME.FOREST && biome !== BIOME.PLAINS) return false;
  if (h < SEA_LEVEL + 2) return false;                       // agua/arena de orilla
  const steep = steepAt(g, i, j);
  if (steep > 2) return false;
  if (surfaceOf(biome, h, steep).top !== B.GRASS) return false;
  if (isMouth(S, g.minX + i, g.minZ + j, h)) return false;
  return true;
}

/** Árboles cuyo TRONCO cae en [x0,x1]x[z0,z1] (inclusive). La rejilla g debe cubrir ese rectángulo +1 de margen. */
function treesInRect(S, g, x0, z0, x1, z1) {
  const out = [];
  const cx0 = Math.floor(x0 / TREE_CELL) - 1, cx1 = Math.floor(x1 / TREE_CELL);
  const cz0 = Math.floor(z0 / TREE_CELL) - 1, cz1 = Math.floor(z1 / TREE_CELL);
  for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
    const ts = S.seed ^ TREE_SALT; // hash3 del contrato: float [0,1) sin estado; el 2º eje (y) distingue cada decisión de la celda
    const x = cx * TREE_CELL + Math.floor(hash3(ts, cx, 1, cz) * TREE_JITTER);
    const z = cz * TREE_CELL + Math.floor(hash3(ts, cx, 2, cz) * TREE_JITTER);
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    const i = x - g.minX, j = z - g.minZ;
    const biome = g.biome[i + j * g.w];
    const dens = biome === BIOME.FOREST ? 0.8 : biome === BIOME.PLAINS ? 0.06 : 0;
    if (dens === 0 || hash3(ts, cx, 3, cz) >= dens) continue;
    if (!treeColumnOk(S, g, i, j)) continue;
    const ground = g.h[i + j * g.w];
    const trunk = 4 + Math.floor(hash3(ts, cx, 4, cz) * 3);   // 4..6
    if (ground + trunk + 1 >= CHUNK_Y) continue;
    out.push({ x, z, ground, trunk });
  }
  return out;
}

/** Bloques de un árbol: lista de [x,y,z,id]. Puro. Copa dentro de |dx|,|dz| <= 2. */
export function treeBlocks(seed, tree) {
  const s = normalizeSeed(seed);
  const { x, z, ground, trunk } = tree;
  const res = [];
  for (let y = 1; y <= trunk; y++) res.push([x, ground + y, z, B.LOG]);
  const layers = [[trunk - 2, 2], [trunk - 1, 2], [trunk, 1], [trunk + 1, 1]];
  for (const [ly, r] of layers) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dz === 0 && ly <= trunk) continue;     // tronco
      const corner = Math.abs(dx) === r && Math.abs(dz) === r;
      if (corner && (r === 1 ? ly === trunk + 1 : hash3(s ^ TREE_SALT, x + dx, ground + ly, z + dz) < 0.5)) continue;
      res.push([x + dx, ground + ly, z + dz, B.LEAVES]);
    }
  }
  return res;
}

/**
 * Árboles cuyo tronco cae en el rectángulo [x0,x1]x[z0,z1]. Útil para tests y para IA/fauna.
 * Devuelve [{x,z,ground,trunk}] ordenados por (z,x).
 */
export function listTrees(seed, x0, z0, x1, z1) {
  const S = getSampler(seed);
  const g = buildGrid(S, x0 - 1, z0 - 1, x1 - x0 + 3, z1 - z0 + 3);
  return treesInRect(S, g, x0, z0, x1, z1).sort((a, b) => a.z - b.z || a.x - b.x);
}

// ---------- chunk ----------
export function generateChunk(seed, cx, cz) {
  const S = getSampler(seed);
  const chunk = new Chunk(cx, cz);
  const blocks = chunk.blocks;
  const x0 = cx * 16, z0 = cz * 16;
  const W = 16 + GRID_PAD * 2;
  const g = buildGrid(S, x0 - GRID_PAD, z0 - GRID_PAD, W, W);
  const ore = S.ore, grv = S.gravel;

  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const wx = x0 + lx, wz = z0 + lz;
    const gi = lx + GRID_PAD, gj = lz + GRID_PAD, k = gi + gj * W;
    const h = g.h[k], biome = g.biome[k];
    const surf = surfaceOf(biome, h, steepAt(g, gi, gj));
    const col = lx + (lz << 4);

    // 1) terreno
    for (let y = 0; y <= h; y++) {
      let id;
      if (y === h) id = surf.top;
      else if (y > h - 1 - surf.depth) id = surf.filler;
      else id = B.STONE;
      blocks[col + (y << 8)] = id;
    }
    // agua
    for (let y = h + 1; y <= SEA_LEVEL; y++) blocks[col + (y << 8)] = B.WATER;

    // 2) minerales y grava (solo reemplazan piedra, bajo la capa superficial)
    const stoneTop = h - 1 - surf.depth;
    for (let y = 1; y <= stoneTop; y++) {
      const idx = col + (y << 8);
      if (blocks[idx] !== B.STONE) continue;
      const v = ore.noise3(wx * 0.14, y * 0.14, wz * 0.14);
      if (v > 0.60) { blocks[idx] = B.COAL; continue; }
      if (v < -0.64 && y <= 28) { blocks[idx] = B.IRON; continue; }
      if (y >= 3 && y <= h - 4 && grv.noise3(wx * 0.07, y * 0.09, wz * 0.07) > 0.62) blocks[idx] = B.GRAVEL;
    }

    // 3) cuevas: túneles "spaghetti" (dos ruidos 3D cerca de 0) + cavernas profundas.
    // Techo: solo a >= 4 bloques bajo la superficie, salvo en "bocas" (rara, solo tierra alta y seca) -> el agua nunca queda sobre aire.
    const mouth = isMouth(S, wx, wz, h);
    const minDepth = mouth ? -1 : MIN_CAVE_DEPTH;
    const yMax = Math.min(h - (mouth ? 0 : MIN_CAVE_DEPTH), CHUNK_Y - 1);
    for (let y = 2; y <= yMax; y++) {
      const depth = h - y;
      const idx = col + (y << 8);
      const cur = blocks[idx];
      if (cur === B.AIR || cur === B.WATER) continue;
      const thr = 0.085 * smoothstep(minDepth, minDepth + 5, depth);
      let carve = false;
      if (thr > 0) {
        const a = S.caveA.noise3(wx * 0.022, y * 0.034, wz * 0.022);
        if (a > -thr && a < thr) {
          const b = S.caveB.noise3(wx * 0.022 + 100, y * 0.034 + 57, wz * 0.022 + 31);
          if (b > -thr && b < thr) carve = true;
        }
      }
      if (!carve && y < 22 && depth >= 8 && S.cavern.noise3(wx * 0.011, y * 0.021, wz * 0.011) > 0.52) carve = true;
      if (carve) blocks[idx] = B.AIR;
    }
  }

  // 4) árboles: troncos en [x0-2, x0+17] (copa r=2); solo se escribe dentro del chunk y solo sobre aire.
  const trees = treesInRect(S, g, x0 - TREE_CROWN_RADIUS, z0 - TREE_CROWN_RADIUS, x0 + 15 + TREE_CROWN_RADIUS, z0 + 15 + TREE_CROWN_RADIUS);
  for (const tree of trees) {
    for (const [bx, by, bz, id] of treeBlocks(S.seed, tree)) {
      const lx = bx - x0, lz = bz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || by < 0 || by >= CHUNK_Y) continue;
      const idx = lx + (lz << 4) + (by << 8);
      if (blocks[idx] === B.AIR) blocks[idx] = id;
    }
  }
  chunk.version = 0;
  return chunk;
}

/** Altura de terreno y bioma de una columna (útil para spawn / debug). Ignora cuevas y árboles. */
export function columnInfo(seed, x, z) {
  const S = getSampler(seed);
  const c = { t: 0, hum: 0 };
  climate(S, x, z, c);
  return { height: terrainHeight(S, x, z, c.t, c.hum), biome: biomeFromClimate(c.t, c.hum), temperature: c.t, humidity: c.hum };
}
