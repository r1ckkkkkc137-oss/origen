// Geometry3D: determinismo, independencia de la pose, huesos/cápsulas, finales sanos.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from './core/index.js';
import { JOINTS } from './kage-contracts.js';
import { createGeometry } from './geometry.js';
import { fightDigest, levelSpec, subset56 } from './digest.js';
import { HUMAN_BONES } from '../shared/contracts.js';
import { HUMAN_PARENT, KAGE_TO_HUMAN, KAGE_UNMAPPED, HUMAN_ONLY, restPose } from './pose.js';
import { BLOCK_M, yawFromHeading } from './geometry3d.js';
import * as THREE from 'three';

const PXB = 85 * BLOCK_M; // px de sim por bloque

const S = subset56(m.STYLE_IDS);

test('3D: mismo seed => mismo hash de eventos/ticks/resultado en dos corridas (12 seeds)', () => {
  for (const c of S.filter((_, i) => i % 5 === 0).slice(0, 12)) {
    const a = fightDigest(m, c.a, c.b, c.level, c.seed, { geometry: '3d' });
    const b = fightDigest(m, c.a, c.b, c.level, c.seed, { geometry: '3d' });
    assert.deepEqual(a, b, `${c.a} vs ${c.b} seed ${c.seed}`);
  }
});

test('3D: la pose NO afecta a la sim (provider de esqueleto distinto => mismo resultado y eventos)', () => {
  const wild = (f, F) => ({ bones: HUMAN_BONES, parent: HUMAN_PARENT, space: 'local', pose: Object.fromEntries(HUMAN_BONES.map((j, i) => [j, [Math.sin(F.t + i) * 3, i, Math.cos(F.t)]])) });
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
  assert.ok(Array.isArray(r.ticks[100].a.pos) && r.ticks[100].a.pos.length === 3 && Number.isFinite(r.ticks[100].a.yaw));
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

test('3D: boneWorldPos/hurtboxes en bloques ([x,y,z]) sobre HUMAN_BONES (17), rotan con yaw', () => {
  const geo = createGeometry('3d', { cage: 260 });
  const F = { t: 0, phase: 'stand', ground: null, fighters: [] };
  geo.bind(F);
  const f = { id: 'a', pos: { x: 10 * PXB, y: 0, z: -20 * PXB }, heading: 0, down: 0, action: null };   // (10, 0, -20) bloques
  for (const b of HUMAN_BONES) { const p = geo.boneWorldPos(f, b); assert.ok(Array.isArray(p) && p.length === 3 && p.every(Number.isFinite), b); }
  const head0 = geo.boneWorldPos(f, 'head');
  assert.ok(head0[1] > 3 && head0[1] < 4, 'cabeza ~1.75 m / 0.5 = ~3.5 bloques: ' + head0[1]);
  assert.ok(Math.abs(geo.boneWorldPos(f, 'pelvis')[0] - 10) < 0.05);
  f.heading = Math.PI / 2;                                         // girar 90°: el "adelante" del hueso pasa de +x a +z (heading interno)
  const hand = geo.boneWorldPos(f, 'handR'), hand0rest = restPose().handR;
  assert.ok(Math.abs((hand[2] - (-20)) - hand0rest.x / BLOCK_M) < 0.03);
  const caps = geo.hurtboxes(f);
  assert.equal(caps.length, HUMAN_BONES.length - 1);               // 16 segmentos: todo hueso con padre (pelvis es la raíz)
  const zones = new Set(caps.map((c) => c.zone));
  for (const z of ['head', 'body', 'legs', 'armL', 'armR']) assert.ok(zones.has(z), z);
  for (const c of caps) assert.ok(c.radius > 0 && c.radius < 0.5 && c.a.every(Number.isFinite) && c.b.every(Number.isFinite));
  // punto de contacto de un jab contra la cabeza del rival
  f.heading = 0;
  const g = { id: 'b', pos: { x: f.pos.x + 90, y: 0, z: f.pos.z }, heading: Math.PI, down: 0, action: null };
  const cp = geo.contactPoint(f, g, { limb: 'handL', zone: 'head' });
  assert.ok(Array.isArray(cp) && cp[1] > 2, JSON.stringify(cp));
});

test('3D: mapeo KAGE joints -> HUMAN_BONES: los 16 coinciden; sólo chest es derivado', () => {
  assert.equal(HUMAN_BONES.length, 17);
  assert.deepEqual(KAGE_UNMAPPED, []);
  assert.deepEqual(HUMAN_ONLY, ['chest']);
  for (const j of JOINTS) assert.ok(HUMAN_BONES.includes(KAGE_TO_HUMAN[j]), j);
  assert.deepEqual(Object.keys(HUMAN_PARENT).sort(), [...HUMAN_BONES].sort());
});

test('3D: yaw = convención Three (rotation.y): +x local -> (cos yaw, 0, -sin yaw)', () => {
  const geo = createGeometry('3d', { cage: 260 });
  geo.bind({ t: 0, phase: 'stand', ground: null });
  for (const h of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
    const f = { id: 'a', pos: { x: 0, y: 0, z: 0 }, heading: h, down: 0, action: null };
    const yaw = yawFromHeading(h);
    const fwdThree = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const p = geo.boneWorldPos(f, 'pelvis'), hd = geo.boneWorldPos(f, 'head');   // cabeza adelantada 10 cm respecto de la pelvis
    const dx = hd[0] - p[0], dz = hd[2] - p[2], l = Math.hypot(dx, dz);
    assert.ok(Math.abs(dx / l - fwdThree.x) < 1e-9 && Math.abs(dz / l - fwdThree.z) < 1e-9, `h=${h}`);
    // moveAlong también avanza hacia fwdThree
    geo.moveAlong(f, 10); assert.ok(Math.abs(f.pos.x / 10 - fwdThree.x) < 1e-9 && Math.abs(f.pos.z / 10 - fwdThree.z) < 1e-9);
  }
});

test('3D: Skeleton3D del contrato (mundo, arrays) de un provider se re-ancla a la raíz de la sim', () => {
  // esqueleto de Animador: raíz propia en (100, 0, 100) con yaw 1; la sim dice (2, 0, 3) bloques con otro heading
  const sk = { bones: ['pelvis', 'head'], parent: { pelvis: null, head: 'pelvis' }, root: { pos: [100, 0, 100], yaw: 1 },
    pose: { pelvis: [100, 1.1, 100], head: [100 + Math.cos(1) * 0.2, 3.3, 100 - Math.sin(1) * 0.2] } };   // cabeza 0.2 bloques adelante (yaw 1)
  const geo = createGeometry({ kind: '3d', skeleton: () => sk }, { cage: 260 });
  geo.bind({ t: 0 });
  const f = { id: 'a', pos: { x: 2 * PXB, y: 0, z: 3 * PXB }, heading: 0.5, down: 0, action: null };    // yaw sim = -0.5
  const p = geo.boneWorldPos(f, 'pelvis'), h = geo.boneWorldPos(f, 'head');
  assert.ok(Math.abs(p[0] - 2) < 1e-9 && Math.abs(p[2] - 3) < 1e-9 && Math.abs(p[1] - 1.1) < 1e-9, 'pelvis sobre la raíz de la sim');
  const yaw = -0.5;
  assert.ok(Math.abs(h[0] - (2 + Math.cos(yaw) * 0.2)) < 1e-9 && Math.abs(h[2] - (3 - Math.sin(yaw) * 0.2)) < 1e-9 && Math.abs(h[1] - 3.3) < 1e-9);
  assert.deepEqual(geo.skeletonOf(f).root, { pos: [2, 0, 3], yaw });
});

test('3D: skeleton externo (nombres propios + boneMap + space local en metros)', () => {
  const map = { pelvis: 'Hips', spine: 'Spine', neck: 'Neck', head: 'Head' };
  const sk = { bones: ['Hips', 'Spine', 'Neck', 'Head'], parent: { Hips: null, Spine: 'Hips', Neck: 'Spine', Head: 'Neck' }, space: 'local', pose: { Hips: [0, 1, 0], Spine: [0, 1.3, 0], Neck: [0, 1.5, 0], Head: [0.1, 1.65, 0] } };
  const geo = createGeometry({ kind: '3d', boneMap: map, skeleton: () => sk }, { cage: 260 });
  geo.bind({ t: 0 });
  const f = { id: 'a', pos: { x: 0, y: 0, z: 0 }, heading: 0 };
  assert.ok(Math.abs(geo.boneWorldPos(f, 'head')[1] - 1.65 / BLOCK_M) < 1e-9);
  assert.deepEqual(geo.hurtboxes(f).map((c) => c.zone), ['body', 'body', 'head']);
});

test('Geometry2D: boneWorldPos [x,y,0] en px y sin cápsulas', () => {
  const geo = createGeometry('2d', { cage: 260 });
  const f = { x: 100, facing: -1 };
  const p = geo.boneWorldPos(f, 'handR'); assert.equal(p[2], 0); assert.equal(p[0], 100 - 30);
  assert.equal(geo.units, 'px');
  assert.deepEqual(geo.hurtboxes(f), []);
});
