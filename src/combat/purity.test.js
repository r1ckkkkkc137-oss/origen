// Pureza del núcleo: sin Math.random en src/ y sin acceso directo a la geometría fuera del adaptador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url)); // = src/combat
const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') || p.endsWith('.mjs') ? [p] : []; });
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('cero Math.random en src/ (código; comentarios aparte)', () => {
  const hits = [];
  for (const f of walk(SRC)) { if (f.endsWith('purity.test.js')) continue; if (/Math\s*\.\s*random|crypto\s*\.\s*(getRandomValues|randomUUID|randomInt)/.test(stripComments(readFileSync(f, 'utf8')))) hits.push(path.relative(SRC, f)); }
  assert.deepEqual(hits, []);
});

test('sin Date.now / performance.now / new Date en src/combat (salvo tests, scripts/ y support/)', () => {
  const hits = [];
  for (const f of walk(SRC)) { if (/\.test\.js$/.test(f) || /[\\/](scripts|support)[\\/]/.test(f)) continue; if (/Date\.now|performance\.now|new Date\(/.test(stripComments(readFileSync(f, 'utf8')))) hits.push(path.relative(SRC, f)); }
  assert.deepEqual(hits, []);
});

test('el núcleo sólo toca el espacio vía F.geo: sin .x/.facing/.pos de peleador ni cage en core/resolve/ai/controllers/fighter', () => {
  const bad = [];
  for (const n of ['core.js', 'resolve.js', 'ai.js', 'controllers.js', 'fighter.js']) {
    stripComments(readFileSync(path.join(SRC, 'core', n), 'utf8')).split('\n').forEach((line, i) => {
      if (/\b(?:f|A|B|a|b|o|opp|self|top|bottom|fighter)\.(x|y|z|facing|pos|heading)\b/.test(line) || /\bopt\.cage\b|\bcage\b\s*[-+<>]/.test(line)) bad.push(`${n}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  // permitido: la definición del tuning 'cage: 260' (se pasa al adaptador), no una lectura.
  assert.deepEqual(bad, []);
});
