// Tests deterministas + reporte de balance de Combate. Node puro, sin dependencias.
//   node --test src/combat/core/                         -> tests rápidos (determinismo, contrato, ≥20 peleas/seed)
//   node src/combat/core/sim.test.js --report [--n 200] [--styles boxer,wrestler,...] [--stats 60] [--json out.json]
//        -> round robin entre estilos con ≥200 peleas por emparejamiento (lados alternados) y tabla de métricas.
//   node src/combat/core/sim.test.js --report --pro [--n 200] [--levels 10,50,85] [--styles ...] [--json out.json]
//        -> métricas de "pelea pro" (metrics.js: jab vs potencia, fintas, footwork, combos, spam, contras, pausas)
//           por estilo y global, con la config del juego (index.js), todos los estilos (8) contra todos.
import { simulateFight, createFight, stepFight, tickFight as tickFight_, getResult, replayFight, createHumanController, TICK_RATE, FIGHT_EVENTS, FIGHT_EVENTS_EXT, STYLE_IDS, RIVAL_STYLES } from './index.js';
import { mapStats } from './tuning.js';
import { fightMetrics, mergeMetrics, summarize } from './metrics.js';

const X = FIGHT_EVENTS_EXT;
const spec = (style, base = 60, id = style) => ({ id, name: style, level: 5, style, condition: 1, stats: { fuerza: base, velocidad: base, resistencia: base, tecnica: base } });

/** Hash FNV-1a de un string (para comparar resultados completos bit a bit). */
export function hashStr(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }

/** Corre una pelea sin grabar ticks y devuelve métricas. */
export function runMetrics(a, b, seed) {
  const fight = createFight(a, b, seed, { record: false, tailSeconds: 0 });
  const m = { ground: 0, clinch: 0, stand: 0, strikes: { a: 0, b: 0 }, landed: { a: 0, b: 0 }, events: 0, h: 0x811c9dc5 };
  while (!fight.done) {
    const { tick, events } = stepFight(fight);
    if (fight.over && tick.phase === 'over') continue;
    if (tick.phase === 'ground') m.ground++; else if (tick.phase === 'clinch') m.clinch++; else if (tick.phase === 'stand') m.stand++;
    for (const e of events) {
      m.events++;
      if (e.type === FIGHT_EVENTS.STRIKE) m.strikes[e.attacker]++;
      if (e.type === FIGHT_EVENTS.HIT) m.landed[e.attacker]++;
    }
    m.h = Math.imul(m.h ^ ((tick.a.x * 100) | 0) ^ ((tick.b.x * 100) << 7) ^ ((tick.a.hp * 10) << 3), 0x01000193) >>> 0;
  }
  const F = fight.core, r = F.result;
  const seconds = (r.tick + 1) / TICK_RATE;
  return { winner: r.winner, method: r.method, detail: r.detail, round: r.round, seconds, ...m, stats: F.stats, hash: m.h.toString(16) };
}

// ----------------------------------------------------------------- report
function pct(x, n) { return n ? (100 * x / n).toFixed(0) + '%' : '-'; }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

export function matchup(sa, sb, n, base = 60, seed0 = 1) {
  const acc = { n, winA: 0, winB: 0, draw: 0, KO: 0, TKO: 0, SUB: 0, DEC: 0, DRAW: 0, sec: 0, strikes: 0, ground: 0, clinch: 0, ticks: 0,
    tdAtt: { [sa]: 0, [sb]: 0 }, tdLand: { [sa]: 0, [sb]: 0 }, spm: { [sa]: 0, [sb]: 0 }, finA: 0, finB: 0, ctrl: { [sa]: 0, [sb]: 0 } };
  for (let i = 0; i < n; i++) {
    const swap = i & 1; // lados alternados: quita sesgo de 'a'/'b'
    const A = spec(swap ? sb : sa, base, 'a'), B = spec(swap ? sa : sb, base, 'b');
    const r = runMetrics(A, B, seed0 + i);
    const styleOf = { a: swap ? sb : sa, b: swap ? sa : sb };
    const w = r.winner ? styleOf[r.winner] : null;
    if (w === sa) acc.winA++; else if (w === sb) acc.winB++; else acc.draw++;
    acc[r.method] = (acc[r.method] ?? 0) + 1;
    if (w === sa && r.method !== 'DEC') acc.finA++;
    if (w === sb && r.method !== 'DEC') acc.finB++;
    acc.sec += r.seconds;
    acc.strikes += r.strikes.a + r.strikes.b;
    acc.ground += r.ground; acc.clinch += r.clinch; acc.ticks += r.ground + r.clinch + r.stand;
    for (const id of ['a', 'b']) {
      const st = styleOf[id];
      acc.tdAtt[st] += r.stats[id].tdAtt; acc.tdLand[st] += r.stats[id].tdLand;
      acc.spm[st] += r.strikes[id] / (r.seconds / 60);
      acc.ctrl[st] += r.stats[id].ctrl;
    }
  }
  return acc;
}

function report(argv) {
  const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const n = Math.max(1, +arg('n', 200));
  const base = +arg('stats', 60);
  const styles = (arg('styles', [...RIVAL_STYLES, 'counterpuncher'].join(','))).split(',').filter((s) => STYLE_IDS.includes(s));
  const t0 = Date.now();
  const rows = [];
  const per = {};
  for (const s of styles) per[s] = { w: 0, l: 0, d: 0, n: 0, fin: 0, KO: 0, TKO: 0, SUB: 0, DEC: 0, spm: 0, tdA: 0, tdL: 0, ctrlS: 0, sec: 0, ground: 0, clinch: 0, ticks: 0 };
  for (let i = 0; i < styles.length; i++) for (let j = i + 1; j < styles.length; j++) {
    const sa = styles[i], sb = styles[j];
    const m = matchup(sa, sb, n, base);
    rows.push({ sa, sb, m });
    for (const [s, o, win, loss, fin] of [[sa, sb, m.winA, m.winB, m.finA], [sb, sa, m.winB, m.winA, m.finB]]) {
      const p = per[s];
      p.w += win; p.l += loss; p.d += m.draw; p.n += n; p.fin += fin;
      p.spm += m.spm[s]; p.tdA += m.tdAtt[s]; p.tdL += m.tdLand[s]; p.ctrlS += m.ctrl[s] / TICK_RATE; p.sec += m.sec;
      p.ground += m.ground; p.clinch += m.clinch; p.ticks += m.ticks;
      p.KO += 0; // por estilo se reporta "fin" (victorias antes del límite)
    }
  }
  const head = ['matchup', 'win A-B (draw)', 'KO', 'TKO', 'SUB', 'DEC', 'dur s', 'golpes/min', 'TD% A', 'TD% B', 'suelo', 'clinch'];
  const W = [26, 16, 5, 5, 5, 5, 6, 10, 11, 11, 6, 6];
  const out = [];
  out.push(`KAGE combate — round robin: ${n} peleas/emparejamiento, stats ${base} parejas (4 del contrato -> 7 vía tuning.mapStats), lados alternados`);
  out.push(head.map((h, k) => pad(h, W[k])).join(' '));
  for (const { sa, sb, m } of rows) {
    const td = (s) => m.tdAtt[s] ? `${pct(m.tdLand[s], m.tdAtt[s])}/${(m.tdAtt[s] / n).toFixed(1)}` : '-';
    out.push([
      `${sa} v ${sb}`, `${pct(m.winA, n)}-${pct(m.winB, n)} (${m.draw})`,
      pct(m.KO, n), pct(m.TKO, n), pct(m.SUB, n), pct(m.DEC, n),
      (m.sec / n).toFixed(0), (m.strikes / (m.sec / 60)).toFixed(1), td(sa), td(sb),
      pct(m.ground, m.ticks), pct(m.clinch, m.ticks),
    ].map((c, k) => pad(c, W[k])).join(' '));
  }
  out.push('');
  out.push('por estilo: win% | fin% de sus victorias | golpes/min propios | TD intentos/pelea, éxito | ctrl arriba s/pelea | % tiempo suelo | % clinch');
  for (const s of styles) {
    const p = per[s];
    out.push(`${pad(s, 15)} ${lpad(pct(p.w, p.n), 4)} | fin ${lpad(pct(p.fin, p.w), 4)} | spm ${(p.spm / p.n).toFixed(1)} | TD ${(p.tdA / p.n).toFixed(2)} ${pct(p.tdL, p.tdA)} | ctrl ${(p.ctrlS / p.n).toFixed(1)}s | suelo ${pct(p.ground, p.ticks)} | clinch ${pct(p.clinch, p.ticks)}`);
  }
  out.push(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(out.join('\n'));
  const js = arg('json', null);
  if (js) import('node:fs').then((fs) => fs.writeFileSync(js, JSON.stringify({ n, base, styles, rows, per }, null, 1)));
}

function reportPro(argv) {
  const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const n = Math.max(1, +arg('n', 200));
  const levels = String(arg('levels', '10,50,85')).split(',').map(Number);
  const styles = String(arg('styles', STYLE_IDS.join(','))).split(',').filter((s) => STYLE_IDS.includes(s));
  const t0 = Date.now(), out = [], js = {};
  const cols = ['all', ...styles];
  for (const L of levels) {
    const sp = (style) => ({ style, stats: { fuerza: L, velocidad: L, resistencia: L, tecnica: L } });
    const list = [];
    for (let i = 0; i < styles.length; i++) for (let j = i + 1; j < styles.length; j++) for (let k = 0; k < n; k++) {
      const sw = k & 1, sa = styles[i], sb = styles[j];
      list.push(fightMetrics(simulateFight(sp(sw ? sb : sa), sp(sw ? sa : sb), 1 + k)));
    }
    const by = mergeMetrics(list, { by: 'style' });
    const sum = Object.fromEntries(cols.map((c) => [c, summarize(by[c])]));
    js[L] = sum;
    out.push(`== nivel ${L}: ${n} peleas/emparejamiento, ${styles.length} estilos, lados alternados, config del juego`);
    out.push(pad('métrica', 18) + cols.map((c) => lpad(c.slice(0, 9), 10)).join(''));
    for (const k of Object.keys(sum.all)) out.push(pad(k, 18) + cols.map((c) => lpad(sum[c][k], 10)).join(''));
  }
  out.push(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(out.join('\n'));
  const f = arg('json', null);
  if (f) import('node:fs').then((fs) => fs.writeFileSync(f, JSON.stringify(js, null, 1)));
}

// ----------------------------------------------------------------- tests
if (process.argv.includes('--report')) {
  if (process.argv.includes('--pro')) reportPro(process.argv); else report(process.argv);
} else {
  const { test } = await import('node:test');
  const assert = (await import('node:assert/strict')).default;

  test('mismo seed => FightResult idéntico (bit a bit)', () => {
    const a = spec('boxer'), b = spec('counterpuncher');
    const r1 = simulateFight(a, b, 1234), r2 = simulateFight(a, b, 1234);
    assert.equal(hashStr(JSON.stringify(r1)), hashStr(JSON.stringify(r2)));
    const r3 = simulateFight(a, b, 1235);
    assert.notEqual(hashStr(JSON.stringify(r1)), hashStr(JSON.stringify(r3)));
  });

  test('cumple el contrato FightResult', () => {
    const r = simulateFight({ id: 'player', stats: { fuerza: 10, velocidad: 10, resistencia: 10, tecnica: 10 }, condition: 0.8, style: 'mixto' },
      { id: 'rival', stats: { fuerza: 11, velocidad: 9, resistencia: 10.5, tecnica: 9.5 }, condition: 1 }, 99);
    assert.equal(r.tickRate, 60);
    assert.ok(r.ticks.length > 0);
    r.ticks.forEach((t, i) => assert.equal(t.tick, i));
    for (const t of r.ticks.slice(0, 50)) for (const f of [t.a, t.b]) {
      assert.equal(typeof f.x, 'number'); assert.ok(Math.abs(f.x) <= 260);
      assert.ok(f.stamina >= 0 && f.stamina <= 1); assert.ok(f.hp >= 0 && f.hp <= f.maxHp);
      assert.equal(typeof f.action, 'string'); assert.ok(f.facing === 1 || f.facing === -1);
    }
    assert.ok([null, 'a', 'b'].includes(r.winner));
    assert.ok(['ko', 'decision', 'draw'].includes(r.reason));
    for (let i = 1; i < r.events.length; i++) assert.ok(r.events[i - 1].tick <= r.events[i].tick);
    const blk = r.events.find((e) => e.type === FIGHT_EVENTS.BLOCK);
    if (blk) assert.equal(blk.actor, blk.defender); // Engine: actor del BLOCK = quien bloquea
  });

  test('4 stats y la misma pelea expandida a 7 por tuning.mapStats dan resultados idénticos', async () => {
    const { normalizeStats } = await import('./fighter.js');
    const { runCore } = await import('./core.js');
    const { LUCHA_STYLE_BONUS } = await import('./tuning.js');
    const fx = await import('./fighter.js');
    assert.equal(LUCHA_STYLE_BONUS, fx.LUCHA_STYLE_BONUS); // fuente única (re-export, no copia)
    // 1) el mapeo coincide con el del núcleo para todo estilo y stats variadas (incl. extremos y faltantes)
    const cases = [{ fuerza: 40, velocidad: 55, resistencia: 47, tecnica: 61 }, { fuerza: 1, velocidad: 100, resistencia: 13.37, tecnica: 99 },
      { fuerza: 10, velocidad: 10, resistencia: 10, tecnica: 10 }, { fuerza: 72 }, {}];
    for (const st of STYLE_IDS) for (const s4 of cases) assert.deepEqual({ ...mapStats(s4, st) }, { ...normalizeStats(s4, st) }, st + ' ' + JSON.stringify(s4));
    // 2) API pública: misma pelea completa (ticks + eventos) con 4 o con 7
    const s4 = { fuerza: 40, velocidad: 55, resistencia: 47, tecnica: 61 };
    for (const [st, seed] of [['wrestler', 5], ['bjj', 6], ['kickboxer', 7]]) {
      const r4 = simulateFight({ style: st, stats: s4 }, spec('boxer'), seed);
      const r7 = simulateFight({ style: st, stats: mapStats(s4, st) }, spec('boxer'), seed);
      assert.equal(hashStr(JSON.stringify(r4)), hashStr(JSON.stringify(r7)), st);
    }
    // 3) núcleo directo (sin pasar por index.js): el núcleo deriva las 4 él mismo vs. recibe las 7 de tuning.js
    const mk = (stats) => ({ id: 'a', name: 'P', style: 'muayThai', stats });
    const rb = { id: 'b', name: 'R', style: 'bjj', stats: { fuerza: 58, velocidad: 50, resistencia: 63, tecnica: 52 } };
    const c4 = runCore(mk(s4), rb, 11), c7 = runCore(mk(mapStats(s4, 'muayThai')), rb, 11);
    assert.equal(hashStr(JSON.stringify(c4)), hashStr(JSON.stringify(c7)));
  });

  test('>=20 peleas por seed base: deterministas y repetibles (boxer vs counterpuncher)', () => {
    const a = spec('boxer'), b = spec('counterpuncher');
    const run = () => Array.from({ length: 20 }, (_, i) => runMetrics(i & 1 ? b : a, i & 1 ? a : b, 1000 + i));
    const x = run(), y = run();
    assert.deepEqual(x.map((r) => r.hash + r.method + r.winner), y.map((r) => r.hash + r.method + r.winner));
    const durs = x.map((r) => r.seconds);
    assert.ok(durs.every((d) => d > 0 && d <= 3 * 90 + 3 * 2 + 1));
  });

  test('tickFight: acumulador a 60 Hz, mismo resultado que simulateFight; input humano no rompe', () => {
    const a = spec('boxer'), b = spec('kickboxer');
    const f = createFight(a, b, 77);
    let n = 0;
    while (!f.done && n < 100000) { tickFight_(f, 1 / 144); n++; }
    const ref = simulateFight(a, b, 77);
    assert.equal(f.ticks.length, ref.ticks.length);
    assert.equal(hashStr(JSON.stringify(f.ticks)), hashStr(JSON.stringify(ref.ticks)));
    const h = createFight(a, b, 3, { human: 'a' });
    const seq = ['jab', 'cross', null, 'lowKick', 'doubleLeg'];
    let fr;
    for (let i = 0; i < 600; i++) fr = tickFight_(h, 1 / 60, { walk: i % 90 < 45 ? 1 : 0, act: seq[(i >> 4) % seq.length] });
    assert.ok(h.ticks.length > 500);
    assert.equal(typeof fr.a.x, 'number'); assert.equal(fr.tick, h.last.tick); // FightFrame del contrato
    assert.equal(h.ignoredInputs ?? 0, 0);
  });

  // Input humano pseudoaleatorio pero determinista (LCG propio; nada de Math.random).
  const humanScript = (seed) => {
    let s = seed >>> 0;
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const acts = ['jab', 'cross', 'hook', 'lowKick', 'teep', 'doubleLeg', null, null];
    let cur = { walk: 0, act: null, feint: false, block: false, slip: false };
    return () => { // nuevo intent cada ~8 ticks
      if (r() < 0.125) cur = { walk: r() < 0.45 ? 1 : r() < 0.6 ? -1 : 0, act: acts[(r() * acts.length) | 0], feint: r() < 0.05, block: r() < 0.35, slip: r() < 0.2 };
      return cur;
    };
  };

  test('grabar y reproducir: tickFight con humano (block/slip) => replayFight da el mismo resultado', async () => {
    const { validateFightResult } = await import('../support/fightdriver.js');
    const a = spec('boxer'), b = spec('wrestler');
    for (const seed of [21, 22]) {
      const f = createFight(a, b, seed, { human: 'a' });
      const next = humanScript(seed * 7);
      let n = 0;
      while (!f.done && n < 200000) { tickFight_(f, 1 / 60, next()); n++; }
      const rec = getResult(f);
      assert.equal(validateFightResult(rec), null);
      assert.ok(rec.inputs.length > 20 && rec.inputs.every((x) => x.side === 'a'));
      assert.ok(rec.inputs.some((x) => x.intent.block) && rec.inputs.some((x) => x.intent.slip));
      const rp = replayFight(a, b, seed, rec);
      assert.equal(validateFightResult(rp), null);
      const key = (r) => hashStr(JSON.stringify([r.ticks, r.events, r.winner, r.method]));
      assert.equal(key(rp), key(rec), 'seed ' + seed);
      assert.deepEqual(rp.inputs, rec.inputs);
      // y desde sólo el array de inputs
      assert.equal(key(replayFight(a, b, seed, rec.inputs)), key(rec));
    }
  });

  test('refuerzo de finalizaciones a nivel bajo: entero a ≤10, nada desde 60, opts.tuning manda', async () => {
    const { lowLevelWeight, LOW_LEVEL_BOOST } = await import('./tuning.js');
    const { DEFAULT_TUNING } = await import('./core.js');
    assert.equal(lowLevelWeight(5), 1); assert.equal(lowLevelWeight(10), 1); assert.equal(lowLevelWeight(35), 0.5);
    assert.equal(lowLevelWeight(60), 0); assert.equal(lowLevelWeight(85), 0);
    const lv = (L, o) => createFight({ style: 'boxer', stats: { fuerza: L, velocidad: L, resistencia: L, tecnica: L } }, spec('bjj'), 1, o);
    const low = { style: 'boxer', stats: { fuerza: 10, velocidad: 10, resistencia: 10, tecnica: 10 } };
    const f10 = createFight(low, low, 1);
    assert.ok(Math.abs(f10.core.opt.koScale - (DEFAULT_TUNING.koScale + LOW_LEVEL_BOOST.koScale)) < 1e-9);
    assert.equal(createFight(low, low, 1, { tuning: { koScale: 0.5 } }).core.opt.koScale, 0.5);
    const hi = { style: 'boxer', stats: { fuerza: 85, velocidad: 85, resistencia: 85, tecnica: 85 } };
    assert.equal(createFight(hi, hi, 1).core.opt.damageScale, DEFAULT_TUNING.damageScale);
    assert.ok(lv(10).level < lv(60).level);
  });

  test('humano controlado por seed (block/slip): determinista y la defensa manual actúa', () => {
    const a = spec('kickboxer'), b = spec('muayThai');
    const run = (s) => simulateFight(a, b, 5, { controllers: { b: createHumanController({ source: humanScript(s) }) } });
    const x = run(1), y = run(1), z = run(2);
    assert.equal(hashStr(JSON.stringify(x)), hashStr(JSON.stringify(y)));
    assert.notEqual(hashStr(JSON.stringify(x)), hashStr(JSON.stringify(z)));
    assert.equal(x.controllers.b, 'human');
    // Defensa manual: proporción defensas / golpes que le llegan (defendidos + conectados), agregada sobre
    // varias semillas (no conteos absolutos de una sola pelea). Con el guion (block/slip a veces) > sin apretar nada.
    const DEF = new Set([FIGHT_EVENTS.BLOCK, FIGHT_EVENTS.DODGE, FIGHT_EVENTS_EXT.CHECK, FIGHT_EVENTS_EXT.PARRY]);
    const ratio = (mkSource) => {
      let d = 0, hit = 0;
      for (let seed = 31; seed < 37; seed++) {
        const r = simulateFight(a, b, seed, { controllers: { b: createHumanController({ source: mkSource(seed) }) } });
        for (const e of r.events) if (e.defender === 'b') { if (DEF.has(e.type)) d++; else if (e.type === FIGHT_EVENTS.STRIKE) hit++; }
      }
      return { d, hit, p: d / Math.max(1, d + hit) };
    };
    const scripted = ratio((seed) => humanScript(seed)), idle = ratio(() => () => ({ walk: 0 }));
    assert.ok(scripted.d > 0 && scripted.hit > 0, JSON.stringify(scripted));
    assert.ok(scripted.p > idle.p, `defensa con block/slip ${scripted.p.toFixed(3)} vs sin nada ${idle.p.toFixed(3)}`);
  });
  test('metrics.js: puro, determinista y conteos coherentes', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./metrics.js', import.meta.url), 'utf8');
    assert.ok(!/^\s*import\s/m.test(src) && !/\brequire\(/.test(src), 'metrics.js no importa nada');
    const a = spec('boxer', 50), b = spec('wrestler', 50);
    const m1 = fightMetrics(simulateFight(a, b, 9)), m2 = fightMetrics(simulateFight(a, b, 9));
    assert.deepEqual(m1, m2);
    for (const s of ['a', 'b']) {
      const c = m1[s];
      assert.ok(c.thrown > 0 && c.landed <= c.thrown && c.measL <= c.measT && c.powL <= c.powT);
      assert.ok(c.measT + c.powT + c.otherT <= c.thrown);
      assert.ok(c.feintFollow <= c.feintFollow60 && c.feintFollow60 <= c.feints + c.tdAtt);
      assert.equal(c.tInside + c.tRange + c.tOutside, c.tStand);
      assert.ok(c.comboStrikes <= c.thrown && c.counters <= c.thrown && c.sameAsPrev < Math.max(1, c.acts));
    }
    const all = summarize(mergeMetrics([m1, m2]).all);
    assert.equal(all.fights, 4);
    assert.ok(all.strikesPerMin > 0 && all.accuracy > 0 && all.accuracy <= 100 && all.entropyBits >= 0);
  });
  test('tick: campos opcionales de FighterTickState (contracts ecd6ed7) con tipos del contrato', async () => {
    const { validateFightResult } = await import('../support/fightdriver.js');
    const r = simulateFight(spec('bjj', 50), spec('muayThai', 50), 4);
    assert.equal(validateFightResult(r), null);
    const num01 = (v) => typeof v === 'number' && v >= 0 && v <= 1;
    const Z = ['head', 'body', 'legs', 'armL', 'armR'];
    let subSeen = false;
    for (const t of r.ticks) for (const f of [t.a, t.b]) {
      assert.ok(typeof f.lunge === 'number' && typeof f.step === 'number' && num01(f.guard) && num01(f.fatigue));
      assert.ok(Z.every((z) => num01(f.damage[z])), 'damage 5 zonas 0..1');
      assert.ok(f.marks && typeof f.marks === 'object' && f.injuries && typeof f.injuries === 'object');
      assert.ok(num01(f.cutHead) && num01(f.nose) && num01(f.eye));
      assert.ok(f.subProgress === null || num01(f.subProgress));
      if (f.subProgress !== null) subSeen = true;
      assert.ok(f.foot === null || ['advance', 'retreat', 'exit', 'stepIn', 'stepOut', 'pivot', 'circle', 'cutAngle'].includes(f.foot), f.foot);
    }
    assert.ok(typeof subSeen === 'boolean');
  });
}
