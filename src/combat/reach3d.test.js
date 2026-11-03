import test from 'node:test';
import assert from 'node:assert/strict';
import { REACH_TABLE_3D } from './data/reach3d.js';
import { MOVES, PX_PER_M } from './data/moves.js';
import { createGeometry } from './geometry.js';

const m = (id, k) => REACH_TABLE_3D[id][k] / PX_PER_M;
test('reach3d: hook/uppercut cortos (0,6–0,8 m), jab/cross a media distancia', () => {
  for (const id of ['hook', 'bodyHook', 'uppercut']) { assert.ok(m(id, 'rangeMin') >= 0.58 && m(id, 'rangeMax') <= 0.8, id); }
  for (const id of ['jab', 'cross']) { assert.ok(m(id, 'rangeMin') >= 0.95 && m(id, 'rangeMax') <= 1.2, id); }
});
test('reach3d: sólo 3D; 2D conserva las ventanas de KAGE', () => {
  assert.equal(createGeometry('3d', { cage: 260 }).reachTable, REACH_TABLE_3D);
  assert.equal(createGeometry('2d', { cage: 260 }).reachTable ?? null, null);
  assert.ok(MOVES.hook.rangeIdeal / PX_PER_M > 1); // KAGE 2D intacto
});
