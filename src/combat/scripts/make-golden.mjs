// Regenera src/combat/golden/parity56.json DESDE LA REFERENCIA KAGE (f40b47d intacta). No usar la copia refactorizada.
//   node scripts/make-golden.mjs [/tmp/origen-combat-ref]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fightDigest, subset56 } from '../digest.js';
const ref = process.argv[2] ?? '/tmp/origen-combat-ref';
const mod = await import(pathToFileURL(path.join(ref, 'src/fight/index.js')));
const out = subset56(mod.STYLE_IDS).map((c) => ({ ...c, digest: fightDigest(mod, c.a, c.b, c.level, c.seed) }));
writeFileSync(new URL('../golden/parity56.json', import.meta.url), JSON.stringify({ source: 'KAGE f40b47d', styles: mod.STYLE_IDS, cases: out }, null, 1) + '\n');
console.log('golden:', out.length, 'peleas');
