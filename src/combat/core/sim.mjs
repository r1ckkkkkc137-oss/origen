#!/usr/bin/env node
// Simulador headless de métricas. Uso: node src/combat/core/sim.mjs [--n 500] [--seed 1] [--rounds 3] [--json] [--core]
// Por defecto mide con la config del juego: effectiveTuning de index.js (OVERRIDES + LOW_LEVEL_BOOST según el nivel de la
// pelea, fightLevel de tuning.js); --core mide el núcleo solo (DEFAULT_TUNING).
import { runCore, DEFAULT_TUNING } from './core.js';
import { effectiveTuning } from './index.js';
import { fightLevel } from './tuning.js';
import { STYLE_IDS } from '../data/styles.js';
import { MOVES } from '../data/moves.js';
import { createRng } from './rng.js';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const CORE = args.includes('--core');
const tuneFor = (a, b) => (CORE ? {} : effectiveTuning({}, fightLevel(a.stats, b.stats)));
const N = +arg('n', 500), SEED = arg('seed', '1'), ROUNDS = +arg('rounds', 3);
const rng = createRng('sim:' + SEED);
const pct = (x, n) => (n ? ((100 * x) / n).toFixed(1) + '%' : '-');
const entropy = (counts) => { const tot = Object.values(counts).reduce((a, b) => a + b, 0); let h = 0; for (const c of Object.values(counts)) { const p = c / tot; if (p > 0) h -= p * Math.log2(p); } return h; };

function spec(id, style, base, spread) {
  const s = {};
  for (const k of ['fuerza', 'velocidad', 'tecnica', 'resistencia']) s[k] = Math.max(5, Math.min(100, Math.round(base + rng.gauss() * spread)));
  return { id, name: id.toUpperCase() + '#' + rng.int(0, 1e6), level: 1, style, stats: s }; // nombre variable: varía los quirks del peleador
}

const M = { n: 0, method: {}, detail: {}, dur: [], rounds: {}, thrown: {}, landed: {}, tdAtt: 0, tdLand: 0, subAtt: 0, kd: 0, rocked: 0, feints: 0, clinches: 0, parry: 0, whiff: 0, catches: 0, sweeps: 0,
  style: Object.fromEntries(STYLE_IDS.map((s) => [s, { w: 0, l: 0, d: 0 }])), mu: {}, statAdv: { fights: 0, wins: 0 }, statAdvBig: { fights: 0, wins: 0 }, statAdvSmall: { fights: 0, wins: 0 }, mirror: { a: 0, b: 0, d: 0 },
  seq: {}, standStrikes: 0, standSec: 0, phaseSec: { stand: 0, clinch: 0, ground: 0 }, bigram: {}, trigram: {}, finishSeq: new Set(), maxSameMoveRun: 0, ctrlShare: [], longestNoAction: 0, gap: { stand: 0, bad: 0, min: Infinity }, reachErr: {}, winBy: Object.fromEntries(STYLE_IDS.map((s) => [s, {}])) };
const PRO = { tri: {}, uni: {}, fighters: 0, comboLens: [], feints: 0, feintBit: 0, feintPunished: 0, exits: 0, pivots: 0, circles: 0, cuts: 0, cageTicks: 0, standTicks: 0, clinchAtt: 0, clinchKnees: 0, clinchElbows: 0, underhooks: 0, thrown: [0, 0, 0], ticks: [0, 0, 0], strikes: 0, spam: 0 };
const isStandStrike = (t) => MOVES[t]?.kind === 'strike' && MOVES[t].phase !== 'ground';
function addPro(r) {
  for (const id of ['a', 'b']) {
    const P = r.pro[id];
    PRO.fighters++;
    const tr = P.trace;
    for (let k = 0; k < tr.length; k++) { PRO.uni[tr[k]] = (PRO.uni[tr[k]] ?? 0) + 1; if (k > 1) { const g = tr[k - 2] + '>' + tr[k - 1] + '>' + tr[k]; PRO.tri[g] = (PRO.tri[g] ?? 0) + 1; } }
    const st = tr.filter(isStandStrike);
    for (let k = 0; k < st.length;) { let j = k; while (j < st.length && st[j] === st[k]) j++; PRO.strikes += j - k; if (j - k >= 3) PRO.spam += j - k; k = j; }
    PRO.comboLens.push(...P.comboLens);
    for (const k of ['feints', 'feintBit', 'feintPunished', 'exits', 'pivots', 'circles', 'cuts', 'cageTicks', 'standTicks', 'clinchAtt', 'clinchKnees', 'clinchElbows', 'underhooks']) PRO[k] += P[k] ?? 0;
    for (let i = 0; i < 3; i++) { PRO.thrown[i] += P.roundThrown[i] ?? 0; PRO.ticks[i] += r.pro.roundTicks[i] ?? 0; }
  }
}
const sumStats = (s) => s.fuerza + s.velocidad + s.tecnica + s.resistencia;

const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) {
  const mode = i % 4; // 0,1: estilos aleatorios stats iguales; 2: ventaja de stats; 3: espejo
  const sa = rng.pick(STYLE_IDS), sb = mode === 3 ? sa : rng.pick(STYLE_IDS);
  const base = rng.int(35, 80);
  let a, b;
  if (mode === 2) { /* dif. total por stat = 2·gap (4..20) */ const gap = rng.int(2, 10); a = spec('a', sa, base + gap, 4); b = spec('b', sb, base - gap, 4); }
  else { a = spec('a', sa, base, 0); b = { ...spec('b', sb, base, 0) }; }
  if (rng.chance(0.5) && mode === 2) [a, b] = [{ ...b, id: 'a' }, { ...a, id: 'b' }];
  const keep = i % 5 === 0; // distancia mínima de pie: se revisa tick a tick en 1 de cada 5 peleas
  const tune = tuneFor(a, b), minGap = tune.minGap ?? DEFAULT_TUNING.minGap;
  const r = runCore(a, b, 'f' + SEED + ':' + i, { ...tune, keepTicks: keep, rounds: ROUNDS });
  if (keep) {
    for (const t of r.ticks) if (t.phase === 'stand') { const d = Math.abs(t.a.x - t.b.x); M.gap.stand++; if (d < minGap - 1e-6) M.gap.bad++; if (d < M.gap.min) M.gap.min = d; }
    // error de contacto: distancia pelvis–pelvis del tick de impacto − rangeIdeal, golpes de pie que conectan o se bloquean
    const byT = new Map(r.ticks.map((t) => [t.tick, t]));
    for (const e of r.events) {
      const mv = MOVES[e.move];
      if ((e.type !== 'hit' && e.type !== 'block') || !mv || mv.phase !== 'stand' || mv.kind !== 'strike' || mv.rangeIdeal == null) continue;
      const t = byT.get(e.tick);
      if (t && t.phase === 'stand') (M.reachErr[e.move] ??= []).push(Math.abs(t.a.x - t.b.x) - mv.rangeIdeal);
    }
  }
  addPro(r);
  if (r.winner) { const ws = r.winner === 'a' ? sa : sb; M.winBy[ws][r.method] = (M.winBy[ws][r.method] ?? 0) + 1; }
  M.n++;
  M.method[r.method] = (M.method[r.method] ?? 0) + 1;
  M.detail[r.method + ':' + r.detail] = (M.detail[r.method + ':' + r.detail] ?? 0) + 1;
  M.dur.push(r.result.tick / 60);
  M.rounds[r.result.round] = (M.rounds[r.result.round] ?? 0) + 1;
  for (const id of ['a', 'b']) {
    const s = r.stats[id];
    for (const [k, v] of Object.entries(s.thrown)) M.thrown[k] = (M.thrown[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.landed)) M.landed[k] = (M.landed[k] ?? 0) + v;
    M.tdAtt += s.tdAtt; M.tdLand += s.tdLand; M.subAtt += s.subAtt; M.kd += s.kd; M.rocked += s.rocked; M.feints += s.feints; M.clinches += s.clinches; M.sweeps += s.sweeps;
  }
  for (const k in r.phaseTicks) M.phaseSec[k] += r.phaseTicks[k] / 60;
  M.standSec += r.phaseTicks.stand / 60;
  for (const e of r.events) if (e.type === 'strike' && e.phase === 'stand') M.standStrikes++;
  const w = r.winner;
  if (mode !== 3 && mode !== 2) {
    for (const [id, st] of [['a', sa], ['b', sb]]) {
      if (sa === sb) continue;
      if (!w) M.style[st].d++; else if (w === id) M.style[st].w++; else M.style[st].l++;
    }
    if (sa !== sb) { const key = [sa, sb].sort().join('-'); const m = (M.mu[key] ??= { [sa]: 0, [sb]: 0, n: 0 }); m.n++; if (w) m[w === 'a' ? sa : sb]++; }
  }
  if (mode === 3) M.mirror[w ?? 'd']++;
  if (mode === 2) {
    const better = sumStats(a.stats) > sumStats(b.stats) ? 'a' : 'b';
    const gap = Math.abs(sumStats(a.stats) - sumStats(b.stats)) / 4;
    M.statAdv.fights++; if (w === better) M.statAdv.wins++;
    if (gap < 10) { M.statAdvSmall.fights++; if (w === better) M.statAdvSmall.wins++; }
    if (gap >= 10) { M.statAdvBig.fights++; if (w === better) M.statAdvBig.wins++; }
  }
  // variedad: secuencias de golpes de cada peleador
  const per = { a: [], b: [] };
  for (const e of r.events) {
    if (e.type === 'strike' || e.type === 'action') per[e.attacker]?.push(e.move);
    if (e.type === 'parry') M.parry++;
    if (e.type === 'whiff') M.whiff++;
    if (e.type === 'catch') M.catches++;
  }
  for (const s of Object.values(per)) {
    let run = 1;
    for (let k = 0; k < s.length; k++) {
      M.seq[s[k]] = (M.seq[s[k]] ?? 0) + 1;
      if (k > 0) { const bg = s[k - 1] + '>' + s[k]; M.bigram[bg] = (M.bigram[bg] ?? 0) + 1; run = s[k] === s[k - 1] ? run + 1 : 1; if (run > M.maxSameMoveRun) { M.maxSameMoveRun = run; M.maxRunMove = s[k]; } }
      if (k > 1) { const tg = s[k - 2] + '>' + s[k - 1] + '>' + s[k]; M.trigram[tg] = (M.trigram[tg] ?? 0) + 1; }
    }
  }
  const fin = r.events.filter((e) => ['hit', 'takedown', 'knockdown', 'subAttempt', 'position'].includes(e.type)).slice(-4).map((e) => e.type + ':' + (e.move ?? e.pos ?? '')).join('|');
  M.finishSeq.add(r.method + '|' + fin);
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

const dur = M.dur.sort((x, y) => x - y);
const meth = (k) => M.method[k] ?? 0;
const out = {
  fights: M.n, ms: Math.round(ms),
  finish: { KO: pct(meth('KO'), M.n), TKO: pct(meth('TKO'), M.n), 'KO+TKO': pct(meth('KO') + meth('TKO'), M.n), SUB: pct(meth('SUB'), M.n), DEC: pct(meth('DEC'), M.n), DRAW: pct(meth('DRAW'), M.n) },
  detail: Object.fromEntries(Object.entries(M.detail).sort((a, b) => b[1] - a[1])),
  durationSec: { p10: dur[Math.floor(N * 0.1)]?.toFixed(1), median: dur[Math.floor(N / 2)]?.toFixed(1), p90: dur[Math.floor(N * 0.9)]?.toFixed(1) },
  endRound: M.rounds,
  pace: { standStrikesPerFighterPerMin: ((M.standStrikes / 2) / (M.standSec / 60)).toFixed(1), timeShare: Object.fromEntries(Object.entries(M.phaseSec).map(([k, v]) => [k, pct(v, M.phaseSec.stand + M.phaseSec.clinch + M.phaseSec.ground)])) },
  perFight: { kd: (M.kd / N).toFixed(2), rocked: (M.rocked / N).toFixed(2), tdAtt: (M.tdAtt / N).toFixed(2), tdAcc: pct(M.tdLand, M.tdAtt), subAtt: (M.subAtt / N).toFixed(2), feints: (M.feints / N).toFixed(1), clinches: (M.clinches / N).toFixed(2), parries: (M.parry / N).toFixed(2), whiffs: (M.whiff / N).toFixed(1), kickCatches: (M.catches / N).toFixed(2), sweeps: (M.sweeps / N).toFixed(2) },
  strikes: Object.fromEntries(Object.keys(M.thrown).filter((k) => MOVES[k]?.kind === 'strike').sort((a, b) => M.thrown[b] - M.thrown[a]).map((k) => [k, `${(M.thrown[k] / N).toFixed(1)}/f · ${pct(M.landed[k] ?? 0, M.thrown[k])}`])),
  styleWinRate: Object.fromEntries(Object.entries(M.style).map(([k, v]) => [k, `${pct(v.w, v.w + v.l + v.d)} (n=${v.w + v.l + v.d})`])),
  worstMatchups: Object.entries(M.mu).filter(([, m]) => m.n >= 6).map(([k, m]) => { const [x, y] = k.split('-'); const r = m[x] / m.n; return [k, r]; }).sort((a, b) => Math.abs(b[1] - 0.5) - Math.abs(a[1] - 0.5)).slice(0, 5).map(([k, r]) => `${k}: ${(r * 100).toFixed(0)}%`),
  betterStatsWin: `${pct(M.statAdv.wins, M.statAdv.fights)} (n=${M.statAdv.fights}); dif<10: ${pct(M.statAdvSmall.wins, M.statAdvSmall.fights)} (n=${M.statAdvSmall.fights}); dif≥10: ${pct(M.statAdvBig.wins, M.statAdvBig.fights)} (n=${M.statAdvBig.fights})`,
  mirror: M.mirror,
  reachErrPx: (() => { const q = (v, p) => v[Math.min(v.length - 1, Math.floor(p * v.length))].toFixed(1); const all = []; const o = {};
    for (const [k, v] of Object.entries(M.reachErr).sort((x, y) => y[1].length - x[1].length)) { v.sort((x, y) => x - y); all.push(...v); o[k] = `n${v.length} p5 ${q(v, 0.05)} p50 ${q(v, 0.5)} p95 ${q(v, 0.95)}`; }
    all.sort((x, y) => x - y); if (all.length) o.TODOS = `n${all.length} p5 ${q(all, 0.05)} p50 ${q(all, 0.5)} p95 ${q(all, 0.95)} (meta |p5|,|p95| ≤ 6)`; return o; })(),
  winMethodByStyle: Object.fromEntries(Object.entries(M.winBy).map(([k, v]) => { const n = Object.values(v).reduce((x, y) => x + y, 0); return [k, `${Object.entries(v).sort((x, y) => y[1] - x[1]).map(([m, c]) => `${m} ${pct(c, n)}`).join(' ')} (n=${n})`]; })),
  minStandGap: `${pct(M.gap.bad, M.gap.stand)} de ${M.gap.stand} ticks de pie bajo la distancia mínima (debe ser 0); mínima vista ${M.gap.min.toFixed(1)}px`,
  variety: { moveEntropyBits: entropy(M.seq).toFixed(2), maxBits: Math.log2(Object.keys(M.seq).length).toFixed(2), bigramEntropy: entropy(M.bigram).toFixed(2), uniqueBigrams: Object.keys(M.bigram).length, uniqueTrigrams: Object.keys(M.trigram).length, topTrigramShare: pct(Math.max(...Object.values(M.trigram)), Object.values(M.trigram).reduce((a, b) => a + b, 0)), maxSameMoveRun: `${M.maxSameMoveRun} (${M.maxRunMove})`, uniqueFinishSequences: `${M.finishSeq.size}/${N}` },
  pro: (() => {
    const F2 = N; const tri = Object.values(PRO.tri), triTot = tri.reduce((a, b) => a + b, 0);
    const topTri = Object.entries(PRO.tri).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${pct(v, triTot)}`);
    const cl = PRO.comboLens, multi = cl.filter((x) => x >= 2);
    return {
      trigramEntropyBits: entropy(PRO.tri).toFixed(2), tokens: Object.keys(PRO.uni).length, topTrigrams: topTri,
      comboLenMean: (cl.reduce((a, b) => a + b, 0) / Math.max(1, cl.length)).toFixed(2), comboLenMean2plus: (multi.reduce((a, b) => a + b, 0) / Math.max(1, multi.length)).toFixed(2), comboShare: pct(multi.length, cl.length),
      feintsPerFight: (PRO.feints / F2).toFixed(1), feintBitPct: pct(PRO.feintBit, PRO.feints), feintPunishedPct: pct(PRO.feintPunished, PRO.feints), feintPunishedOfBit: pct(PRO.feintPunished, PRO.feintBit),
      pivotsExitsPerFighterMin: ((PRO.pivots + PRO.exits) / (PRO.standTicks / 3600)).toFixed(2), pivots: (PRO.pivots / F2).toFixed(1), exits: (PRO.exits / F2).toFixed(1), circles: (PRO.circles / F2).toFixed(1), cutAngles: (PRO.cuts / F2).toFixed(1),
      cageTimePct: pct(PRO.cageTicks, PRO.standTicks), clinchEntriesPerFight: (PRO.clinchAtt / F2).toFixed(2), underhooks: (PRO.underhooks / F2).toFixed(2), clinchKnees: (PRO.clinchKnees / F2).toFixed(2), clinchElbows: (PRO.clinchElbows / F2).toFixed(2),
      volumePerMin: PRO.thrown.map((t, i) => `R${i + 1} ${(t / Math.max(1, PRO.ticks[i] / 3600)).toFixed(1)}`).join(' · '),
      spamPct: pct(PRO.spam, PRO.strikes) + ' (golpes en rachas ≥3 del mismo golpe)',
    };
  })(),
};
if (args.includes('--json')) console.log(JSON.stringify(out, null, 1));
else for (const [k, v] of Object.entries(out)) console.log(k.padEnd(16), typeof v === 'object' ? JSON.stringify(v) : v);
