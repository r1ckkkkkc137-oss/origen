// K peleas en Geometry3D con las ventanas de KAGE (antes) vs data/reach3d.js (después): por golpe de pie,
// distancia pelvis–pelvis (m) al conectar/bloquear, % al aire por 'short'/'jammed', y distribución de finales.
//   node src/combat/scripts/reach-3d.mjs [--n 200]
import * as m from '../core/index.js';
import { levelSpec, stylePairs, LEVELS } from '../digest.js';
import { PX_PER_M, STAND_STRIKES } from '../data/moves.js';
const ni = process.argv.indexOf('--n'); const n = ni > 0 ? Number(process.argv[ni + 1]) : 200;
const pairs = stylePairs(m.STYLE_IDS);
const cases = Array.from({ length: n }, (_, i) => { const [a, b] = pairs[i % pairs.length]; const lv = LEVELS[Math.floor(i / pairs.length) % 3]; return i % 2 ? { a: b, b: a, level: lv, seed: 9000 + i } : { a, b, level: lv, seed: 9000 + i }; });
const kind = (r) => (r.winner == null ? 'draw' : r.method === 'DEC' || r.method === 'DECISION' ? 'DEC' : r.method);
function run(use3dReach) {
  const mv = {}, fin = {};
  for (const c of cases) {
    const f = m.createFight(levelSpec(c.a, c.level), levelSpec(c.b, c.level), c.seed, { record: false, geometry: '3d', tailSeconds: 0 });
    if (!use3dReach) f.core.reach = null;
    const F = f.core;
    while (!f.over) {
      const { events } = m.stepFight(f);
      for (const e of events) {
        if (!e.move || !STAND_STRIKES.includes(e.move) || F.phase !== 'stand' && e.type !== 'hit' && e.type !== 'block') continue;
        const s = (mv[e.move] ??= { land: 0, short: 0, jammed: 0, thrown: 0, d: [] });
        if (['hit', 'block', 'whiff', 'dodge', 'parry', 'check', 'catch'].includes(e.type)) s.thrown++;
        if (e.type === 'hit' || e.type === 'block') { s.land++; s.d.push(F.geo.distance(F.fighters[0], F.fighters[1]) / PX_PER_M); }
        else if (e.type === 'whiff' && (e.kind === 'short' || e.kind === 'jammed')) s[e.kind]++;
      }
    }
    const k = kind(m.getResult(f)); fin[k] = (fin[k] || 0) + 1;
  }
  return { mv, fin };
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
for (const [name, r] of [['ANTES (ventanas KAGE)', run(false)], ['DESPUÉS (reach3d)', run(true)]]) {
  console.log(`\n${name}: ${['KO', 'TKO', 'SUB', 'DEC', 'draw'].map((k) => `${k} ${(100 * (r.fin[k] || 0) / n).toFixed(1)}%`).join(' | ')}`);
  for (const id of STAND_STRIKES) { const s = r.mv[id]; if (!s) continue; const tot = s.thrown;
    console.log(`  ${id.padEnd(17)} conecta/bloq ${String(s.land).padStart(5)}  dist m p10 ${q(s.d, .1).toFixed(2)} med ${q(s.d, .5).toFixed(2)} p90 ${q(s.d, .9).toFixed(2)}  de lo lanzado: al aire short ${(100 * s.short / Math.max(1, tot)).toFixed(1)}% jammed ${(100 * s.jammed / Math.max(1, tot)).toFixed(1)}%`); }
}
