// Semilla de mundo: misma partida + mismo lugar => misma pelea; distinto lugar/mundo/id => distinta; el camino crudo sigue siendo KAGE.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from './index.js';
import * as core from './core/index.js';
import { hash3 } from '../shared/rng.js';
import { fightDigest, levelSpec } from './digest.js';
import { BLOCK_M } from '../shared/contracts.js';

const W = 424242;

test('fightSeed: u32, estable, y sale de hash3', () => {
  const s = api.fightSeed(W, 10, 64, -7);
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
  assert.equal(api.fightSeed(W, 10, 64, -7), s);
  assert.equal(api.fightSeed(W, 10.9, 64.2, -6.1), api.fightSeed(W, 10, 64, -7), 'Math.floor por coordenada: mismo bloque => misma seed');
  assert.notEqual(api.fightSeed(W, -1, 0, 0), api.fightSeed(W, 0, 0, 0), 'floor distingue negativos');
  // hash3 con la sal de peleas: u32 = round(hash3(...) * 2^32)
  assert.equal(s, Math.round(hash3((W ^ 0x46494754) | 0, 10, 64, -7) * 4294967296) >>> 0);
});

test('fightSeed: lugar, mundo, salt y encounterId cambian la seed; sin colisiones en 2000 lugares', () => {
  const base = api.fightSeed(W, 5, 60, 5);
  for (const other of [api.fightSeed(W, 6, 60, 5), api.fightSeed(W, 5, 61, 5), api.fightSeed(W, 5, 60, 6), api.fightSeed(W + 1, 5, 60, 5), api.fightSeed(W, 5, 60, 5, 1), api.fightSeed(W, 'arena-1')])
    assert.notEqual(other, base);
  assert.equal(api.fightSeed(W, 'arena-1'), api.fightSeed(W, 'arena-1'));
  assert.notEqual(api.fightSeed(W, 'arena-1'), api.fightSeed(W, 'arena-2'));
  assert.notEqual(api.fightSeed(W, 'arena-1'), api.fightSeed(W, 'arena-1', 1));
  assert.equal(api.fightSeed('mundo-texto', 1, 2, 3), api.fightSeed('mundo-texto', 1, 2, 3));
  const set = new Set();
  for (let i = 0; i < 2000; i++) set.add(api.fightSeed(W, i * 7 - 500, 60, (i * 13) % 977));
  assert.ok(set.size >= 1998, 'colisiones: ' + (2000 - set.size));
});

for (const geometry of [undefined, '3d']) {
  test(`mismo worldSeed + lugar => digest idéntico; otro lugar => otra pelea (geometry=${geometry ?? '2d'})`, () => {
    const at = (x, y, z, extra = {}) => fightDigest(api, 'boxer', 'muayThai', 50, { worldSeed: W, x, y, z, ...extra }, geometry ? { geometry } : {});
    const a = at(12, 64, -30), b = at(12, 64, -30);
    assert.deepEqual(a, b);
    const c = at(13, 64, -30), d = at(12, 64, -30, { salt: 1 });
    assert.notEqual(c.eventsHash, a.eventsHash);
    assert.notEqual(d.eventsHash, a.eventsHash);
    const other = fightDigest(api, 'boxer', 'muayThai', 50, { worldSeed: W + 1, x: 12, y: 64, z: -30 }, geometry ? { geometry } : {});
    assert.notEqual(other.eventsHash, a.eventsHash);
    const e1 = fightDigest(api, 'boxer', 'muayThai', 50, { worldSeed: W, encounterId: 'torneo-1' }, geometry ? { geometry } : {});
    assert.deepEqual(e1, fightDigest(api, 'boxer', 'muayThai', 50, { worldSeed: W, encounterId: 'torneo-1' }, geometry ? { geometry } : {}));
  });
}

test('la seed derivada llega al núcleo: pelea con { worldSeed, x,y,z } == pelea con el número fightSeed(...)', () => {
  const s = api.fightSeed(W, 3, 60, 9);
  const { fullHash: h1, ...d1 } = fightDigest(api, 'wrestler', 'boxer', 50, { worldSeed: W, x: 3, y: 60, z: 9 });   // fullHash incluye las etiquetas worldSeed/location
  const { fullHash: h2, ...d2 } = fightDigest(core, 'wrestler', 'boxer', 50, s);
  assert.deepEqual(d1, d2); assert.notEqual(h1, h2);
  const r = api.simulateFight(levelSpec('boxer', 50), levelSpec('judo', 50), { worldSeed: W, x: 3, y: 60, z: 9 }, { record: false });
  assert.equal(r.seed, api.fightSeed(W, 3, 60, 9)); assert.equal(r.worldSeed, W); assert.deepEqual(r.location, [3, 60, 9]);
});

test('camino crudo: seed numérico por la API envuelta == núcleo KAGE (bit a bit)', () => {
  for (const seed of [1, 1000, 77777]) assert.deepEqual(fightDigest(api, 'boxer', 'muayThai', 50, seed), fightDigest(core, 'boxer', 'muayThai', 50, seed));
  const f = api.createFight(levelSpec('boxer', 50), levelSpec('boxer', 50), 5); assert.equal(f.worldSeed, undefined); assert.equal(f.seed, 5);
});

test('3D con lugar: el ring queda en el mundo (origin = x,y,z bloques); la sim no cambia respecto de origin 0', () => {
  const run = (geometry, seed) => api.simulateFight(levelSpec('boxer', 50), levelSpec('muayThai', 50), seed, { geometry });
  const loc = { worldSeed: W, x: 200, y: 64, z: -80 };
  const at = run('3d', loc);
  const t0 = at.ticks[100].a.pos;
  assert.ok(Math.abs(t0[0] - 200 * BLOCK_M) < 4 && Math.abs(t0[1] - 64 * BLOCK_M) < 1e-6 && Math.abs(t0[2] + 80 * BLOCK_M) < 4, JSON.stringify(t0));
  // misma seed numérica sin origin: mismos eventos (el origen sólo se suma a la salida)
  const plain = run('3d', api.fightSeed(W, 200, 64, -80));
  assert.deepEqual(at.events, plain.events);
  assert.equal(at.endTick, plain.endTick);
  // un origin ya explícito se respeta
  const mine = api.simulateFight(levelSpec('boxer', 50), levelSpec('boxer', 50), loc, { geometry: { kind: '3d', origin: [0, 0, 0] } });
  assert.ok(Math.abs(mine.ticks[10].a.pos[0]) < 8);
});

test('seed inválida: objeto sin worldSeed o sin lugar => error', () => {
  assert.throws(() => api.createFight(levelSpec('boxer', 50), levelSpec('boxer', 50), { x: 1, y: 2, z: 3 }));
  assert.throws(() => api.createFight(levelSpec('boxer', 50), levelSpec('boxer', 50), { worldSeed: 1, x: 1 }));
});
