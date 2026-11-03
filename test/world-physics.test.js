import test from 'node:test';
import assert from 'node:assert/strict';
import { createBody, moveAndCollide, raycastBlocks, raycastMeters, collides, DEFAULTS } from '../src/world/physics.js';
import { World } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { CHUNK_Y, SEA_LEVEL } from '../src/world/chunk.js';
import { BLOCK_SIZE_M as S } from '../src/world/units.js';
import { FakeWorld } from './helpers/support.js';

const floor = (h) => new FakeWorld((x, y) => (y <= h ? B.STONE : B.AIR)); // piedra en y<=h

test('physics: caer y aterrizar sobre el suelo (onGround, vy=0, y == tope del bloque)', () => {
  const w = floor(9), b = createBody(0.5 * S, 15 * S, 0.5 * S);
  for (let i = 0; i < 240; i++) moveAndCollide(w, b, 1 / 60);
  assert.equal(b.onGround, true); assert.equal(b.vy, 0);
  assert.ok(Math.abs(b.y - 10 * S) < 1e-3, `y=${b.y}`);
});

test('physics: la gravedad por defecto es -9.81 m/s² y la velocidad terminal se respeta', () => {
  assert.equal(DEFAULTS.gravity, -9.81);
  const w = new FakeWorld(() => B.AIR), b = createBody(0, 5000, 0);
  moveAndCollide(w, b, 1);
  assert.ok(Math.abs(b.vy - -9.81) < 1e-9);
  for (let i = 0; i < 100; i++) moveAndCollide(w, b, 0.1);
  assert.equal(b.vy, DEFAULTS.terminalVelocity);
});

test('physics: pared frena el movimiento horizontal; deslizar por el otro eje', () => {
  const w = new FakeWorld((x, y, z) => (y <= 9 ? B.STONE : x >= 5 && y <= 12 ? B.STONE : B.AIR));
  const b = createBody(2.5 * S, 10 * S, 2.5 * S); b.vx = 5 * S; b.vz = 2 * S;
  for (let i = 0; i < 120; i++) { b.vx = 5 * S; b.vz = 2 * S; moveAndCollide(w, b, 1 / 60); }
  assert.ok(b.x + b.halfW <= 5 * S + 1e-6, `x=${b.x}`);
  assert.ok(b.x + b.halfW > 5 * S - 0.05 * S);
  assert.ok(b.z > 2.5 * S + 2 * S * 1.5, 'debería deslizar en z');
});

test('physics: stepHeight sube un escalón de 1 bloque, sin él se queda atascado; 2 bloques no se suben', () => {
  const mk = (h) => new FakeWorld((x, y) => (y <= 9 ? B.STONE : x >= 5 && y <= 9 + h ? B.STONE : B.AIR));
  const run = (w, step) => { const b = createBody(2.5 * S, 10 * S, 2.5 * S); for (let i = 0; i < 180; i++) { b.vx = 3 * S; moveAndCollide(w, b, 1 / 60, { stepHeight: step * S }); } return b; };
  assert.ok(run(mk(1), 1).x > 7 * S && run(mk(1), 1).y >= 11 * S - 1e-3);
  assert.ok(run(mk(1), 0).x < 5 * S);
  assert.ok(run(mk(2), 1).x < 5 * S);
});

test('physics: sin tunneling a alta velocidad (dt grande) ni en caída libre', () => {
  const w = floor(9);
  for (const dt of [1 / 60, 0.1, 0.5, 2]) {
    const b = createBody(0.5 * S, 200, 0.5 * S);
    for (let i = 0; i < 400; i++) moveAndCollide(w, b, dt);
    assert.ok(b.y >= 10 * S - 1e-6, `dt=${dt} y=${b.y}`);
  }
  const wall = new FakeWorld((x, y) => (y <= 9 || x === 3 ? B.STONE : B.AIR));
  const b = createBody(0.5 * S, 10 * S, 0.5 * S); b.vx = 400;
  for (let i = 0; i < 5; i++) { b.vx = 400; moveAndCollide(wall, b, 0.5); }
  assert.ok(b.x < 3 * S);
});

test('physics: agua frena la caída y marca inWater; el suelo del mundo (y<0) es sólido', () => {
  const w = new FakeWorld((x, y) => (y <= 3 ? B.STONE : y <= 20 ? B.WATER : B.AIR));
  const b = createBody(0.5 * S, 18 * S, 0.5 * S); b.vy = -10;
  for (let i = 0; i < 20; i++) moveAndCollide(w, b, 1 / 60);
  assert.equal(b.inWater, true); assert.ok(b.vy > -10 * 0.9);
  const hole = new FakeWorld(() => B.AIR), c = createBody(0.5 * S, 5 * S, 0.5 * S);
  for (let i = 0; i < 300; i++) moveAndCollide(hole, c, 1 / 60);
  assert.ok(c.y >= 0 && c.y < 1e-3); assert.equal(c.onGround, true);
});

test('physics: collides detecta sólidos solapados', () => {
  const w = floor(9);
  assert.equal(collides(w, createBody(0.5 * S, 9.5 * S, 0.5 * S)), true);
  assert.equal(collides(w, createBody(0.5 * S, 10 * S, 0.5 * S)), false);
});

test('raycast (bloques, contrato): golpea el bloque, normal hacia el rayo, place = celda previa, dist en bloques', () => {
  const w = new FakeWorld((x, y, z) => (x === 5 && y === 3 && z === 3 ? B.STONE : B.AIR));
  const h = raycastBlocks(w, [0.5, 3.5, 3.5], [1, 0, 0], 10);
  assert.deepEqual(h.pos, [5, 3, 3]); assert.deepEqual(h.normal, [-1, 0, 0]); assert.deepEqual(h.place, [4, 3, 3]);
  assert.equal(h.block, B.STONE); assert.ok(Math.abs(h.dist - 4.5) < 1e-9);
  assert.equal(raycastBlocks(w, [0.5, 3.5, 3.5], [1, 0, 0], 4.49), null);                       // maxDist
  assert.ok(raycastBlocks(w, [0.5, 3.5, 3.5], [1, 0, 0], 4.51));
  const h2 = raycastBlocks(w, { x: 9.5, y: 3.5, z: 3.5 }, { x: -3, y: 0, z: 0 }, 10);          // objetos y dir sin normalizar, dirección negativa
  assert.deepEqual(h2.pos, [5, 3, 3]); assert.deepEqual(h2.normal, [1, 0, 0]);
  assert.equal(raycastBlocks(w, [0, 0, 0], [0, 0, 0], 5), null);
});

test('raycast (metros): mismo bloque que en bloques, origen/maxDist/dist convertidos con BLOCK_SIZE_M', () => {
  const w = new FakeWorld((x, y, z) => (x === 5 && y === 3 && z === 3 ? B.STONE : B.AIR));
  const o = [0.5 * S, 3.5 * S, 3.5 * S];
  const h = raycastMeters(w, o, [1, 0, 0], 10 * S);
  assert.deepEqual(h.pos, [5, 3, 3]); assert.deepEqual(h.place, [4, 3, 3]);
  assert.ok(Math.abs(h.dist - 4.5 * S) < 1e-9);
  assert.equal(raycastMeters(w, o, [1, 0, 0], 4.49 * S), null);
  assert.ok(raycastMeters(w, o, [1, 0, 0], 4.51 * S));
  const world = new World(1234);
  const hb = world.raycast([0.5, 60, 0.5], [0, -1, 0], 100), hm = world.raycastM([0.5 * S, 60 * S, 0.5 * S], [0, -1, 0], 100 * S);
  assert.deepEqual(hb.pos, hm.pos); assert.ok(Math.abs(hb.dist * S - hm.dist) < 1e-9);
});

test('raycast: atraviesa agua salvo hitLiquid; origen dentro de un bloque devuelve ese bloque con dist 0', () => {
  const w = new FakeWorld((x, y, z) => (x === 2 ? B.WATER : x === 4 ? B.DIRT : B.AIR));
  assert.deepEqual(raycastBlocks(w, [0.5, 0.5, 0.5], [1, 0, 0], 10).pos, [4, 0, 0]);
  const hw = raycastBlocks(w, [0.5, 0.5, 0.5], [1, 0, 0], 10, { hitLiquid: true });
  assert.equal(hw.block, B.WATER); assert.deepEqual(hw.pos, [2, 0, 0]);
  const inside = raycastBlocks(w, [4.5, 0.5, 0.5], [1, 0, 0], 3);
  assert.equal(inside.dist, 0); assert.deepEqual(inside.normal, [0, 0, 0]);
});

test('raycast: DDA coincide con muestreo fino en un mundo real (1000 rayos)', () => {
  const w = new World(1234);
  let seed = 12345; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let hits = 0;
  for (let i = 0; i < 1000; i++) {
    const o = [(rnd() - 0.5) * 40, 25 + rnd() * 30, (rnd() - 0.5) * 40], d = [rnd() - 0.5, (rnd() - 0.75), rnd() - 0.5];
    const len = Math.hypot(...d), maxD = 30;
    const r = raycastBlocks(w, o, d, maxD);
    // muestreo: primer punto t donde el bloque es sólido no líquido
    let ref = null;
    for (let t = 0; t <= maxD; t += 0.002) {
      const p = [o[0] + d[0] / len * t, o[1] + d[1] / len * t, o[2] + d[2] / len * t].map(Math.floor);
      const id = p[1] < 0 || p[1] >= CHUNK_Y ? 0 : w.getBlock(...p);
      if (id !== B.AIR && id !== B.WATER) { ref = { p, t }; break; }
    }
    if (!ref) { assert.equal(r, null, `rayo ${i}: DDA golpeó pero el muestreo no`); continue; }
    assert.ok(r, `rayo ${i}: muestreo golpeó y DDA no`);
    hits++;
    if (r.pos.join() !== ref.p.join()) assert.ok(Math.abs(r.dist - ref.t) < 0.01, `rayo ${i}: ${r.pos} vs ${ref.p}`); // rozando una arista: tolera el paso del muestreo
    assert.ok(Math.abs(r.dist - ref.t) < 0.0021 + 1e-9 || r.pos.join() !== ref.p.join());
  }
  assert.ok(hits > 300, `hits=${hits}`);
});

test('raycast: desde fuera por arriba/abajo del mundo no se cuelga y entra al mundo', () => {
  const w = new World(5);
  const h = raycastBlocks(w, [0.5, CHUNK_Y + 30, 0.5], [0, -1, 0], 200);
  assert.ok(h && h.normal[1] === 1);
  assert.equal(raycastBlocks(w, [0.5, CHUNK_Y + 5, 0.5], [0, 1, 0], 200), null);
  assert.equal(raycastBlocks(w, [0.5, -5, 0.5], [0, -1, 0], 200), null);
  assert.ok(SEA_LEVEL < CHUNK_Y);
});
