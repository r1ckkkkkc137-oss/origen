// IA de distancia en Geometry3D, K peleas: cuánto se tira fuera de rango, cuánto se cobra al que entra,
// cuántas entradas van detrás de una finta, cuánto se castiga el golpe al aire y cuánto ángulo se gana al salir.
//   node src/combat/scripts/distance-3d.mjs [--n 1000] [--seed0 20000]
import * as m from '../core/index.js';
import { levelSpec, stylePairs, LEVELS } from '../digest.js';
import { STAND_STRIKES } from '../data/moves.js';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const n = arg('--n', 1000), seed0 = arg('--seed0', 20000);
const pairs = stylePairs(m.STYLE_IDS);
const cases = Array.from({ length: n }, (_, i) => { const [a, b] = pairs[i % pairs.length]; const lv = LEVELS[Math.floor(i / pairs.length) % 3]; return i % 2 ? { a: b, b: a, level: lv, seed: seed0 + i } : { a, b, level: lv, seed: seed0 + i }; });
const kind = (r) => (r.winner == null ? 'draw' : r.method === 'DEC' || r.method === 'DECISION' ? 'DEC' : r.method);
const S = { thrown: 0, short: 0, jammed: 0, entryHits: 0, entries: 0, opens: 0, opensFeint: 0, opensFeintLand: 0, opensLand: 0, opensBare: 0, opensBareLand: 0, whiffs: 0, punished: 0, exits: 0, exitDeg: [], hitsLanded: 0, standTicks: 0 };
const fin = {};
const axis = (F) => { const [A, B] = F.fighters; return Math.atan2(B.pos.z - A.pos.z, B.pos.x - A.pos.x); };
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
for (const c of cases) {
  const f = m.createFight(levelSpec(c.a, c.level), levelSpec(c.b, c.level), c.seed, { record: false, geometry: '3d', tailSeconds: 0 });
  const F = f.core;
  const lastAct = {}, wasAdv = {}, open = {}, pend = [], exitW = [];
  let prevFoot = {};
  while (!f.over) {
    for (const x of F.fighters) {
      const adv = !x.action && F.t < x.intent.until && x.intent.dir > 0;
      if (adv && !wasAdv[x.id] && F.phase === 'stand') S.entries++;
      wasAdv[x.id] = adv;
    }
    const pre = Object.fromEntries(F.fighters.map((x) => [x.id, wasAdv[x.id] || (x.action && x.action.t < x.action.startup && !x.action.chain)]));
    const { events } = m.stepFight(f);
    if (F.phase === 'stand') S.standTicks++;
    for (const x of F.fighters) {
      const a = x.action;
      if (a && a !== lastAct[x.id] && F.phase === 'stand' && !a.feint && STAND_STRIKES.includes(a.move) && !a.chain) {
        S.opens++; const fe = !!a.afterFeint; if (fe) S.opensFeint++; else S.opensBare++; open[x.id] = { a, fe };
      }
      lastAct[x.id] = a;
      const ft = x.foot && F.t < x.foot.until ? x.foot.kind : null;
      if (ft && ft !== prevFoot[x.id] && (ft === 'pivot' || ft === 'exit' || ft === 'stepOut') && F.phase === 'stand' && x.lastMove && F.t - (x.lastStrikeT ?? -9999) < 40) exitW.push({ t0: F.t, a0: axis(F), until: F.t + 20 });
      prevFoot[x.id] = ft;
    }
    for (let i = exitW.length - 1; i >= 0; i--) if (F.t >= exitW[i].until) { if (F.phase === 'stand') { S.exits++; S.exitDeg.push(Math.abs(wrap(axis(F) - exitW[i].a0)) * 180 / Math.PI); } exitW.splice(i, 1); }
    for (const e of events) {
      if (e.move && STAND_STRIKES.includes(e.move) && ['hit', 'block', 'whiff', 'dodge', 'parry', 'check', 'catch'].includes(e.type)) {
        S.thrown++;
        if (e.type === 'whiff' && (e.kind === 'short' || e.kind === 'jammed')) S[e.kind]++;
        const o = open[e.attacker];
        if (o && e.move === o.a.move) { if (e.type === 'hit') { S.opensLand++; if (o.fe) S.opensFeintLand++; else S.opensBareLand++; } delete open[e.attacker]; }
      }
      if (e.type === 'hit' && e.move && STAND_STRIKES.includes(e.move)) { S.hitsLanded++; if (pre[e.defender]) S.entryHits++; }
      if (e.type === 'whiff' && e.move && STAND_STRIKES.includes(e.move)) { S.whiffs++; pend.push({ by: e.attacker, until: F.t + 40 }); }
      if (e.type === 'hit') for (let i = pend.length - 1; i >= 0; i--) if (pend[i].by === e.defender) { S.punished++; pend.splice(i, 1); }
    }
    for (let i = pend.length - 1; i >= 0; i--) if (F.t > pend[i].until) pend.splice(i, 1);
  }
  const k = kind(m.getResult(f)); fin[k] = (fin[k] || 0) + 1;
}
const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)].toFixed(1) : 'NaN'; };
console.log(`n=${n} seeds ${seed0}..${seed0 + n - 1}`);
console.log(`finales: ${['KO', 'TKO', 'SUB', 'DEC', 'draw'].map((k) => `${k} ${pc(fin[k] || 0, n)}`).join(' | ')}`);
console.log(`golpes de pie lanzados ${S.thrown}  al aire fuera de rango: short ${pc(S.short, S.thrown)} jammed ${pc(S.jammed, S.thrown)}`);
console.log(`golpes conectados al que estaba entrando: ${pc(S.entryHits, S.hitsLanded)} de los conectados (${S.entryHits}); entradas caminando ${S.entries}`);
console.log(`aperturas ${S.opens}: tras finta ${pc(S.opensFeint, S.opens)}  conecta tras finta ${pc(S.opensFeintLand, S.opensFeint)}  sin finta ${pc(S.opensBareLand, S.opensBare)}`);
console.log(`golpes al aire ${S.whiffs}: castigados con un golpe conectado en <=40 ticks ${pc(S.punished, S.whiffs)}`);
console.log(`salidas tras intercambio ${S.exits}: giro del eje en 20 ticks, mediana ${med(S.exitDeg)}°`);
console.log(`ticks de pie por pelea ${(S.standTicks / n).toFixed(0)}`);
