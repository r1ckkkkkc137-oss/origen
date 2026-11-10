import test from 'node:test';
import assert from 'node:assert/strict';
import { REACH_TABLE_3D, MIN_GAP_3D_M } from './data/reach3d.js';
import { MOVES, PX_PER_M } from './data/moves.js';
import { createGeometry } from './geometry.js';

const m = (id, k) => REACH_TABLE_3D[id][k] / PX_PER_M;
test('reach3d: hook/uppercut cortos sobre el gap de 0,80 m, jab/cross cerca de 0,95 m', () => {
  for (const id of ['hook', 'bodyHook', 'uppercut', 'standElbow']) { assert.ok(m(id, 'rangeMin') >= MIN_GAP_3D_M - 0.01 && m(id, 'rangeMax') <= 0.95, id); }
  for (const id of ['jab', 'cross']) { const i = m(id, 'rangeIdeal'); assert.ok(i >= 0.93 && i <= 0.99, id); }
  assert.equal(createGeometry('3d', { cage: 260 }).minGapPx, MIN_GAP_3D_M * PX_PER_M);
});
test('reach3d: sólo 3D; 2D conserva las ventanas de KAGE', () => {
  assert.equal(createGeometry('3d', { cage: 260 }).reachTable, REACH_TABLE_3D);
  assert.equal(createGeometry('2d', { cage: 260 }).reachTable ?? null, null);
  assert.ok(MOVES.hook.rangeIdeal / PX_PER_M > 1); // KAGE 2D intacto
});
