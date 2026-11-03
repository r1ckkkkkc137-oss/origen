// Generación determinista de chunks. generateChunk(seed, cx, cz) es una FUNCIÓN PURA de (seed, cx, cz):
// no depende de qué chunks se generaron antes. Todo se deriva de funciones puras por columna (x,z) o por voxel (x,y,z).
//
// Capas, en orden: terreno (altura por fbm + clima) -> minerales/grava -> cuevas -> árboles.
// Árboles: ver la sección «árboles» (candidato por celda + resolución de conflictos local y pura).
import { B } from './blocks.js';
import { Chunk, CHUNK_Y, SEA_LEVEL } from './chunk.js';
import { createNoise, smoothstep } from './noise.js';
import { hash3 } from '../shared/rng.js';
import { normalizeSeed } from './seed.js';

export const BIOME = Object.freeze({ PLAINS: 0, FOREST: 1, DESERT: 2, SNOWY_MOUNTAIN: 3 });
export const BIOME_NAMES = ['plains', 'forest', 'desert', 'snowy_mountain'];

const GRID_PAD = 2;                // padding de columnas alrededor del chunk (solo el vecino de pendiente 1 + margen; los árboles tienen su propia consulta)
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
// Especies (forma, no textura: el atlas solo tiene un tile de tronco/hoja): roble ancho, pino/conífera alta y estrecha, abedul delgado.
// Cada celda de TREE_CELL x TREE_CELL tiene como mucho UN candidato (posición, especie y altura salen de hash3 de la seed + celda;
// clima/altura de las columnas son funciones puras). Un candidato se ACEPTA si ningún candidato válido vecino con mayor prioridad
// queda a menos de rA + rB + 2 bloques (Chebyshev): ni copas ni troncos se superponen. Como "válido" y "prioridad" son puros, la
// decisión no depende del chunk ni del orden de generación: todo chunk que toque un árbol dibuja exactamente los mismos bloques.
export const SPECIES = Object.freeze({ OAK: 0, PINE: 1, BIRCH: 2 });
export const SPECIES_NAMES = ['oak', 'pine', 'birch'];
export const TREE_CELL = 8;
export const TREE_REACH = Object.freeze([4, 3, 3]);   // radio horizontal máximo (copa+ramas) por especie
export const TREE_MAX_REACH = 4;
export const TREE_HEIGHT = Object.freeze([[10, 15], [13, 18], [10, 14]]);   // [min,max] bloques sobre el suelo, por especie (0,5 m/bloque: 5–9 m)
const TREE_MARGIN = TREE_MAX_REACH + 1;              // + 1 por la base 2x2 (puede correrse un bloque)
const TREE_SEP_PAD = 2;
const NB = 2;                                        // celdas vecinas a revisar: (4+4+2) / 8 -> 2

/** Altura y clima de una columna (sin caché de rejilla). */
const _c = { t: 0, hum: 0 };
function colInfo(S, x, z) { climate(S, x, z, _c); return terrainHeight(S, x, z, _c.t, _c.hum); }

function chooseSpecies(biome, t, r) {
  if (biome === BIOME.SNOWY_MOUNTAIN) return SPECIES.PINE;
  if (biome === BIOME.PLAINS) return r < 0.6 ? SPECIES.OAK : SPECIES.BIRCH;
  if (t < 0.42) return r < 0.6 ? SPECIES.PINE : r < 0.85 ? SPECIES.OAK : SPECIES.BIRCH;      // bosque frío: coníferas
  return r < 0.5 ? SPECIES.OAK : r < 0.8 ? SPECIES.BIRCH : SPECIES.PINE;
}

/** Candidato de la celda (cx,cz) o null. Puro y cacheado por seed (el objeto devuelto es inmutable salvo memos internos). */
function treeCell(S, cx, cz) {
  const key = cx * 2097152 + cz;
  let cache = S.treeCells;
  if (!cache) cache = S.treeCells = new Map();
  if (cache.has(key)) return cache.get(key);
  if (cache.size > 60000) cache.clear();
  const res = computeTreeCell(S, cx, cz);
  cache.set(key, res);
  return res;
}

function computeTreeCell(S, cx, cz) {
  const ts = S.seed ^ TREE_SALT;
  const x = cx * TREE_CELL + Math.floor(hash3(ts, cx, 1, cz) * TREE_CELL);
  const z = cz * TREE_CELL + Math.floor(hash3(ts, cx, 2, cz) * TREE_CELL);
  climate(S, x, z, _c);
  const t = _c.t, biome = biomeFromClimate(_c.t, _c.hum);
  const dens = biome === BIOME.FOREST ? 0.9 : biome === BIOME.PLAINS ? 0.14 : biome === BIOME.SNOWY_MOUNTAIN ? 0.3 : 0;
  if (dens === 0 || hash3(ts, cx, 3, cz) >= dens) return null;
  const ground = terrainHeight(S, x, z, _c.t, _c.hum);
  if (ground < SEA_LEVEL + 2) return null;                                   // agua / arena de orilla
  const hW = colInfo(S, x - 1, z), hE = colInfo(S, x + 1, z), hN = colInfo(S, x, z - 1), hS = colInfo(S, x, z + 1);
  const steep = Math.max(Math.abs(ground - hW), Math.abs(ground - hE), Math.abs(ground - hN), Math.abs(ground - hS));
  if (steep > 2) return null;
  const top = surfaceOf(biome, ground, steep).top;
  if (top !== B.GRASS && !(biome === BIOME.SNOWY_MOUNTAIN && top === B.SNOW)) return null;
  if (isMouth(S, x, z, ground)) return null;
  const species = chooseSpecies(biome, t, hash3(ts, cx, 7, cz));
  const [hMin, hMax] = TREE_HEIGHT[species];
  const height = hMin + Math.floor(hash3(ts, cx, 6, cz) * (hMax - hMin + 1));
  if (ground + height > CHUNK_Y - 1) return null;                            // cabe en 64 bloques
  const thick = species !== SPECIES.BIRCH && height >= 13;
  const baseH = height >= 16 ? 3 : 2;                                         // alto de la base gruesa
  let cols = [[0, 0, ground]];
  if (thick) {
    const sx = hash3(ts, cx, 8, cz) < 0.5 ? -1 : 0, sz = hash3(ts, cx, 9, cz) < 0.5 ? -1 : 0;   // dónde queda el 2x2 respecto al eje
    cols = [[0, 0, ground]];
    for (const [ox, oz] of [[sx, sz], [sx + 1, sz], [sx, sz + 1], [sx + 1, sz + 1]]) {
      if (ox === 0 && oz === 0) continue;
      const h2 = colInfo(S, x + ox, z + oz);
      if (h2 < SEA_LEVEL + 2 || Math.abs(h2 - ground) > 2) return null;
      cols.push([ox, oz, h2]);
    }
  }
  return { cx, cz, x, z, ground, species, height, r: TREE_REACH[species], thick, baseH, cols, prio: hash3(ts, cx, 5, cz), biome, trunk: 0, _blocks: null, _ok: undefined };
}

/** ¿El candidato sobrevive a los vecinos de mayor prioridad (a distancia de conflicto)? */
function treeAccepted(S, c) {
  if (c._ok !== undefined) return c._ok;
  let ok = true;
  for (let dz = -NB; dz <= NB && ok; dz++) for (let dx = -NB; dx <= NB; dx++) {
    if (dx === 0 && dz === 0) continue;
    const o = treeCell(S, c.cx + dx, c.cz + dz);
    if (!o) continue;
    if (Math.max(Math.abs(o.x - c.x), Math.abs(o.z - c.z)) >= o.r + c.r + TREE_SEP_PAD) continue;
    if (o.prio > c.prio || (o.prio === c.prio && (o.cz < c.cz || (o.cz === c.cz && o.cx < c.cx)))) { ok = false; break; }
  }
  c._ok = ok;
  return ok;
}

/** Árboles aceptados cuyo TRONCO cae en [x0,x1]x[z0,z1] (inclusive). */
function treesInRect(S, x0, z0, x1, z1) {
  const out = [];
  for (let cz = Math.floor(z0 / TREE_CELL); cz <= Math.floor(z1 / TREE_CELL); cz++) for (let cx = Math.floor(x0 / TREE_CELL); cx <= Math.floor(x1 / TREE_CELL); cx++) {
    const c = treeCell(S, cx, cz);
    if (!c || c.x < x0 || c.x > x1 || c.z < z0 || c.z > z1) continue;
    if (treeAccepted(S, c)) out.push(c);
  }
  return out;
}

const dirs8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const clampP = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Bloques de un árbol: lista de [x,y,z,id] (y absoluta). Puro; memoizado en el candidato. Sin hojas huérfanas (se podan por conectividad). */
export function treeBlocks(seed, tree) {
  if (tree._blocks) return tree._blocks;
  const s = normalizeSeed(seed) ^ TREE_SALT;
  const { x, z, ground, species, height: H } = tree;
  const W = 17, OFF = 8, YOFF = 4;                                       // caja local: dx,dz en [-8,8]; dy en [-4, ...]
  const kOf = (dx, dy, dz) => (dx + OFF) + W * ((dz + OFF) + W * (dy + YOFF));
  const logs = new Map(), leaves = new Map();                            // key -> [dx,dy,dz]
  const putLog = (dx, dy, dz) => { logs.set(kOf(dx, dy, dz), [dx, dy, dz]); leaves.delete(kOf(dx, dy, dz)); };
  const putLeaf = (dx, dy, dz) => { const k = kOf(dx, dy, dz); if (!logs.has(k)) leaves.set(k, [dx, dy, dz]); };
  const rnd = (a, b, c) => hash3(s, x * 31 + a, ground + b, z * 17 + c);   // ruido por bloque de este árbol
  const rndT = (n) => hash3(s, x, n, z);                                    // decisiones por árbol
  /** Elipsoide de hojas con borde ruidoso. */
  const blob = (cx, cy, cz, rx, ry, rz, tag) => {
    for (let dz = Math.ceil(-rz); dz <= rz; dz++) for (let dy = Math.ceil(-ry); dy <= ry; dy++) for (let dx = Math.ceil(-rx); dx <= rx; dx++) {
      const d = (dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2;
      const p = clampP((1.12 - d) / 0.5);
      if (p >= 1 || rnd(cx + dx + tag * 101, cy + dy, cz + dz) < p) putLeaf(cx + dx, cy + dy, cz + dz);
    }
  };
  const branch = (dirIdx, y0, tipR) => {                                    // rama corta: 3 troncos conectados por caras + copa en la punta
    const [sx, sz] = dirs8[dirIdx];
    let tx, tz;
    putLog(sx, y0, 0 * sz);
    if (sx !== 0 && sz !== 0) { putLog(sx, y0, sz); tx = sx; tz = sz; }
    else if (sx !== 0) { putLog(2 * sx, y0, 0); tx = 2 * sx; tz = 0; }
    else { putLog(0, y0, sz); putLog(0, y0, 2 * sz); tx = 0; tz = 2 * sz; }
    putLog(tx, y0 + 1, tz);
    blob(tx, y0 + 1, tz, tipR, tipR * 0.85, tipR, 5 + dirIdx);
  };

  // base gruesa y fuste
  const axisTop = species === SPECIES.PINE ? H - 1 : null;
  let trunkTop;
  if (species === SPECIES.OAK) {
    const ry = Math.max(3, Math.round(H * 0.3)), cy = H - ry, rx = 3 + (rndT(10) < 0.5 ? 1 : 0), rz = 3 + (rndT(11) < 0.5 ? 1 : 0);
    trunkTop = cy - 1;
    blob(0, cy, 0, rx, ry, rz, 1);
    const nb = 2 + (rndT(12) < 0.5 ? 1 : 0), d0 = Math.floor(rndT(13) * 8);
    for (let i = 0; i < nb; i++) branch((d0 + i * 3 + (i > 0 && rndT(14 + i) < 0.5 ? 1 : 0)) % 8, cy - 3 + (rndT(20 + i) < 0.5 ? 1 : 0), 2);
  } else if (species === SPECIES.BIRCH) {
    const ry = H >= 12 ? 4 : 3, cy = H - ry;
    trunkTop = cy;
    blob(0, cy, 0, 2.5, ry, 2.5, 2);
    if (rndT(12) < 0.5) branch(Math.floor(rndT(13) * 8), Math.max(2, cy - 2), 1.3);
  } else {                                                                   // pino: copa cónica en pisos
    trunkTop = axisTop;
    const yb = Math.floor(H * 0.3) + 1;
    for (let dy = yb; dy <= H; dy++) {
      const t = (H - dy) / (H - yb);
      let r = Math.floor(t * 3.4 + 0.5);
      if ((dy - yb) % 2 === 1) r -= 1;                                       // pisos: capas alternas más estrechas
      if (dy === H) continue;                                                // la punta es solo el bloque del eje
      if (r < 1) r = 1;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dz === 0) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r + 1) continue;
        if (d2 > r * r - 1 && rnd(dx, dy, dz) < 0.35) continue;              // borde irregular
        putLeaf(dx, dy, dz);
      }
    }
  }
  for (let dy = 1; dy <= trunkTop; dy++) putLog(0, dy, 0);
  for (let dy = trunkTop + 1; dy <= H; dy++) leaves.set(kOf(0, dy, 0), [0, dy, 0]);   // la punta siempre llega a la altura H
  logs.forEach((_, k) => leaves.delete(k));
  if (tree.thick) {                                                          // base 2x2: cada columna desde su propio suelo hasta ground+baseH
    const top = Math.max(...tree.cols.map((c) => c[2])) + tree.baseH;       // si el suelo vecino está más alto, la base sube con él
    for (const [ox, oz, h2] of tree.cols) for (let y = h2 + 1; y <= top; y++) putLog(ox, y - ground, oz);
  }
  tree.trunk = trunkTop;

  // poda por conectividad: solo sobreviven hojas alcanzables desde un tronco pasando por hojas (caras)
  const seen = new Set(), stack = [];
  const nbrs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const l of logs.values()) stack.push(l);
  while (stack.length) {
    const [a, b, c] = stack.pop();
    for (const [ex, ey, ez] of nbrs) {
      const k = kOf(a + ex, b + ey, c + ez);
      if (seen.has(k) || !leaves.has(k)) continue;
      seen.add(k); stack.push(leaves.get(k));
    }
  }
  const res = [];
  for (const [dx, dy, dz] of logs.values()) res.push([x + dx, ground + dy, z + dz, B.LOG]);
  for (const [k, [dx, dy, dz]] of leaves) if (seen.has(k)) res.push([x + dx, ground + dy, z + dz, B.LEAVES]);
  tree._blocks = res;
  return res;
}

/**
 * Árboles cuyo tronco cae en el rectángulo [x0,x1]x[z0,z1]. Útil para tests y para IA/fauna.
 * Devuelve [{x,z,ground,species,height,trunk,r,thick,baseH,cols,biome}] ordenados por (z,x); `height` = bloques entre el suelo y el tope.
 */
export function listTrees(seed, x0, z0, x1, z1) {
  const S = getSampler(seed);
  const out = treesInRect(S, x0, z0, x1, z1).sort((a, b) => a.z - b.z || a.x - b.x);
  for (const t of out) treeBlocks(seed, t);                                   // fija t.trunk
  return out;
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

  // 4) árboles: troncos a TREE_MARGIN del chunk; solo se escribe dentro del chunk y solo sobre aire.
  const trees = treesInRect(S, x0 - TREE_MARGIN, z0 - TREE_MARGIN, x0 + 15 + TREE_MARGIN, z0 + 15 + TREE_MARGIN);
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
