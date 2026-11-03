import test from 'node:test';
import assert from 'node:assert/strict';
import { hash3, hashSeed, createRng } from '../src/shared/rng.js';
import { normalizeSeed } from '../src/world/seed.js';
import { createNoise } from '../src/world/noise.js';

test('hash3 del contrato: determinista, sensible a cada coordenada y a la seed, distribución ~uniforme', () => {
  assert.equal(hash3(1, 5, 0, -7), hash3(1, 5, 0, -7));
  assert.notEqual(hash3(1, 5, 0, -7), hash3(2, 5, 0, -7));
  assert.notEqual(hash3(1, 5, 0, -7), hash3(1, 6, 0, -7));
  assert.notEqual(hash3(1, 5, 0, -7), hash3(1, 5, 1, -7));
  assert.notEqual(hash3(1, 5, 0, -7), hash3(1, 5, 0, -6));
  assert.notEqual(hash3(1, 1, 2, 3), hash3(1, 1, 3, 2));
  let sum = 0, min = 1, max = 0; const N = 20000; const bins = new Array(10).fill(0);
  for (let i = 0; i < N; i++) { const v = hash3(99, i % 141 - 70, 3, (i / 141 | 0) - 70); sum += v; min = Math.min(min, v); max = Math.max(max, v); bins[Math.floor(v * 10)]++; }
  assert.ok(min >= 0 && max < 1);
  assert.ok(Math.abs(sum / N - 0.5) < 0.01, `media ${sum / N}`);
  for (const c of bins) assert.ok(c > N / 10 * 0.9 && c < N / 10 * 1.1, `bins ${bins}`);
});

test('normalizeSeed: número tal cual (uint32), string por hashSeed (igual que createRng)', () => {
  assert.equal(normalizeSeed(5), 5);
  assert.equal(normalizeSeed(-1), 4294967295);
  assert.equal(normalizeSeed('abc'), hashSeed('abc'));
  assert.equal(createRng(normalizeSeed('abc')).next(), createRng('abc').next());
});

test('noise 2D/3D/fbm: determinista, acotado, distinto por seed, continuo', () => {
  const a = createNoise(42), b = createNoise(42), c = createNoise(43);
  let diff = 0, min = 9, max = -9, maxStep = 0, prev = a.noise2(0, 0);
  for (let i = 0; i < 4000; i++) {
    const x = i * 0.37 - 300, z = i * 0.113 + 17;
    const v = a.noise2(x, z);
    assert.equal(v, b.noise2(x, z));
    assert.equal(a.noise3(x, z, x * 0.5), b.noise3(x, z, x * 0.5));
    if (v !== c.noise2(x, z)) diff++;
    min = Math.min(min, v); max = Math.max(max, v);
    assert.ok(Math.abs(a.noise3(x, z * 0.3, z)) <= 1.05);
    const f = a.fbm2(x, z, 5); assert.ok(Math.abs(f) <= 1.05); assert.ok(Math.abs(a.fbm3(x, 3, z)) <= 1.05);
    const r = a.ridged2(x, z); assert.ok(r >= 0 && r <= 1);
  }
  assert.ok(diff > 3500, 'seeds distintas deben dar ruido distinto');
  assert.ok(min < -0.4 && max > 0.4, `rango ${min}..${max}`);
  prev = a.noise2(0, 5.5);
  for (let i = 1; i < 2000; i++) { const v = a.noise2(i * 0.01, 5.5); maxStep = Math.max(maxStep, Math.abs(v - prev)); prev = v; }
  assert.ok(maxStep < 0.08, `salto ${maxStep}`);
});
