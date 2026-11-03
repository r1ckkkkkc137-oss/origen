import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateChunk, columnInfo, BIOME } from '../src/world/generator.js';
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

