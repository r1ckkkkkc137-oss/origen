// Bloqueos en Geometry3D, K peleas: cuántos eventos block salen, todos con guard {limb, side}, y su reparto.
//   node src/combat/scripts/guard-3d.mjs [--n 1000] [--seed0 20000]
import * as m from '../core/index.js';
import { levelSpec, stylePairs, LEVELS } from '../digest.js';
import { createCombatTranslator } from '../events.js';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const n = arg('--n', 1000), seed0 = arg('--seed0', 20000);
const pairs = stylePairs(m.STYLE_IDS);
const C = {}; let blocks = 0, noGuard = 0;
for (let i = 0; i < n; i++) {
  const [a, b] = pairs[i % pairs.length]; const lv = LEVELS[Math.floor(i / pairs.length) % 3];
  const f = m.createFight(levelSpec(i % 2 ? b : a, lv), levelSpec(i % 2 ? a : b, lv), seed0 + i, { record: false, geometry: '3d', tailSeconds: 0 });
  const tr = createCombatTranslator();
  while (!f.over) {
    const { events } = m.stepFight(f);
    for (const e of events) for (const o of tr.translate(e, f.core)) {
      if (o.type !== 'block') continue;
      blocks++;
      if (!o.guard) { noGuard++; continue; }
      const k = `${o.src}:${o.guard.limb}:${o.guard.side}`; C[k] = (C[k] ?? 0) + 1;
    }
  }
}
console.log(`n=${n} seeds ${seed0}..${seed0 + n - 1}: eventos block ${blocks}, sin guard ${noGuard}`);
for (const [k, v] of Object.entries(C).sort((x, y) => y[1] - x[1])) console.log(`  ${k} ${v} (${(100 * v / blocks).toFixed(1)}%)`);
