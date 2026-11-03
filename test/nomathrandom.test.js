import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
test('cero Math.random en src/', () => {
  const bad = walk(new URL('../src', import.meta.url).pathname).filter((f) => f.endsWith('.js') && /Math\.random\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});
