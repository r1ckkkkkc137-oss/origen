// 200 peleas en Geometry3D vs las MISMAS 200 en Geometry2D: distribución de finales y duración. Sólo informa (no afina nada).
//   node scripts/dist-3d-vs-2d.mjs [--n 200]
import * as m from '../core/index.js';
import { levelSpec, stylePairs, LEVELS } from '../digest.js';
const ni = process.argv.indexOf('--n'); const n = ni > 0 ? Number(process.argv[ni + 1]) : 200;
const pairs = stylePairs(m.STYLE_IDS);
const cases = Array.from({ length: n }, (_, i) => { const [a, b] = pairs[i % pairs.length]; const lv = LEVELS[Math.floor(i / pairs.length) % 3]; return i % 2 ? { a: b, b: a, level: lv, seed: 9000 + i } : { a, b, level: lv, seed: 9000 + i }; });
const kind = (r) => (r.winner == null ? 'draw' : r.method === 'DEC' || r.method === 'DECISION' ? 'DEC' : r.method);
function run(geometry) {
  const d = {}, secs = [], rounds = {}, phase = { stand: 0, clinch: 0, ground: 0 };
  let minS = Infinity, instant = 0;
  for (const c of cases) {
    const r = m.simulateFight(levelSpec(c.a, c.level), levelSpec(c.b, c.level), c.seed, { record: false, ...(geometry ? { geometry } : {}) });
    const k = kind(r); d[k] = (d[k] || 0) + 1;
    const s = (r.endTick + 1) / m.TICK_RATE; secs.push(s); minS = Math.min(minS, s); if (s < 10) instant++;
    rounds[r.round] = (rounds[r.round] || 0) + 1;
  }
  secs.sort((x, y) => x - y);
  return { d, minS, medS: secs[secs.length >> 1], maxS: secs.at(-1), instant, rounds };
}
const pct = (d) => ['KO', 'TKO', 'SUB', 'DEC', 'draw'].map((k) => `${k} ${d[k] || 0} (${(100 * (d[k] || 0) / n).toFixed(1)}%)`).join(' | ');
const t2 = run(null), t3 = run('3d');
console.log(`${n} peleas (28 pares, niveles 10/50/85, lados alternados)`);
for (const [name, t] of [['2D', t2], ['3D', t3]]) console.log(`${name}: ${pct(t.d)}\n    duración s: min ${t.minS.toFixed(1)} mediana ${t.medS.toFixed(1)} max ${t.maxS.toFixed(1)}; <10 s: ${t.instant}; por round de fin ${JSON.stringify(t.rounds)}; otros métodos ${JSON.stringify(Object.fromEntries(Object.entries(t.d).filter(([k]) => !['KO', 'TKO', 'SUB', 'DEC', 'draw'].includes(k))))}`);
