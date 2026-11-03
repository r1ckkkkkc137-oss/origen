// Paridad Geometry2D vs KAGE f40b47d (56 seeds fijas: 28 pares de estilos x 2, niveles 10/50/85).
// Compara winner/method/round/endTick, hash del stream de eventos, hash de todos los ticks y del resultado completo.
// 1) contra golden/parity56.json (generado desde la referencia) -> no necesita la copia de referencia.
// 2) si existe KAGE_REF_DIR (default /tmp/origen-combat-ref), también en vivo contra la referencia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as nw from './core/index.js';
import { fightDigest, subset56 } from './digest.js';

const golden = JSON.parse(readFileSync(new URL('./golden/parity56.json', import.meta.url), 'utf8'));
const REF = process.env.KAGE_REF_DIR ?? '/tmp/origen-combat-ref';

test('golden: 8 estilos, 28 pares, 56 seeds, niveles 10/50/85', () => {
  assert.deepEqual(golden.styles, nw.STYLE_IDS);
  assert.equal(golden.cases.length, 56);
  assert.equal(new Set(golden.cases.map((c) => c.a + '/' + c.b)).size, 28);
  assert.deepEqual([...new Set(golden.cases.map((c) => c.level))].sort((a, b) => a - b), [10, 50, 85]);
  assert.deepEqual(golden.cases.map(({ a, b, level, seed }) => ({ a, b, level, seed })), subset56(nw.STYLE_IDS));
});

test('Geometry2D (default) == golden KAGE f40b47d en 56 seeds (eventos + ticks + resultado, bit a bit)', () => {
  for (const c of golden.cases) assert.deepEqual(fightDigest(nw, c.a, c.b, c.level, c.seed), c.digest, `${c.a} vs ${c.b} L${c.level} seed ${c.seed}`);
});

test("geometry:'2d' explícito == default", () => {
  for (const c of golden.cases.slice(0, 6)) assert.deepEqual(fightDigest(nw, c.a, c.b, c.level, c.seed, { geometry: '2d' }), c.digest);
});

test('Geometry2D == referencia en vivo (si /tmp/origen-combat-ref existe)', { skip: !existsSync(path.join(REF, 'src/fight/index.js')) && 'sin copia de referencia' }, async () => {
  const ref = await import(pathToFileURL(path.join(REF, 'src/fight/index.js')));
  for (const c of golden.cases.filter((_, i) => i % 4 === 0)) assert.deepEqual(fightDigest(nw, c.a, c.b, c.level, c.seed), fightDigest(ref, c.a, c.b, c.level, c.seed));
});
