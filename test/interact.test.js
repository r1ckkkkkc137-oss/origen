import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createPlayerBody, B, IS_LOG } from '../src/world/index.js';
import { createInteraction, DIG_SPEED } from '../src/engine/interact.js';
import { BLOCK_M } from '../src/shared/contracts.js';

function setup() {
  const w = createWorld(7);
  w.ensureChunks(0, 0, 2);
  const bx = 3, bz = 3, top = w.surfaceY(bx, bz);
  const p = createPlayerBody({ x: (bx + 0.5) * BLOCK_M, y: (top + 1) * BLOCK_M, z: (bz + 0.5) * BLOCK_M });
  return { w, p, bx, bz, top };
}
const down = [0, -1, 0.0001];

test('cavar mantiene hasta la dureza y acredita el drop', () => {
  const { w, p, bx, bz, top } = setup();
  const ia = createInteraction(w, p, { inventory: [] });
  const eye = [p.x, p.y + 1.6, p.z], id = w.getBlock(bx, top, bz);
  let ev = ia.update(0.05, eye, down, { dig: true });
  assert.equal(ev.length, 0); assert.deepEqual(ia.aim.pos, [bx, top, bz]);
  for (let t = 0; t < 10 && !ev.length; t += 0.05) ev = ia.update(0.05, eye, down, { dig: true });
  assert.equal(ev[0].type, 'dig'); assert.equal(w.getBlock(bx, top, bz), B.AIR); assert.ok(id !== B.AIR);
  assert.ok([...ia.inv.values()].reduce((a, b) => a + b, 0) >= 1);
});

test('soltar el botón reinicia el progreso', () => {
  const { w, p, bx, bz, top } = setup();
  const ia = createInteraction(w, p);
  const eye = [p.x, p.y + 1.6, p.z];
  ia.update(0.1, eye, down, { dig: true }); ia.update(0.1, eye, down, { dig: false });
  assert.equal(ia.dig, null); assert.notEqual(w.getBlock(bx, top, bz), B.AIR);
});

test('poner gasta inventario y no mete el bloque dentro del jugador', () => {
  const { w, p, bx, bz, top } = setup();
  const ia = createInteraction(w, p, { inventory: [[B.STONE, 2]] });
  // apuntar al suelo justo bajo los pies: la celda de colocación es la del jugador -> rechazado
  ia.update(0.05, [p.x, p.y + 1.6, p.z], down, { place: true });
  assert.equal(ia.inv.get(B.STONE), 2);
  // apuntar a una celda a 2 bloques: se coloca
  const tx = bx + 3, tt = w.surfaceY(tx, bz);
  const eye = [(tx + 0.5) * BLOCK_M, (tt + 3) * BLOCK_M, (bz + 0.5) * BLOCK_M];
  const ev = ia.update(0.05, eye, down, { place: true });
  assert.equal(ev[0]?.type, 'place'); assert.equal(w.getBlock(tx, tt + 1, bz), B.STONE); assert.equal(ia.inv.get(B.STONE), 1);
});

test('talar un tronco tumba el árbol como entidad y los items se recogen', () => {
  const w = createWorld(7);
  w.ensureChunks(0, 0, 4);
  let log = null;
  for (let x = -60; x < 60 && !log; x++) for (let z = -60; z < 60 && !log; z++) {
    const top = w.surfaceY(x, z);
    for (let yy = top; yy > 1; yy--) if (IS_LOG[w.getBlock(x, yy, z)] && !IS_LOG[w.getBlock(x, yy - 1, z)] && !w.getBlock(x - 1, yy, z) && !w.getBlock(x - 2, yy, z)) { log = [x, yy, z]; break; }
  }
  assert.ok(log, 'hay un árbol cerca del origen');
  const [x, y, z] = log;
  const p = createPlayerBody({ x: (x - 2.5) * BLOCK_M, y: y * BLOCK_M, z: (z + 0.5) * BLOCK_M });
  const ia = createInteraction(w, p, { inventory: [] });
  const eye = [(x - 1.5) * BLOCK_M, (y + 0.5) * BLOCK_M, (z + 0.5) * BLOCK_M];
  let ev = [];
  for (let i = 0; i < 200 && !ev.length; i++) ev = ia.update(1 / 60, eye, [1, 0, 0], { dig: true });
  assert.equal(ev[0]?.type, 'fell'); assert.ok(ev[0].logs >= 2);
  assert.equal(w.fallingTrees.length, 1);
  for (let i = 0; i < 600; i++) w.updateEntities(1 / 60);
  assert.ok(w.itemDrops.length > 0, 'el árbol soltó items');
  const d = w.itemDrops[0];
  p.x = d.x ?? d.pos?.[0] ?? p.x; p.y = (d.y ?? d.pos?.[1] ?? p.y) - 0.4; p.z = d.z ?? d.pos?.[2] ?? p.z;
  ia.update(1 / 60, eye, [1, 0, 0], {});
  assert.ok([...ia.inv.values()].some((n) => n > 0), 'recogió algo');
});
