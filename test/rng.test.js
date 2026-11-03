import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hash3 } from '../src/shared/rng.js';
test('misma seed => misma secuencia', () => {
  const a = createRng(42), b = createRng(42);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
});
test('seeds distintas divergen y rango [0,1)', () => {
  const a = createRng(1), b = createRng(2); let diff = 0;
  for (let i = 0; i < 100; i++) { const x = a.next(); assert.ok(x >= 0 && x < 1); if (x !== b.next()) diff++; }
  assert.ok(diff > 90);
});
test('seed string y fork deterministas', () => {
  assert.equal(createRng('origen').next(), createRng('origen').next());
  assert.equal(createRng(7).fork('mundo').next(), createRng(7).fork('mundo').next());
});
test('int inclusivo y hash3 estable', () => {
  const r = createRng(9); for (let i = 0; i < 500; i++) { const v = r.int(1, 3); assert.ok(v >= 1 && v <= 3); }
  assert.equal(hash3(5, 1, 2, 3), hash3(5, 1, 2, 3));
});
