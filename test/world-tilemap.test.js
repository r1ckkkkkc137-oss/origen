import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TILE_NAMES, ATLAS_COLS, ATLAS_ROWS, TILE_OF, tileFor, tileIndex, FACE, BLOCK_TILES } from '../src/world/tilemap.js';
import { BLOCKS, B, BLOCK_COUNT } from '../src/world/blocks.js';
import { createGeometry, createVoxelMaterial, VERTEX_SHADER, FRAGMENT_SHADER } from '../src/world/threeAdapter.js';
import { World } from '../src/world/world.js';
import { BLOCK, CHUNK } from '../src/shared/contracts.js';
import { CHUNK_X, CHUNK_Y, CHUNK_Z } from '../src/world/chunk.js';

test('tilemap: todos los bloques no-aire tienen tile en todas las caras, dentro del atlas', () => {
  assert.ok(TILE_NAMES.length <= ATLAS_COLS * ATLAS_ROWS);
  for (let id = 1; id < BLOCK_COUNT; id++) for (let f = 0; f < 6; f++) {
    assert.ok(BLOCK_TILES[id] !== undefined, `bloque ${id} sin tile`);
    assert.equal(TILE_OF[id * 6 + f], tileFor(id, f));
    assert.ok(TILE_OF[id * 6 + f] < TILE_NAMES.length);
  }
  assert.notEqual(TILE_OF[B.GRASS * 6 + FACE.TOP], TILE_OF[B.GRASS * 6 + FACE.PX]);
  assert.notEqual(TILE_OF[B.GRASS * 6 + FACE.BOTTOM], TILE_OF[B.GRASS * 6 + FACE.TOP]);
  assert.equal(TILE_OF[B.GRASS * 6 + FACE.BOTTOM], tileIndex('dirt'));
  assert.throws(() => tileIndex('nope'));
});

test('tilemap: los 8 primeros nombres coinciden con el atlas de Arte (si está disponible en /tmp/origen-art)', (t) => {
  const p = '/tmp/origen-art/src/render/atlas.js';
  if (!fs.existsSync(p)) return t.skip('atlas de Arte no disponible');
  const m = fs.readFileSync(p, 'utf8').match(/export const TILES = (\[[^\]]*\])/);
  assert.ok(m);
  const arte = JSON.parse(m[1].replace(/'/g, '"'));
  assert.deepEqual(TILE_NAMES.slice(0, arte.length), arte);
  assert.equal(ATLAS_COLS, 4);
});

test('contrato: ids de BLOCK y dimensiones de CHUNK son los del contrato', () => {
  for (const [k, v] of Object.entries(BLOCK)) assert.equal(BLOCKS[v] !== undefined, true, `${k}`);
  assert.equal(B.GRASS, BLOCK.GRASS); assert.equal(B.DIRT, BLOCK.DIRT); assert.equal(B.STONE, BLOCK.STONE);
  assert.equal(B.LOG, BLOCK.WOOD); assert.equal(B.LEAVES, BLOCK.LEAVES); assert.equal(B.WATER, BLOCK.WATER);
  assert.equal(B.SAND, BLOCK.SAND); assert.equal(B.COAL, BLOCK.ORE);
  assert.deepEqual([CHUNK_X, CHUNK_Y, CHUNK_Z], [CHUNK.SX, CHUNK.SY, CHUNK.SZ]);
  const ids = Object.values(B); assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
});

test('contrato: World expone seed, getBlock, setBlock, chunk, chunks (iterable) y raycast con forma RaycastHit', () => {
  const w = new World(1234);
  assert.equal(w.seed, 1234);
  const c = w.chunk(0, 0);
  assert.ok(c.blocks instanceof Uint8Array && c.blocks.length === CHUNK.SX * CHUNK.SY * CHUNK.SZ);
  assert.equal(c.cx, 0); assert.equal(c.cz, 0); assert.equal(typeof c.dirty, 'boolean');
  assert.deepEqual([...w.chunks()].map((k) => [k.cx, k.cz]), [[0, 0]]);
  const h = w.raycast([0.5, 60, 0.5], [0, -1, 0], 100);
  assert.ok(Array.isArray(h.pos) && Array.isArray(h.normal) && typeof h.block === 'number' && typeof h.dist === 'number');
  assert.equal(w.getBlock(0, 999, 0), 0); assert.equal(w.getBlock(0, -1, 0), 0);
});

test('threeAdapter: createGeometry/createVoxelMaterial con THREE falso (sin GPU)', () => {
  const calls = [];
  const THREE = {
    BufferGeometry: class { setAttribute(n, a) { calls.push([n, a.itemSize, a.array.length]); } setIndex(a) { calls.push(['index', a.itemSize, a.array.length]); } },
    BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } },
    ShaderMaterial: class { constructor(o) { Object.assign(this, o); } },
    Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
    UniformsLib: { fog: { fogColor: { value: 0 } } },
    UniformsUtils: { merge: (a) => Object.assign({}, ...a) },
  };
  const m = new World(1234).meshChunk(0, 0);
  createGeometry(THREE, m.opaque);
  const n = m.opaque.vertexCount;
  assert.deepEqual(calls, [['position', 3, n * 3], ['normal', 3, n * 3], ['uv', 2, n * 2], ['tile', 1, n], ['index', 1, m.opaque.indices.length]]);
  const mat = createVoxelMaterial(THREE, {}, 'cutout');
  assert.equal(mat.uniforms.uAlphaTest.value, 0.5); assert.equal(createVoxelMaterial(THREE, {}, 'water').transparent, true);
  assert.equal(mat.uniforms.uGrid.value.x, ATLAS_COLS);
  assert.ok(VERTEX_SHADER.includes('attribute float tile') && FRAGMENT_SHADER.includes('fract(vUv)') && FRAGMENT_SHADER.includes('textureGrad(uAtlas, tuv, dFdx(vUv) / uGrid, dFdy(vUv) / uGrid)') && !FRAGMENT_SHADER.includes('texture2D'));
});

test('threeAdapter: buildTileMap usa sustitutos para tiles que el atlas no tiene y respeta los que sí', async () => {
  const { buildTileMap } = await import('../src/world/threeAdapter.js');
  const arte = ['grass_top', 'grass_side', 'dirt', 'stone', 'log_side', 'log_top', 'planks', 'leaves'];
  const { map, missing } = buildTileMap(arte);
  assert.deepEqual(missing, ['sand', 'snow', 'gravel', 'coal_ore', 'iron_ore', 'water']);
  for (let i = 0; i < 8; i++) assert.equal(map[i], i);
  for (let i = 8; i < TILE_NAMES.length; i++) assert.ok(map[i] < 8);
  const full = buildTileMap(TILE_NAMES); assert.deepEqual(full.missing, []); assert.deepEqual([...full.map], TILE_NAMES.map((_, i) => i));
});

test('threeAdapter: createWorldView carga, malla por presupuesto, descarga y libera geometrías (THREE falso)', async () => {
  const { createWorldView } = await import('../src/world/threeAdapter.js');
  let disposed = 0;
  class Obj { constructor() { this.children = []; this.position = { set() {} }; } add(o) { this.children.push(o); } remove(o) { this.children = this.children.filter((c) => c !== o); } updateMatrix() {} }
  const THREE = {
    BufferGeometry: class { setAttribute() {} setIndex() {} dispose() { disposed++; } },
    BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
    ShaderMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
    Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
    UniformsLib: { fog: {} }, UniformsUtils: { merge: (a) => Object.assign({}, ...a) },
    Group: Obj, Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
  };
  const scene = new Obj(), world = new World(1234);
  const view = createWorldView(THREE, scene, world, { texture: {}, canvas: { width: 64, height: 32 } }, { radius: 2, maxMeshPerFrame: 3, tileNames: ['grass_top', 'grass_side', 'dirt', 'stone', 'log_side', 'log_top', 'planks', 'leaves'] });
  assert.deepEqual(view.grid, { cols: 4, rows: 2 });
  assert.ok(view.missingTiles.length === 6);
  let frames = 0; while (view.stats().chunks < 13 && frames++ < 100) view.update(4, 4);   // radio 2 en chunks ≈ 13 chunks
  const st = view.stats();
  assert.ok(st.chunks >= 12 && st.chunks <= 13 && st.pendingMesh === 0 && st.triangles > 0, JSON.stringify(st));
  assert.ok(frames >= 4, 'el presupuesto por frame reparte el mallado');
  for (let f = 0; f < 3; f++) view.update(4 + 200, 4);   // lejos (200 m = 25 chunks): lo anterior se descarga
  assert.ok(disposed > 0);
  assert.ok(view.stats().chunks <= 13 && view.group.children.length <= 40);
  view.dispose();
});
