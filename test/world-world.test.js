import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_SIZE_M as S } from '../src/world/units.js';
import { World } from '../src/world/world.js';
import { B, BLOCKS } from '../src/world/blocks.js';
import { hashBlocks, CHUNK_Y, SEA_LEVEL } from '../src/world/chunk.js';
import { createRng } from '../src/shared/rng.js';

const regionHash = (w, c0, c1) => {
  const o = [];
  for (let cz = c0; cz <= c1; cz++) for (let cx = c0; cx <= c1; cx++) o.push(hashBlocks(w.getChunk(cx, cz).blocks));
  return o.join(',');
};

function findColumn(w, pred) {
  for (let z = -40; z < 40; z++) for (let x = -40; x < 40; x++) { const y = w.surfaceY(x, z); if (y > 0 && pred(w.getBlock(x, y, z), x, y, z)) return { x, y, z }; }
  throw new Error('columna no encontrada');
}

test('getBlock/setBlock en coordenadas globales (incluye negativas y bordes de chunk)', () => {
  const w = new World(5);
  for (const [x, z] of [[0, 0], [-1, -1], [15, 16], [-16, -17], [31, -32]]) {
    assert.equal(w.setBlock(x, 60, z, B.PLANKS), true);        // true = cambió
    assert.equal(w.setBlock(x, 60, z, B.PLANKS), false);       // mismo valor: no cambió
    assert.equal(w.getBlock(x, 60, z), B.PLANKS);
    assert.equal(w.getChunk(x >> 4, z >> 4).get(x & 15, 60, z & 15), B.PLANKS);
    assert.equal(w.chunk(x >> 4, z >> 4).blocks[(x & 15) + 16 * ((z & 15) + 16 * 60)], B.PLANKS); // índice del contrato
  }
  assert.equal(w.getBlock(0, -5, 0), B.AIR);                   // contrato: fuera de rango => AIR
  assert.equal(w.getBlock(0, 500, 0), B.AIR);
  assert.equal(w.setBlock(0, CHUNK_Y, 0, B.STONE), false);
  assert.equal(w.setBlock(0, 10, 0, 99), false);
});

test('dig devuelve el drop, deja aire, y no rompe aire ni agua', () => {
  const w = new World(1234);
  const g = findColumn(w, (id) => id === B.GRASS);
  const r = w.dig(g.x, g.y, g.z);
  assert.deepEqual(r, { broken: B.GRASS, drop: B.DIRT });
  assert.equal(w.getBlock(g.x, g.y, g.z), B.AIR);
  assert.equal(w.dig(g.x, g.y, g.z), null);
  assert.equal(w.dig(g.x, -1, g.z), null);
  let wx = null;
  for (let x = -200; x < 200 && !wx; x++) for (let z = -200; z < 200 && !wx; z += 3) if (w.getBlock(x, SEA_LEVEL, z) === B.WATER) wx = { x, z };
  assert.ok(wx, 'debe haber agua');
  assert.equal(w.dig(wx.x, SEA_LEVEL, wx.z), null);
  assert.equal(w.getBlock(wx.x, SEA_LEVEL, wx.z), B.WATER);
  const s = findColumn(w, (id) => id === B.STONE);
  assert.deepEqual(w.dig(s.x, s.y, s.z), { broken: B.STONE, drop: BLOCKS[B.STONE].drop });
});

test('place: solo adyacente a sólido, sobre aire/agua, nunca en aire flotante ni sobre sólido ni dentro de una entidad', () => {
  const w = new World(1234);
  const g = findColumn(w, (id) => id === B.GRASS);
  assert.equal(w.place(g.x, g.y + 1, g.z, B.PLANKS), true);          // apoyado en el suelo
  assert.equal(w.getBlock(g.x, g.y + 1, g.z), B.PLANKS);
  assert.equal(w.place(g.x, g.y + 1, g.z, B.STONE), false);          // ocupado
  assert.equal(w.place(g.x, g.y + 2, g.z, B.PLANKS), true);          // apilar
  assert.equal(w.place(g.x, Math.min(g.y + 20, CHUNK_Y - 1), g.z, B.PLANKS), false); // flotando en el vacío
  assert.equal(w.place(g.x, g.y + 5, g.z + 1, B.PLANKS), false);
  assert.equal(w.place(g.x, g.y, g.z, B.AIR), false);                // no se "coloca" aire
  assert.equal(w.place(g.x, g.y + 3, g.z, 77), false);               // id inválido
  assert.equal(w.place(g.x, g.y + 3, g.z, B.STONE, [{ minX: (g.x + 0.2) * S, maxX: (g.x + 0.8) * S, minY: (g.y + 2.5) * S, maxY: (g.y + 4.3) * S, minZ: (g.z + 0.2) * S, maxZ: (g.z + 0.8) * S }]), false); // entidad dentro
  assert.equal(w.place(g.x, g.y + 3, g.z, B.STONE, []), true);
  // agua: se puede reemplazar si toca sólido
  let wc = null;
  for (let x = -200; x < 200 && !wc; x++) for (let z = -200; z < 200 && !wc; z += 3) if (w.getBlock(x, SEA_LEVEL, z) === B.WATER && IS(w.getBlock(x, SEA_LEVEL - 1, z))) wc = { x, z };
  assert.ok(wc);
  assert.equal(w.place(wc.x, SEA_LEVEL, wc.z, B.SAND), true);
  function IS(id) { return id !== B.AIR && id !== B.WATER; }
});

test('diff serializado (JSON) reproduce el mundo editado, también tras descargar/recargar chunks', () => {
  const w = new World(777);
  const rnd = createRng(5).next;
  let ok = 0;
  for (let i = 0; i < 600; i++) {
    const x = Math.floor(rnd() * 70) - 35, z = Math.floor(rnd() * 70) - 35;
    const y = w.surfaceY(x, z);
    if (rnd() < 0.55) { if (w.dig(x, y, z)) ok++; }
    else if (w.place(x, y + 1, z, 1 + Math.floor(rnd() * 12))) ok++;
  }
  assert.ok(ok > 300);
  const before = regionHash(w, -3, 2);
  const json = JSON.stringify(w.serialize());
  const w2 = World.deserialize(JSON.parse(json));
  assert.equal(regionHash(w2, -3, 2), before);
  // descargar todo y recargar: las ediciones persisten
  for (let cz = -3; cz <= 2; cz++) for (let cx = -3; cx <= 2; cx++) w.unloadChunk(cx, cz);
  assert.equal(regionHash(w, -3, 2), before);
  // guardar es estable (orden determinista)
  assert.equal(JSON.stringify(w2.serialize()), json);
  assert.ok(JSON.parse(json).chunks.length > 0);
  // un mundo limpio difiere
  assert.notEqual(regionHash(new World(777), -3, 2), before);
});

test('revertir una edición la quita del diff', () => {
  const w = new World(9);
  const y = w.surfaceY(3, 3), id = w.getBlock(3, y, 3);
  assert.ok(w.dig(3, y, 3));
  assert.equal(w.serialize().chunks.length, 1);
  w.setBlock(3, y, 3, id);
  assert.deepEqual(w.serialize().chunks, []);
});

test('ensureChunks: carga de cerca a lejos, respeta maxNew, descarga lejanos y conserva ediciones', () => {
  const w = new World(3);
  let r = w.ensureChunks(8 * S, 8 * S, 3, { maxNew: 5 });
  assert.equal(r.added.length, 5);
  assert.ok(r.pending > 0);
  assert.deepEqual(r.added[0], { cx: 0, cz: 0 });
  while (w.ensureChunks(8 * S, 8 * S, 3, { maxNew: 5 }).pending > 0);
  const n = [...w.chunks()].length;
  assert.ok(n >= 29 && n <= 37, `chunks ${n}`); // círculo de radio 3 ≈ 29 chunks
  w.setBlock(8, 60, 8, B.PLANKS);
  r = w.ensureChunks(16 * 20 * S, 8 * S, 3);
  assert.ok(r.removed.some((c) => c.cx === 0 && c.cz === 0));
  assert.equal(w.peekChunk(0, 0), null);
  assert.equal(w.getBlock(8, 60, 8), B.PLANKS);
});

test('dirty: editar en el borde marca también al chunk vecino', () => {
  const w = new World(3);
  w.getChunk(0, 0); w.getChunk(-1, 0); w.getChunk(1, 0); w.consumeDirty();
  assert.equal(w.chunk(0, 0).dirty, false);
  w.setBlock(0, 60, 5, B.STONE);
  assert.equal(w.chunk(0, 0).dirty, true);
  const d = w.consumeDirty().map((c) => `${c.cx},${c.cz}`).sort();
  assert.deepEqual(d, ['-1,0', '0,0']);
  assert.deepEqual(w.consumeDirty(), []);
});

test('World.solidAt / getBlock en coords de bloque (para Animador): agua no es suelo, y<0 sí, caché no se queda con chunks descargados', async () => {
  const { B } = await import('../src/world/blocks.js');
  const w = new World(1234);
  let sawWater = false, sawSolid = false;
  for (let x = -300; x < 300 && !(sawWater && sawSolid); x += 3) for (let z = -300; z < 300; z += 3) for (let y = 0; y < 40; y++) {
    const id = w.getBlock(x, y, z);
    assert.equal(w.solidAt(x, y, z), id !== B.AIR && id !== B.WATER);
    if (id === B.WATER) sawWater = true; if (id === B.STONE) sawSolid = true;
  }
  assert.ok(sawWater && sawSolid);
  assert.equal(w.solidAt(0, -1, 0), true); assert.equal(w.solidAt(0, 64, 0), false);
  // caché: tras editar y descargar, getBlock refleja el chunk nuevo
  const a = w.getBlock(1, 5, 1), e = a === B.STONE ? B.DIRT : B.STONE; w.setBlock(1, 5, 1, e);
  w.unloadChunk(0, 0); w.getChunk(5, 5); w.unloadChunk(5, 5);
  assert.equal(w.peekChunk(0, 0), null); assert.equal(w.getBlock(1, 5, 1), e, 'la edición se reaplica al regenerar; la caché no sirve el chunk descargado');
});
