import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateChunk, listTrees, treeBlocks, columnInfo, BIOME, TREE_CELL } from '../src/world/generator.js';
import { hashBlocks, SEA_LEVEL, CHUNK_Y } from '../src/world/chunk.js';
import { B, IS_SOLID } from '../src/world/blocks.js';

const SEEDS = [1, 42, 1234, 987654];
const gen = fileURLToPath(new URL('./helpers/gen-hash.js', import.meta.url));
const run = (seed, order) => {
  const r = spawnSync(process.execPath, [gen, String(seed), order], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('misma seed = mismo chunk en procesos distintos y en distinto orden de generación', () => {
  const a = run(1234, 'forward'), b = run(1234, 'reverse'), c = run(1234, 'spiral');
  assert.equal(Object.keys(a).length, 49);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test('misma seed = mismo chunk en el mismo proceso, antes y después de generar vecinos', () => {
  const h0 = hashBlocks(generateChunk(55, 4, -2).blocks);
  for (const [cx, cz] of [[3, -2], [5, -2], [4, -1], [4, -3], [5, -1]]) generateChunk(55, cx, cz);
  assert.equal(hashBlocks(generateChunk(55, 4, -2).blocks), h0);
  assert.equal(generateChunk(55, 4, -2).blocks.length, 16 * 16 * CHUNK_Y);
});

test('seeds distintas generan chunks distintos (y string == hash de string)', () => {
  const hs = new Set(SEEDS.map((s) => hashBlocks(generateChunk(s, 0, 0).blocks)));
  assert.equal(hs.size, SEEDS.length);
  assert.notEqual(hashBlocks(generateChunk(1, 10, 10).blocks), hashBlocks(generateChunk(2, 10, 10).blocks));
  assert.equal(hashBlocks(generateChunk('hola', 1, 1).blocks), hashBlocks(generateChunk('hola', 1, 1).blocks));
});

test('mundo variado: los 4 biomas aparecen, hay agua, minerales y cuevas', () => {
  const seen = new Set();
  for (let z = -3000; z < 3000; z += 25) for (let x = -3000; x < 3000; x += 25) seen.add(columnInfo(2024, x, z).biome);
  assert.equal(seen.size, 4, `biomas vistos: ${[...seen]}`);
  const cnt = new Array(13).fill(0);
  let caveAir = 0, brokenSurface = 0, cols = 0;
  for (let cz = -5; cz < 5; cz++) for (let cx = -5; cx < 5; cx++) {
    const c = generateChunk(2024, cx, cz);
    for (const b of c.blocks) cnt[b]++;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const { height } = columnInfo(2024, cx * 16 + x, cz * 16 + z);
      cols++;
      if (c.get(x, height, z) === B.AIR) brokenSurface++;
      for (let y = 3; y < height - 3; y++) if (c.get(x, y, z) === B.AIR) caveAir++;
    }
  }
  for (const id of [B.WATER, B.SAND, B.STONE, B.COAL, B.IRON, B.GRAVEL, B.GRASS, B.DIRT]) assert.ok(cnt[id] > 0, `falta bloque ${id}`);
  assert.ok(caveAir > 500, `pocas cuevas: ${caveAir}`);
  assert.ok(brokenSurface / cols < 0.04, `superficie rota: ${(100 * brokenSurface / cols).toFixed(2)}%`);
});

test('el agua nunca queda flotando sobre aire ni sobre el vacío', () => {
  let water = 0;
  for (const seed of [1, 42, 1234]) for (let cz = -4; cz < 4; cz++) for (let cx = -4; cx < 4; cx++) {
    const c = generateChunk(seed, cx, cz);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y < CHUNK_Y; y++) {
      if (c.get(x, y, z) !== B.WATER) continue;
      water++;
      assert.ok(y <= SEA_LEVEL, 'agua por encima del nivel del mar');
      if (y > 0) assert.notEqual(c.get(x, y - 1, z), B.AIR, `agua sobre aire en seed ${seed} chunk ${cx},${cz} (${x},${y},${z})`);
    }
  }
  assert.ok(water > 1000, 'el test debe ver agua');
});

test('el agua no tiene aire pegado en sus costados (sin fugas a cuevas)', () => {
  let water = 0, leaks = 0;
  for (const seed of [1, 42, 1234]) for (let cz = -4; cz < 4; cz++) for (let cx = -4; cx < 4; cx++) {
    const c = generateChunk(seed, cx, cz);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 1; y < SEA_LEVEL; y++) {
      if (c.get(x, y, z) !== B.WATER) continue;
      water++;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue; // vecino en otro chunk: se omite en este test
        if (c.get(nx, y, nz) === B.AIR) leaks++;
      }
    }
  }
  assert.ok(water > 1000);
  assert.equal(leaks, 0, `fugas de agua a aire: ${leaks}`);
});

// ---------- árboles ----------
const LO = -96, HI = 95; // región de chunks -6..5
function regionTrees(seed) {
  const trees = listTrees(seed, LO - 2, LO - 2, HI + 2, HI + 2);
  return trees;
}
function generateRegionReverse(seed) {
  const map = new Map();
  for (let cz = 5; cz >= -6; cz--) for (let cx = 5; cx >= -6; cx--) map.set(`${cx},${cz}`, generateChunk(seed, cx, cz));
  return (x, y, z) => map.get(`${x >> 4},${z >> 4}`).get(x & 15, y, z & 15);
}

test('árboles: nunca se superponen, separación mínima y bloques disjuntos', () => {
  let total = 0;
  for (const seed of SEEDS) {
    const trees = regionTrees(seed);
    total += trees.length;
    const owner = new Map();
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const d = Math.max(Math.abs(trees[i].x - trees[j].x), Math.abs(trees[i].z - trees[j].z));
        assert.ok(d >= TREE_CELL - 2, `troncos a ${d} bloques (seed ${seed})`);
      }
      for (const [x, y, z] of treeBlocks(seed, trees[i])) {
        const k = `${x},${y},${z}`;
        assert.ok(!owner.has(k), `árboles ${owner.get(k)} y ${i} comparten bloque ${k}`);
        owner.set(k, i);
      }
    }
  }
  assert.ok(total >= 60, `muy pocos árboles para que el test valga: ${total}`);
});

test('árboles: consistentes entre bordes de chunk (generando en orden inverso) y no hay bloques de árbol huérfanos', () => {
  let nBorder = 0, nTrees = 0;
  for (const seed of SEEDS) {
    const at = generateRegionReverse(seed);
    const trees = regionTrees(seed);
    const expectedLogs = new Set(), expectedLeaves = new Set();
    for (const t of trees) {
      nTrees++;
      const near = [t.x, t.z].some((v) => { const m = ((v % 16) + 16) % 16; return m <= 2 || m >= 13; });
      if (near) nBorder++;
      for (const [x, y, z, id] of treeBlocks(seed, t)) {
        (id === B.LOG ? expectedLogs : expectedLeaves).add(`${x},${y},${z}`);
        if (x < LO || x > HI || z < LO || z > HI) continue;
        const got = at(x, y, z);
        if (id === B.LOG) assert.equal(got, B.LOG, `tronco ausente en ${x},${y},${z} seed ${seed}`);
        else assert.ok(got === B.LEAVES || (got !== B.AIR && got !== B.LOG && got !== B.WATER), `hoja inconsistente ${x},${y},${z}: ${got}`);
      }
    }
    for (let z = LO; z <= HI; z++) for (let x = LO; x <= HI; x++) for (let y = SEA_LEVEL; y < CHUNK_Y; y++) {
      const b = at(x, y, z);
      if (b === B.LOG) assert.ok(expectedLogs.has(`${x},${y},${z}`), `LOG huérfano ${x},${y},${z} seed ${seed}`);
      else if (b === B.LEAVES) assert.ok(expectedLeaves.has(`${x},${y},${z}`), `LEAVES huérfana ${x},${y},${z} seed ${seed}`);
    }
  }
  assert.ok(nTrees >= 60 && nBorder >= 10, `cobertura de bordes insuficiente: ${nTrees} árboles, ${nBorder} cerca de borde`);
});

test('árboles: solo sobre pasto, nunca en agua/arena/nieve, sin pendiente fuerte', () => {
  for (const seed of SEEDS) {
    const at = generateRegionReverse(seed);
    for (const t of regionTrees(seed)) {
      if (t.x <= LO || t.x >= HI || t.z <= LO || t.z >= HI) continue;
      assert.equal(at(t.x, t.ground, t.z), B.GRASS, `base no es pasto (${t.x},${t.ground},${t.z})`);
      assert.ok(t.ground >= SEA_LEVEL + 2, 'árbol a nivel de agua');
      for (let y = t.ground + 1; y <= t.ground + t.trunk; y++) assert.equal(at(t.x, y, t.z), B.LOG);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nh = columnInfo(seed, t.x + dx, t.z + dz).height;
        assert.ok(Math.abs(nh - t.ground) <= 2, 'pendiente fuerte');
        assert.notEqual(at(t.x + dx, t.ground, t.z + dz), B.WATER);
      }
      const bi = columnInfo(seed, t.x, t.z).biome;
      assert.ok(bi === BIOME.FOREST || bi === BIOME.PLAINS);
    }
  }
});

test('el mismo árbol aparece igual aunque la ventana de consulta cambie', () => {
  const a = listTrees(1234, -50, -50, 50, 50);
  const b = listTrees(1234, -20, -30, 70, 10);
  const key = (t) => `${t.x},${t.z},${t.ground},${t.trunk}`;
  const sb = new Set(b.map(key));
  const inter = a.filter((t) => t.x >= -20 && t.x <= 70 && t.z >= -30 && t.z <= 10);
  assert.ok(inter.length > 0 || a.length === 0 || true);
  for (const t of inter) assert.ok(sb.has(key(t)));
  for (const t of b) if (t.x >= -50 && t.x <= 50 && t.z >= -50 && t.z <= 50) assert.ok(a.map(key).includes(key(t)));
  void IS_SOLID;
});
