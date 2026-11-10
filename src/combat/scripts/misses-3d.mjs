// Por qué fallan los golpes, K peleas: cada golpe resuelto (hit/block/parry/check/catch/dodge/whiff) clasificado por desenlace,
// fase (de pie / clinch / suelo) y golpe. Whiff 'short' = cayó fuera de la ventana larga (distancia), 'jammed' = demasiado cerca,
// 'miss' = tirada de precisión fallada; dodge por tipo. Fintas aparte (no se resuelven). También patada atrapada: derribo vs release.
//   node src/combat/scripts/misses-3d.mjs [--n 1000] [--seed0 20000] [--geo 3d|2d]
import * as m from '../core/index.js';
import { levelSpec, stylePairs, LEVELS } from '../digest.js';
import { MOVES, PX_PER_M } from '../data/moves.js';
import { createCombatTranslator } from '../events.js';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const n = Number(arg('--n', 1000)), seed0 = Number(arg('--seed0', 20000)), geometry = arg('--geo', '3d');
const pairs = stylePairs(m.STYLE_IDS);
const cases = Array.from({ length: n }, (_, i) => { const [a, b] = pairs[i % pairs.length]; const lv = LEVELS[Math.floor(i / pairs.length) % 3]; return i % 2 ? { a: b, b: a, level: lv, seed: seed0 + i } : { a, b, level: lv, seed: seed0 + i }; });
const X = m.FIGHT_EVENTS_EXT, FE = m.FIGHT_EVENTS;
const OUT = { [FE.HIT]: 'hit', [FE.BLOCK]: 'block', [X.PARRY]: 'parry', [X.CHECK]: 'check', [X.CATCH]: 'catch', [FE.DODGE]: 'dodge', [X.WHIFF]: 'whiff' };
const tot = {}, byPhase = {}, byMove = {}, shortOver = [];
const evade = {}; let feints = 0, catches = 0, catchTd = 0, catchRel = 0, fights = 0;
const inc = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
for (const c of cases) {
  const f = m.createFight(levelSpec(c.a, c.level), levelSpec(c.b, c.level), c.seed, { record: false, geometry, tailSeconds: 0 });
  const F = f.core, tr = createCombatTranslator();
  fights++;
  while (!f.over) {
    const phase = F.phase;
    const { events } = m.stepFight(f);
    for (const ev of events) {
      if (ev.type === X.FEINT) { feints++; continue; }
      const o = OUT[ev.type]; if (!o) continue;
      const mv = MOVES[ev.move]; if (!mv || ev.kind === 'pummel') continue;
      const k = o === 'whiff' ? 'whiff:' + ev.kind : o === 'dodge' ? 'dodge:' + ev.kind : o;
      const ph = F.phase === 'stand' && phase === 'stand' ? 'stand' : phase;
      inc(tot, k); byPhase[ph] ??= {}; inc(byPhase[ph], k); byMove[ev.move] ??= {}; inc(byMove[ev.move], k);
      if (ev.kind === 'short' && F.geo.reachTable) { const w = F.geo.reachTable[ev.move]; if (w) shortOver.push(F.geo.distance(F.fighters[0], F.fighters[1]) / PX_PER_M - (w.rangeMax ?? 0) / PX_PER_M); }
    }
    const ces = events.flatMap((e) => tr.translate(e, F)).concat(tr.endTick());
    for (const e of ces) { if (e.type === 'miss' && e.evade) inc(evade, e.action + ':' + e.evade.kind); if (e.type === 'block' && e.src === 'catch') catches++; if (e.type === 'knockdown' && e.action === 'kickCatch') catchTd++; if (e.type === 'release') catchRel++; }
  }
}
const all = Object.values(tot).reduce((s, v) => s + v, 0);
const pct = (v, t) => (100 * v / t).toFixed(1) + '%';
const sum = (o, pre) => Object.entries(o).filter(([k]) => k.startsWith(pre)).reduce((s, [, v]) => s + v, 0);
const line = (o) => { const t = Object.values(o).reduce((s, v) => s + v, 0); return { n: t, landed: pct(o.hit || 0, t), defended: pct((o.block || 0) + (o.parry || 0) + (o.check || 0) + (o.catch || 0), t), dodged: pct(sum(o, 'dodge:'), t), short: pct(o['whiff:short'] || 0, t), jammed: pct(o['whiff:jammed'] || 0, t), missRoll: pct(o['whiff:miss'] || 0, t) }; };
console.log(JSON.stringify({ geometry, fights, seeds: [seed0, seed0 + n - 1], resolved: all, perFight: +(all / fights).toFixed(1), feintsPerFight: +(feints / fights).toFixed(1),
  total: line(tot), detail: Object.fromEntries(Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v, all)])),
  byPhase: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, line(v)])),
  byMove: Object.fromEntries(Object.entries(byMove).filter(([, v]) => Object.values(v).reduce((s, x) => s + x, 0) > 2000).map(([k, v]) => [k, line(v)])),
  shortOverM: shortOver.length ? { n: shortOver.length, median: +shortOver.sort((a, b) => a - b)[shortOver.length >> 1].toFixed(3), p90: +shortOver[Math.floor(shortOver.length * 0.9)].toFixed(3) } : null,
  evade: (() => { const t = Object.values(evade).reduce((s, v) => s + v, 0); const k = {}; for (const [kk, v] of Object.entries(evade)) inc(k, kk.split(':')[1], v); return { n: t, missRoll: tot['whiff:miss'] || 0, byKind: Object.fromEntries(Object.entries(k).map(([a, b]) => [a, pct(b, t)])) }; })(),
  kickCatch: { catches, takedown: catchTd, release: catchRel } }, null, 1));
