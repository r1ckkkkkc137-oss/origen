// createLiveFight: determinismo independiente de dt, eventos con round/ids, estado para Animador, restart, ground/findFightSpot, adaptador al animador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLiveFight, createLiveAnimation, findFightSpot, surfaceTop, simulateFight, createCombatTranslator, fightSeed } from './index.js';
import { stable } from './digest.js';
import { createAnimator3D } from '../anim/index.js';
import { COMBAT_EVENT } from '../shared/contracts.js';

const SEED = { worldSeed: 4242, x: 12, y: 9, z: -30 };
const ORIGIN = [12, 9, -30];
const sha = (v) => createHash('sha1').update(stable(v)).digest('hex');
const digestOf = (ticks, events) => ({ t: sha(ticks), e: sha(events), n: ticks.length });
// LCG propio (determinista) para patrones de dt irregulares
const lcg = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

function runLive(opts, dtOf) {
  const live = createLiveFight(opts);
  const all = [];
  live.on('*', (e) => all.push(e));
  let i = 0, guard = 0;
  while (!live.done && guard++ < 2e6) live.update(dtOf(i++));
  return { live, all };
}
const simRef = (a, b, seed, origin) => simulateFight(a, b, seed, { geometry: { kind: '3d', origin }, record: true });

test('misma seed => misma pelea que simulateFight, a 60 fps, a 144 fps, con dt irregular y con picos', () => {
  const live0 = createLiveFight({ seed: SEED, origin: ORIGIN });
  const [a, b] = live0.fight.specs ? [live0.fight.specs.a, live0.fight.specs.b] : [];
  const ref = simRef(a, b, SEED, ORIGIN);
  const want = digestOf(ref.ticks, ref.events);
  const r = lcg(99);
  const patterns = {
    '60fps': () => 1 / 60,
    '144fps': () => 1 / 144,
    '30fps': () => 1 / 30,
    irregular: () => (r() < 0.1 ? 0 : r() * 0.2),
  };
  for (const [name, dtOf] of Object.entries(patterns)) {
    const { live } = runLive({ seed: SEED, origin: ORIGIN }, dtOf);
    assert.ok(live.over && live.done, name);
    assert.deepEqual(digestOf(live.fight.ticks, live.fight.events), want, `digest ${name}`);
    assert.equal(live.result.winner, ref.winner);
    assert.equal(live.result.endTick, ref.endTick);
  }
});

test('el número de ticks depende sólo del tiempo acumulado, no del patrón de dt', () => {
  const a = createLiveFight({ seed: 5 }), b = createLiveFight({ seed: 5 });
  for (let i = 0; i < 600; i++) a.update(1 / 60);
  const r = lcg(3); let t = 0;
  while (t < 10 - 1e-9) { const d = Math.min(10 - t, r() * 0.07); b.update(d); t += d; }
  assert.ok(Math.abs(a.tick - b.tick) <= 1, `${a.tick} vs ${b.tick}`);
  const m = Math.min(a.tick, b.tick);
  assert.deepEqual(a.fight.ticks.slice(0, m).map((x) => x.a.x), b.fight.ticks.slice(0, m).map((x) => x.a.x));
});

test('eventos traducidos del frame: ids numéricos, round, tipos del contrato; equivalen a traducir el resultado de simulateFight', () => {
  const { live, all } = runLive({ seed: SEED, origin: ORIGIN, ids: { a: 11, b: 22 } }, () => 1 / 60);
  assert.ok(all.length > 50);
  const valid = new Set(Object.values(COMBAT_EVENT));
  for (const e of all) {
    assert.ok(valid.has(e.type), e.type);
    assert.ok(Number.isInteger(e.round) && e.round >= 1, `round en ${e.type}`);
    for (const k of ['attacker', 'target']) if (e[k] != null) assert.ok(e[k] === 11 || e[k] === 22);
  }
  const tr = createCombatTranslator({ ids: { a: 11, b: 22 } });
  const ref = tr.translateAll(live.fight.events);
  assert.deepEqual(all.map((e) => [e.type, e.tick, e.round]), ref.map((e) => [e.type, e.tick, e.round]));
  assert.ok(all.some((e) => e.type === 'hit' && Array.isArray(e.point)), 'hit con point en bloques');
  assert.deepEqual(all.filter((e) => e.type === 'roundStart').map((e) => e.round)[0], 1);
  assert.ok(all.some((e) => e.type === 'fightEnd'));
});

test('on(type) / on(*) / off', () => {
  const live = createLiveFight({ seed: 8 });
  let n = 0, hits = 0, starts = 0;
  const off = live.on('actionStart', () => starts++);
  live.on('hit', () => hits++);
  live.on('*', () => n++);
  for (let i = 0; i < 3000; i++) live.update(1 / 60);
  assert.ok(starts > 0 && n >= starts + hits);
  off(); const s = starts; for (let i = 0; i < 600; i++) live.update(1 / 60);
  assert.equal(starts, s);
});

test('frame: pos en metros + yaw + state completo; estados de movimiento coherentes', () => {
  const live = createLiveFight({ seed: SEED, origin: ORIGIN });
  const f0 = live.frame.fighters;
  assert.ok(Math.abs(f0.a.pos[0] - ORIGIN[0] * 0.5) < 3.2 && f0.a.pos[1] === ORIGIN[1] * 0.5);
  const seenPhase = new Set(), seenKind = new Set(); let hurt = 0, prevPos = null, maxJump = 0;
  for (let i = 0; i < 5000; i++) {
    const fr = live.update(1 / 60);
    for (const f of fr.list) {
      assert.ok(f.pos.every(Number.isFinite) && Number.isFinite(f.yaw));
      const s = f.state;
      assert.ok(s.guard >= 0 && s.guard <= 1 && s.progress >= 0 && s.progress <= 1 && s.phaseProgress >= 0 && s.phaseProgress <= 1);
      assert.equal(s.phase === null, s.move === null);
      if (s.phase) seenPhase.add(s.phase);
      if (s.kind) seenKind.add(s.kind);
      if (s.hurt) { hurt++; assert.ok(['head', 'body', 'legs'].includes(s.hurt.zone)); }
      if (f.side === 'a' && prevPos) maxJump = Math.max(maxJump, Math.hypot(f.pos[0] - prevPos[0], f.pos[2] - prevPos[2]));
      if (f.side === 'a') prevPos = f.pos;
    }
  }
  for (const p of ['windup', 'active', 'recovery']) assert.ok(seenPhase.has(p), p);
  assert.ok(seenKind.has('strike'));
  assert.ok(hurt > 0, 'zona golpeada reportada');
  assert.ok(maxJump < 0.2, `salto de raíz entre frames ${maxJump}`);
});

test('interpolación: con dt fraccionario pos queda entre el tick anterior y el actual', () => {
  const live = createLiveFight({ seed: 3 });
  for (let i = 0; i < 400; i++) live.update(1 / 60);
  const x0 = live.frame.fighters.a.pos[0], t0 = live.tick;
  live.update(0.005);   // < 1 tick: no avanza, sólo alpha
  assert.equal(live.tick, t0);
  const x1 = live.frame.fighters.a.pos[0];
  assert.ok(live.frame.alpha > 0 && Number.isFinite(x1));
  assert.ok(Math.abs(x1 - x0) < 0.05);
});

test('restart(seed): reproduce la misma pelea con la misma seed y cambia con otra', () => {
  const live = createLiveFight({ seed: SEED, origin: ORIGIN });
  while (!live.done) live.update(0.1);
  const d1 = digestOf(live.fight.ticks, live.fight.events);
  live.restart(); assert.equal(live.tick, 0); assert.equal(live.done, false);
  while (!live.done) live.update(1 / 60);
  assert.deepEqual(digestOf(live.fight.ticks, live.fight.events), d1);
  live.restart({ ...SEED, x: 13 }); while (!live.done) live.update(0.05);
  assert.notEqual(live.fight.events.length ? sha(live.fight.events) : '', d1.e);
});

test('estilos por lado y ids por defecto', () => {
  const live = createLiveFight({ seed: 1, styles: { a: 'wrestler', b: 'bjj' } });
  assert.equal(live.fight.specs.a.style, 'wrestler'); assert.equal(live.fight.specs.b.style, 'bjj');
  assert.deepEqual([live.frame.fighters.a.id, live.frame.fighters.b.id], [0, 1]);
});

// ---- ground / findFightSpot -------------------------------------------------------------------------------------------------
const hills = (x, y, z) => y < 10 + Math.floor(3 * Math.sin(x * 0.35) + 3 * Math.cos(z * 0.3));   // terreno ondulado (alturas 4..16)
const plateau = (x, y, z) => y < (x >= 20 && x < 60 && z >= 20 && z < 60 ? 14 : 8 + ((x * 7 + z * 13) & 3));   // meseta plana rodeada de ruido

test('findFightSpot es determinista, llano y encuentra la meseta', () => {
  const a = findFightSpot(plateau, 10, 10, 6, { search: 40 }), b = findFightSpot(plateau, 10, 10, 6, { search: 40 });
  assert.deepEqual(a, b);
  assert.ok(a.ok && a.spread === 0 && a.origin[1] === 14, JSON.stringify(a));
  const c = findFightSpot(hills, 0, 0, 6);
  assert.deepEqual(c, findFightSpot(hills, 0, 0, 6));
  assert.ok(Number.isFinite(c.spread));
  const flat = findFightSpot((x, y) => y < 5, 7, 9, 6);
  assert.deepEqual(flat.origin, [7.5, 5, 9.5]); assert.equal(flat.spread, 0);
});

test('findFightSpot descarta agua (objeto con solidAt + getBlock)', () => {
  const world = { solidAt: (x, y) => y < 5, getBlock: (x, y) => (y === 5 && x < 40 ? 6 : 0) };   // agua sobre el suelo en x<40
  const r = findFightSpot(world, 0, 0, 4, { search: 60, step: 4 });
  assert.ok(r.ok); assert.ok(r.origin[0] - 4 >= 40, `sale del agua: ${r.origin}`);
  assert.equal(surfaceTop(world, 1, 1), 5);
});

test('ground: origen pegado al suelo (cara superior) y pos[1] sigue el terreno; la sim no cambia', () => {
  const ground = (x, y, z) => y < 5;
  const live = createLiveFight({ seed: SEED, origin: [12, 0, -30], ground, snapToGround: true });
  assert.equal(live.origin[1], 5);
  const fr = live.update(1 / 60);
  assert.ok(fr.list.every((f) => f.pos[1] === 2.5));
  const free = createLiveFight({ seed: SEED, origin: [12, 5, -30] }); free.update(1 / 60);
  for (let i = 0; i < 1000; i++) { live.update(1 / 60); free.update(1 / 60); }
  assert.equal(sha(live.fight.ticks), sha(free.fight.ticks));
  // sin origen: busca un sitio llano
  const auto = createLiveFight({ seed: 2, ground: plateau, spotRadius: 6 });
  assert.ok(auto.origin.every(Number.isFinite));
  // escalón dentro del ring: pos[1] cambia con el terreno pero siempre es múltiplo de BLOCK_M
  const step = (x, y) => y < (x >= 12 ? 6 : 5);
  const st = createLiveFight({ seed: 6, origin: [12, 5, 0], ground: step });
  for (let i = 0; i < 600; i++) { for (const f of st.update(1 / 60).list) assert.ok([2.5, 3].includes(f.pos[1]), f.pos[1]); }
});

// ---- adaptador al animador --------------------------------------------------------------------------------------------------
test('adaptador: pelea completa con createAnimator3D (60 fps y dt irregular), sin errores, raíz = pos/yaw de la sim, clips de golpe disparados', () => {
  for (const dtOf of [() => 1 / 60, (() => { const r = lcg(5); return () => r() * 0.06; })()]) {
    const live = createLiveFight({ seed: SEED, origin: ORIGIN, styles: { a: 'boxer', b: 'boxer' } });
    const calls = { a: 0, b: 0 };
    const la = createLiveAnimation(live, { createAnimator3D, getBlock: () => false, blockM: 0.5 });
    for (const s of ['a', 'b']) { const p = la.anims[s].play; la.anims[s].play = (n) => { calls[s]++; assert.ok(['jab', 'cross', 'hook', 'lowkick'].includes(n), n); return p(n); }; }
    let n = 0;
    while (!live.done && n++ < 40000) {
      const { frame, skeletons } = la.update(dtOf());
      for (const s of ['a', 'b']) {
        const sk = skeletons[s], f = frame.fighters[s];
        assert.deepEqual(sk.root.pos, f.pos); assert.equal(sk.root.yaw, f.yaw);
        for (const k of sk.bones) assert.ok(sk.pose[k].every(Number.isFinite), k);
      }
    }
    assert.ok(live.done);
    assert.ok(calls.a + calls.b > 20, `clips ${calls.a}+${calls.b}`);
  }
});

test('el animador no afecta la pelea: misma digest con y sin animación', () => {
  const x = createLiveFight({ seed: SEED, origin: ORIGIN }), y = createLiveFight({ seed: SEED, origin: ORIGIN });
  const la = createLiveAnimation(x, { createAnimator3D });
  for (let i = 0; i < 3000; i++) { la.update(1 / 60); y.update(1 / 60); }
  assert.equal(sha(x.fight.ticks), sha(y.fight.ticks));
});

test('fightSeed del lugar coincide con el seed de la pelea en vivo', () => {
  const live = createLiveFight({ seed: SEED, origin: ORIGIN });
  assert.equal(live.seed, fightSeed(4242, 12, 9, -30));
});
