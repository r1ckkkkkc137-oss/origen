// Generación determinista de chunks. generateChunk(seed, cx, cz) es una FUNCIÓN PURA de (seed, cx, cz):
// no depende de qué chunks se generaron antes. Todo se deriva de funciones puras por columna (x,z) o por voxel (x,y,z).
//
// Capas, en orden: terreno (altura por fbm + clima) -> minerales/grava -> cuevas -> árboles.
// Árboles: ver la sección «árboles» (candidato por celda + resolución de conflictos local y pura).
import { B, NATURAL_LOG, LEAF_OF } from './blocks.js';
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

// ---------- entradas de cueva (túneles-rampa que cortan la superficie) ----------
// Cada celda de ENT_CELL x ENT_CELL (32 = 2 chunks) tiene como mucho UNA entrada: posición, rumbo y ritmo de giro salen de hash3(seed, celda). Hasta 6 posiciones
// candidatas por celda; vale la primera con tierra firme (h >= SEA+3, así el túnel nunca queda bajo agua ni en una playa). El túnel arranca en la superficie, se
// mete hacia la ladera MÁS ALTA (si hay pendiente; si no, rumbo por hash), baja 0,55 bloques por bloque hasta ~12 bajo la entrada y sigue llano 10 bloques
// con una sala al final. Es una lista de elipsoides (rh x rv) ya calculada de forma pura: cada chunk solo estampa los que lo tocan, en cualquier orden.
// Reglas de seguridad: nunca talla agua ni columnas con agua alrededor (3x3 con h < SEA_LEVEL), nunca por encima de la superficie, y fuera de la "zona de boca"
// (los primeros ENT_MOUTH_STEPS pasos) deja >= 2 bloques de techo. Los árboles no nacen a ENT_TREE_CLEAR de la boca (no quedan troncos flotando sobre el hueco).
export const ENT_CELL = 32, ENT_P = 1.0, ENT_MOUTH_STEPS = 9, ENT_TREE_CLEAR = 12;
const ENT_SALT = 0xca7e, ENT_REACH = 52, ENT_RH = 2.3, ENT_RV = 2.7, ENT_SLOPE = 0.55;
function entranceCell(S, ex, ez) {
  const key = ex * 2097152 + ez;
  let cache = S.entCells; if (!cache) cache = S.entCells = new Map();
  if (cache.has(key)) return cache.get(key);
  if (cache.size > 20000) cache.clear();
  const res = computeEntrance(S, ex, ez);
  cache.set(key, res);
  return res;
}
function computeEntrance(S, ex, ez) {
  const es = S.seed ^ ENT_SALT;
  if (hash3(es, ex, 0, ez) >= ENT_P) return null;
  let x = 0, z = 0, h = -1;
  for (let k = 0; k < 6 && h < 0; k++) {
    const cx = ex * ENT_CELL + 4 + Math.floor(hash3(es, ex, 20 + 2 * k, ez) * (ENT_CELL - 8)), cz = ez * ENT_CELL + 4 + Math.floor(hash3(es, ex, 21 + 2 * k, ez) * (ENT_CELL - 8));
    const hh = colInfo(S, cx, cz);
    if (hh >= SEA_LEVEL + 3 && hh <= HEIGHT_MAX - 8) { x = cx; z = cz; h = hh; }
  }
  if (h < 0) return null;
  // rumbo: hacia el lado más alto (se mete en la ladera); sin pendiente, rumbo por hash
  const gx = colInfo(S, x + 6, z) - colInfo(S, x - 6, z), gz = colInfo(S, x, z + 6) - colInfo(S, x, z - 6);
  let a = Math.hypot(gx, gz) >= 3 ? Math.atan2(gz, gx) + (hash3(es, ex, 8, ez) - 0.5) * 0.6 : hash3(es, ex, 9, ez) * Math.PI * 2;
  const yT = Math.max(5, h - 12);
  const spheres = [];                                  // [cx, cy, cz, rh, rv, step]
  let px = x + 0.5, pz = z + 0.5, yc = h + 1, step = 0, flat = 0;
  while (flat < 10 && step < 60) {
    spheres.push([px, yc, pz, ENT_RH, ENT_RV, step]);
    a += (hash3(es, ex, 100 + step, ez) - 0.5) * 0.3;
    px += Math.cos(a); pz += Math.sin(a);
    if (yc > yT + 1) yc = Math.max(yT + 1, yc - ENT_SLOPE); else flat++;
    step++;
  }
  spheres.push([px, yc, pz, 3.4, 3.2, step]);          // sala final
  return { ex, ez, x, z, h, spheres };
}
/** ¿Hay una boca de cueva a menos de `d` bloques (Chebyshev) de (x,z)? Pura. Solo la boca (inicio), no todo el túnel. */
function nearEntrance(S, x, z, d = ENT_TREE_CLEAR) {
  const ex0 = Math.floor((x - d) / ENT_CELL), ex1 = Math.floor((x + d) / ENT_CELL), ez0 = Math.floor((z - d) / ENT_CELL), ez1 = Math.floor((z + d) / ENT_CELL);
  for (let ez = ez0; ez <= ez1; ez++) for (let ex = ex0; ex <= ex1; ex++) {
    const e = entranceCell(S, ex, ez);
    if (e && Math.abs(e.x - x) <= d && Math.abs(e.z - z) <= d) return true;
  }
  return false;
}
/** Entradas de cueva cuya boca cae en [x0,x1]x[z0,z1]: [{x,z,h,dirX,dirZ}] (debug, tests, spawn de cámara). */
export function listCaveEntrances(seed, x0, z0, x1, z1) {
  const S = getSampler(seed), out = [];
  for (let ez = Math.floor(z0 / ENT_CELL); ez <= Math.floor(z1 / ENT_CELL); ez++) for (let ex = Math.floor(x0 / ENT_CELL); ex <= Math.floor(x1 / ENT_CELL); ex++) {
    const e = entranceCell(S, ex, ez);
    if (!e || e.x < x0 || e.x > x1 || e.z < z0 || e.z > z1) continue;
    const s1 = e.spheres[Math.min(4, e.spheres.length - 1)];
    out.push({ x: e.x, z: e.z, h: e.h, dirX: s1[0] - (e.x + 0.5), dirZ: s1[2] - (e.z + 0.5), bottomY: e.spheres[e.spheres.length - 1][1] });
  }
  return out.sort((a, b) => a.z - b.z || a.x - b.x);
}

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
// queda a menos de rA + rB + 1 bloques (Chebyshev): ni copas ni troncos se superponen. Como "válido" y "prioridad" son puros, la
// decisión no depende del chunk ni del orden de generación: todo chunk que toque un árbol dibuja exactamente los mismos bloques.
export const SPECIES = Object.freeze({ OAK: 0, PINE: 1, BIRCH: 2 });
export const SPECIES_NAMES = ['oak', 'pine', 'birch'];
export const TREE_CELL = 6;
export const TREE_REACH = Object.freeze([4, 3, 3]);   // radio horizontal máximo (copa+ramas) por especie
export const TREE_MAX_REACH = 4;
export const TREE_HEIGHT = Object.freeze([[10, 15], [13, 18], [10, 14]]);   // [min,max] bloques sobre el suelo, por especie (0,5 m/bloque: 5–9 m)
const TREE_MARGIN = TREE_MAX_REACH + 1;              // + 1 por la base 2x2 (puede correrse un bloque)
const TREE_SEP_PAD = 1;
const NB = 2;                                        // celdas vecinas a revisar: (4+4+1) / 6 -> 2

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
  const dens = biome === BIOME.FOREST ? 1.0 : biome === BIOME.PLAINS ? 0.14 : biome === BIOME.SNOWY_MOUNTAIN ? 0.3 : 0;
  if (dens === 0 || hash3(ts, cx, 3, cz) >= dens) return null;
  const ground = terrainHeight(S, x, z, _c.t, _c.hum);
  if (ground < SEA_LEVEL + 2) return null;                                   // agua / arena de orilla
  const hW = colInfo(S, x - 1, z), hE = colInfo(S, x + 1, z), hN = colInfo(S, x, z - 1), hS = colInfo(S, x, z + 1);
  const steep = Math.max(Math.abs(ground - hW), Math.abs(ground - hE), Math.abs(ground - hN), Math.abs(ground - hS));
  if (steep > 2) return null;
  const top = surfaceOf(biome, ground, steep).top;
  if (top !== B.GRASS && !(biome === BIOME.SNOWY_MOUNTAIN && top === B.SNOW)) return null;
  if (nearEntrance(S, x, z)) return null;
  const species = chooseSpecies(biome, t, hash3(ts, cx, 7, cz));
  const [hMin, hMax] = TREE_HEIGHT[species];
  const height = hMin + Math.floor(hash3(ts, cx, 6, cz) * (hMax - hMin + 1));
  if (ground + height > CHUNK_Y - 1) return null;                            // cabe en 64 bloques
  const thick = species !== SPECIES.BIRCH && height >= 13;
  const baseH = Math.ceil(height / 3);                                        // niveles de base 2x2 COMPLETA: al menos 1/3 de la altura (luego se afina 4→3→2→1 bloques)
  let cols = [[0, 0, ground]], roots = [];
  if (thick) {
    const sx = hash3(ts, cx, 8, cz) < 0.5 ? -1 : 0, sz = hash3(ts, cx, 9, cz) < 0.5 ? -1 : 0;   // dónde queda el 2x2 respecto al eje
    cols = [[0, 0, ground]];
    for (const [ox, oz] of [[sx, sz], [sx + 1, sz], [sx, sz + 1], [sx + 1, sz + 1]]) {
      if (ox === 0 && oz === 0) continue;
      const h2 = colInfo(S, x + ox, z + oz);
      if (h2 < SEA_LEVEL + 2 || Math.abs(h2 - ground) > 2) return null;
      cols.push([ox, oz, h2]);
    }
    if (height >= 15) {                                                        // raíces de 1 bloque pegadas al 2x2 (árboles grandes): 2-3 de las 8 celdas del perímetro
      const per = [];
      for (const oz of [sz, sz + 1]) { per.push([sx - 1, oz, sx, oz]); per.push([sx + 2, oz, sx + 1, oz]); }
      for (const ox of [sx, sx + 1]) { per.push([ox, sz - 1, ox, sz]); per.push([ox, sz + 2, ox, sz + 1]); }
      const order = per.map((p, i) => [hash3(ts, cx, 20 + i, cz), p]).sort((a, b) => a[0] - b[0]);
      const want = 2 + (hash3(ts, cx, 19, cz) < 0.5 ? 1 : 0);
      for (const [, [rx, rz, tx, tz]] of order) {
        if (roots.length >= want) break;
        const hr = colInfo(S, x + rx, z + rz), ht = cols.find((c) => c[0] === tx && c[1] === tz)[2];
        if (hr < SEA_LEVEL + 2 || hr < ht || hr > ht + 1 || nearEntrance(S, x + rx, z + rz)) continue;     // sobre suelo sólido, pegada a un tronco al mismo nivel
        roots.push([rx, rz, hr]);
      }
    }
  }
  return { cx, cz, x, z, ground, species, height, r: TREE_REACH[species], thick, baseH, cols, roots, prio: hash3(ts, cx, 5, cz), biome, trunk: 0, _blocks: null, _ok: undefined };
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
  if (tree.thick) {                                                          // base 2x2: cada columna desde su propio suelo hasta `top`
    const top = Math.max(...tree.cols.map((c) => c[2])) + tree.baseH;       // 2x2 completa ≥ 1/3 de la altura; si el suelo vecino está más alto, la base sube con él
    for (const [ox, oz, h2] of tree.cols) for (let y = h2 + 1; y <= top; y++) putLog(ox, y - ground, oz);
    // afinado 4→3→2→1: nivel top+1 sin la columna diagonal al eje; nivel top+2 solo el eje + un vecino ortogonal (elegido por hash)
    const diag = tree.cols.find((c) => c[0] !== 0 && c[1] !== 0), orth = tree.cols.filter((c) => c !== diag && !(c[0] === 0 && c[1] === 0));
    const keep = orth[rndT(30) < 0.5 ? 0 : 1];
    for (const [ox, oz] of orth) if (top + 1 - ground <= trunkTop) putLog(ox, top + 1 - ground, oz);
    if (top + 2 - ground <= trunkTop) putLog(keep[0], top + 2 - ground, keep[1]);
    for (const [rx, rz, hr] of tree.roots) putLog(rx, hr + 1 - ground, rz);   // raíces: 1 bloque sobre el suelo, cara a cara con el tronco
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
  const logId = NATURAL_LOG[species], leafId = LEAF_OF[species];
  for (const [dx, dy, dz] of logs.values()) res.push([x + dx, ground + dy, z + dz, logId]);
  for (const [k, [dx, dy, dz]] of leaves) if (seen.has(k)) res.push([x + dx, ground + dy, z + dz, leafId]);
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

// ---------- minerales en vetas ----------
// Cada celda (cs^3) tiene como mucho UNA veta: ¿hay?, centro, radios y ruido del borde salen de hash3(seed, celda). Solo reemplaza PIEDRA (nunca tierra/grava/agua)
// y se estampa ANTES de las cuevas, así las paredes de cueva exponen mena donde se cruzan. Carbón: más superficial y abundante (centros y 10..45, celda 8, vetas de
// ~30-60 bloques). Hierro: más profundo y escaso (centros y 2..17, celda 10, vetas de ~15-30). Si dos vetas se solapan gana la primera estampada (hierro primero).
const ORE_KINDS = [
  { id: B.IRON, salt: 0x1a0e, cs: 10, yLo: 2, yHi: 15, p: 0.24, rMin: 1.3, rMax: 2.4 },
  { id: B.COAL, salt: 0xc0a1, cs: 8, yLo: 12, yHi: 46, p: 0.68, rMin: 1.5, rMax: 3.0 },
];
function stampOres(S, blocks, x0, z0) {
  for (const k of ORE_KINDS) {
    const { cs, rMax } = k, os = S.seed ^ k.salt;
    const ex0 = Math.floor((x0 - rMax) / cs), ex1 = Math.floor((x0 + 15 + rMax) / cs), ez0 = Math.floor((z0 - rMax) / cs), ez1 = Math.floor((z0 + 15 + rMax) / cs);
    const ey0 = Math.floor((k.yLo - rMax) / cs), ey1 = Math.floor((k.yHi + rMax) / cs);
    for (let ez = ez0; ez <= ez1; ez++) for (let ey = ey0; ey <= ey1; ey++) for (let ex = ex0; ex <= ex1; ex++) {
      if (hash3(os, ex, ey, ez) >= k.p) continue;
      const cx = ex * cs + hash3(os, ex, ey + 1000, ez) * cs, cy = ey * cs + hash3(os, ex, ey + 2000, ez) * cs, cz = ez * cs + hash3(os, ex, ey + 3000, ez) * cs;
      if (cy < k.yLo || cy > k.yHi) continue;
      const rx = k.rMin + hash3(os, ex, ey + 4000, ez) * (k.rMax - k.rMin), ry = rx * (0.7 + 0.3 * hash3(os, ex, ey + 5000, ez)), rz = k.rMin + hash3(os, ex, ey + 6000, ez) * (k.rMax - k.rMin);
      const xa = Math.max(x0, Math.ceil(cx - rx)), xb = Math.min(x0 + 15, Math.floor(cx + rx)), za = Math.max(z0, Math.ceil(cz - rz)), zb = Math.min(z0 + 15, Math.floor(cz + rz));
      const ya = Math.max(1, Math.ceil(cy - ry)), yb = Math.min(CHUNK_Y - 1, Math.floor(cy + ry));
      for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) for (let x = xa; x <= xb; x++) {
        const idx = (x - x0) + ((z - z0) << 4) + (y << 8);
        if (blocks[idx] !== B.STONE) continue;
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 + ((z + 0.5 - cz) / rz) ** 2;
        if (d <= 1 - 0.45 * hash3(os, x, y + 7000, z)) blocks[idx] = k.id;
      }
    }
  }
}

/** Talla las entradas de cueva que tocan este chunk (ver entranceCell). Solo columnas del chunk; usa la rejilla de alturas g (con pad) para las reglas de agua/techo. */
function carveEntrances(S, blocks, g, W, x0, z0) {
  const ex0 = Math.floor((x0 - ENT_REACH) / ENT_CELL), ex1 = Math.floor((x0 + 15 + ENT_REACH) / ENT_CELL), ez0 = Math.floor((z0 - ENT_REACH) / ENT_CELL), ez1 = Math.floor((z0 + 15 + ENT_REACH) / ENT_CELL);
  for (let ez = ez0; ez <= ez1; ez++) for (let ex = ex0; ex <= ex1; ex++) {
    const e = entranceCell(S, ex, ez);
    if (!e) continue;
    for (const [cx, cy, cz, rh, rv, step] of e.spheres) {
      const xa = Math.max(x0, Math.floor(cx - rh)), xb = Math.min(x0 + 15, Math.ceil(cx + rh)), za = Math.max(z0, Math.floor(cz - rh)), zb = Math.min(z0 + 15, Math.ceil(cz + rh));
      if (xa > xb || za > zb) continue;
      const ya = Math.max(2, Math.floor(cy - rv)), yb = Math.min(CHUNK_Y - 1, Math.ceil(cy + rv));
      const mouth = step < ENT_MOUTH_STEPS;
      for (let z = za; z <= zb; z++) for (let x = xa; x <= xb; x++) {
        const dh = ((x + 0.5 - cx) / rh) ** 2 + ((z + 0.5 - cz) / rh) ** 2;
        if (dh > 1) continue;
        const gi = (x - x0) + GRID_PAD + ((z - z0) + GRID_PAD) * W;
        const h = g.h[gi];
        // sin agua en la columna ni a su lado (3x3): ningún hueco queda pegado a agua
        if (g.h[gi - 1] < SEA_LEVEL || g.h[gi + 1] < SEA_LEVEL || g.h[gi - W] < SEA_LEVEL || g.h[gi + W] < SEA_LEVEL || g.h[gi - W - 1] < SEA_LEVEL || g.h[gi - W + 1] < SEA_LEVEL || g.h[gi + W - 1] < SEA_LEVEL || g.h[gi + W + 1] < SEA_LEVEL || h < SEA_LEVEL) continue;
        const ymax = mouth ? h : h - 2;
        for (let y = ya; y <= yb && y <= ymax; y++) {
          const dy = (y + 0.5 - cy) / rv;
          if (dh + dy * dy > 1) continue;
          const idx = (x - x0) + ((z - z0) << 4) + (y << 8);
          const cur = blocks[idx];
          if (cur !== B.AIR && cur !== B.WATER) blocks[idx] = B.AIR;
        }
      }
    }
  }
}

// ---------- chunk ----------
export function generateChunk(seed, cx, cz) {
  const S = getSampler(seed);
  const chunk = new Chunk(cx, cz);
  const blocks = chunk.blocks;
  const x0 = cx * 16, z0 = cz * 16;
  const W = 16 + GRID_PAD * 2;
  const g = buildGrid(S, x0 - GRID_PAD, z0 - GRID_PAD, W, W);
  const grv = S.gravel;

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

    // 2) grava (solo reemplaza piedra, bajo la capa superficial). Los minerales son vetas por celda (stampOres, más abajo).
    const stoneTop = h - 1 - surf.depth;
    for (let y = 3; y <= stoneTop && y <= h - 4; y++) {
      const idx = col + (y << 8);
      if (blocks[idx] === B.STONE && grv.noise3(wx * 0.07, y * 0.09, wz * 0.07) > 0.62) blocks[idx] = B.GRAVEL;
    }

  }
  stampOres(S, blocks, x0, z0);

  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const wx = x0 + lx, wz = z0 + lz;
    const h = g.h[lx + GRID_PAD + (lz + GRID_PAD) * W];
    const col = lx + (lz << 4);
    // 3) cuevas: túneles "spaghetti" (dos ruidos 3D cerca de 0) + cavernas profundas.
    // Techo: a >= 4 bloques bajo la superficie -> el agua nunca queda sobre aire. Las bocas son los túneles-rampa de entranceCell (más abajo).
    const minDepth = MIN_CAVE_DEPTH;
    const yMax = Math.min(h - MIN_CAVE_DEPTH, CHUNK_Y - 1);
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

  carveEntrances(S, blocks, g, W, x0, z0);

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
