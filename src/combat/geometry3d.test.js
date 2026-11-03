// Geometry3D: determinismo, independencia de la pose, huesos/cápsulas, finales sanos.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from './core/index.js';
import { JOINTS } from './kage-contracts.js';
import { createGeometry } from './geometry.js';
import { fightDigest, levelSpec, subset56 } from './digest.js';
import { KAGE_BONES, restPose } from './pose.js';

const S = subset56(m.STYLE_IDS);

test('3D: mismo seed => mismo hash de eventos/ticks/resultado en dos corridas (12 seeds)', () => {
  for (const c of S.filter((_, i) => i % 5 === 0).slice(0, 12)) {
    const a = fightDigest(m, c.a, c.b, c.level, c.seed, { geometry: '3d' });
    const b = fightDigest(m, c.a, c.b, c.level, c.seed, { geometry: '3d' });
    assert.deepEqual(a, b, `${c.a} vs ${c.b} seed ${c.seed}`);
  }
});

test('3D: la pose NO afecta a la sim (provider de esqueleto distinto => mismo resultado y eventos)', () => {
  const wild = (f, F) => ({ bones: KAGE_BONES, space: 'local', pose: Object.fromEntries(JOINTS.map((j, i) => [j, { x: Math.sin(F.t + i) * 3, y: i, z: Math.cos(F.t) }])) });
  for (const c of S.slice(0, 6)) {
    const base = fightDigest(m, c.a, c.b, c.level, c.seed, { geometry: '3d' });
    let calls = 0;
    const alt = fightDigest(m, c.a, c.b, c.level, c.seed, { geometry: { kind: '3d', skeleton: (f, F) => { calls++; return wild(f, F); } } });
    assert.equal(calls, 0, 'la sim nunca lee la pose');
    assert.equal(alt.eventsHash, base.eventsHash);
    assert.equal(alt.ticksHash, base.ticksHash);
    assert.equal(alt.fullHash, base.fullHash);
  }
});

test('3D: eventos contienen SÓLO lo mismo que 2D en forma (sin campos de pose/hueso)', () => {
  const r = m.simulateFight(levelSpec('boxer', 50), levelSpec('wrestler', 50), 3, { geometry: '3d' });
  const keys = new Set(r.events.flatMap((e) => Object.keys(e)));
  for (const k of keys) assert.ok(!/bone|pose|capsule|hurt|world/i.test(k), k);
  assert.ok(r.ticks[100].a.pos && Number.isFinite(r.ticks[100].a.heading));
});

test('3D: sanidad de finales (no todo empate, no peleas instantáneas) en 28 pares', () => {
  const kinds = {}; let minTick = Infinity;
  for (const c of S) {
    const r = m.simulateFight(levelSpec(c.a, c.level), levelSpec(c.b, c.level), c.seed, { record: false, geometry: '3d' });
    const k = r.winner == null ? 'draw' : r.method; kinds[k] = (kinds[k] || 0) + 1; minTick = Math.min(minTick, r.endTick);
    assert.ok(Number.isFinite(r.endTick));
  }
  assert.ok((kinds.draw || 0) < S.length * 0.5, JSON.stringify(kinds));
  assert.ok(Object.keys(kinds).length >= 3, JSON.stringify(kinds));
  assert.ok(minTick >= 60 * 3, 'ninguna pelea termina antes de 3 s: ' + minTick);
});

test('3D: distancia 3D, pared circular y movimiento por heading', () => {
  const g = createGeometry('3d', { cage: 260 });
  const A = { pos: { x: 0, y: 0, z: 0 }, heading: 0 }, B = { pos: { x: 3, y: 4, z: 12 }, heading: Math.PI };
  assert.equal(g.distance(A, B), 13);
  g.moveAlong(A, 100); assert.ok(Math.abs(A.pos.x - 100) < 1e-9 && Math.abs(A.pos.z) < 1e-9);
  A.heading = Math.PI / 2; A.pos = { x: 0, y: 0, z: 200 };       // mirando +z, cerca de la pared +z
  assert.ok(Math.abs(g.wallDistance(A) - 60) < 1e-9);
  assert.equal(g.backToWall(A), false);                           // la pared está DELANTE
  A.heading = -Math.PI / 2; assert.equal(g.backToWall(A), true); assert.equal(g.cornered(A, 70), true); assert.equal(g.cornered(A, 50), false);
  assert.equal(g.exceedsWall(A, -70, 0), true);                   // retroceder 70 px lo saca del ring
  g.applyKnockback(A, 100); g.clampToRing(A); assert.ok(Math.hypot(A.pos.x, A.pos.z) <= 260 + 1e-9);
});

test('3D: boneWorldPos y hurtboxes (cápsulas) desde el esqueleto por defecto, rotan con heading', () => {
  const geo = createGeometry('3d', { cage: 260 });
  const F = { t: 0, phase: 'stand', ground: null, fighters: [] };
  geo.bind(F);
  const f = { id: 'a', pos: { x: 10, y: 0, z: -20 }, heading: 0, down: 0, action: null };
  for (const j of JOINTS) { const p = geo.boneWorldPos(f, j); assert.ok(Number.isFinite(p.x + p.y + p.z), j); }
  const head0 = geo.boneWorldPos(f, 'head');
  assert.ok(head0.y > 120 && head0.y < 170, 'cabeza ~1.75 m * 85 px/m (altura en px): ' + head0.y);
  assert.ok(Math.abs(geo.boneWorldPos(f, 'pelvis').x - 10) < 1.5);
  f.heading = Math.PI / 2;                                         // girar 90°: el "adelante" del hueso pasa de +x a +z
  const hand = geo.boneWorldPos(f, 'handR'), hand0rest = restPose().handR;
  assert.ok(Math.abs((hand.z - f.pos.z) - hand0rest.x * 85) < 1.5);
  const caps = geo.hurtboxes(f);
  assert.equal(caps.length, JOINTS.length - 1);                    // 15 segmentos (todos los huesos con padre)
  const zones = new Set(caps.map((c) => c.zone));
  for (const z of ['head', 'body', 'legs', 'armL', 'armR']) assert.ok(zones.has(z), z);
  for (const c of caps) assert.ok(c.radius > 0 && Number.isFinite(c.a.x + c.b.z));
  // punto de contacto de un jab contra la cabeza del rival
  const g = { id: 'b', pos: { x: 10 + 90, y: 0, z: -20 }, heading: Math.PI, down: 0, action: null }; f.heading = 0;
  const cp = geo.contactPoint(f, g, { limb: 'handL', zone: 'head' });
  assert.ok(cp && cp.y > 100, JSON.stringify(cp));
});

test('3D: skeleton externo (nombres propios + boneMap + espacio world) con provider', () => {
  const map = { pelvis: 'Hips', spine: 'Spine', neck: 'Neck', head: 'Head' };
  const sk = { bones: [{ name: 'Hips', parent: null }, { name: 'Spine', parent: 'Hips' }, { name: 'Neck', parent: 'Spine' }, { name: 'Head', parent: 'Neck' }], space: 'local', pose: { Hips: { x: 0, y: 1, z: 0 }, Spine: { x: 0, y: 1.3, z: 0 }, Neck: { x: 0, y: 1.5, z: 0 }, Head: { x: 0.1, y: 1.65, z: 0 } } };
  const geo = createGeometry({ kind: '3d', boneMap: map, skeleton: () => sk }, { cage: 260 });
  geo.bind({ t: 0 });
  const f = { id: 'a', pos: { x: 0, y: 0, z: 0 }, heading: 0 };
  assert.ok(Math.abs(geo.boneWorldPos(f, 'head').y - 1.65 * 85) < 1e-9);
  const caps = geo.hurtboxes(f);
  assert.deepEqual(caps.map((c) => c.zone), ['body', 'body', 'head']);
});

test('Geometry2D: boneWorldPos con z = 0 y sin cápsulas', () => {
  const geo = createGeometry('2d', { cage: 260 });
  const f = { x: 100, facing: -1 };
  const p = geo.boneWorldPos(f, 'handR'); assert.equal(p.z, 0); assert.equal(p.x, 100 - 30);
  assert.deepEqual(geo.hurtboxes(f), []);
});
