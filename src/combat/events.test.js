// Traductor KAGE FIGHT_EVENTS -> CombatEvent del contrato.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_EVENT } from '../shared/contracts.js';
import * as m from './core/index.js';
import { levelSpec } from './digest.js';
import { createCombatTranslator, KAGE_TO_COMBAT, UNMAPPED } from './events.js';

test('ningún tipo KAGE se descarta: todos mapeados a un COMBAT_EVENT; UNMAPPED vacío', () => {
  const all = [...m.ALL_EVENT_TYPES];
  assert.deepEqual([...UNMAPPED], []);
  for (const t of all) assert.ok(t in KAGE_TO_COMBAT, `${t} sin mapear`);
  // los 22 tipos del contrato quedan cubiertos (injury sale de hit+injury)
  const covered = new Set([...Object.values(KAGE_TO_COMBAT), 'injury']);
  for (const v of Object.values(COMBAT_EVENT)) assert.ok(covered.has(v), `COMBAT_EVENT ${v} sin origen`);
  for (const t of Object.keys(KAGE_TO_COMBAT)) assert.ok(all.includes(t), `tipo KAGE desconocido ${t}`);
  const valid = new Set(Object.values(COMBAT_EVENT));
  for (const c of Object.values(KAGE_TO_COMBAT)) assert.ok(valid.has(c), c);
});

for (const geometry of ['2d', '3d']) {
  test(`traducción en vivo (${geometry}): forma CombatEvent, ids numéricos, point sólo en 3D y la sim no cambia`, () => {
    const valid = new Set(Object.values(COMBAT_EVENT));
    const seen = new Set(); let withPoint = 0, hits = 0;
    for (const seed of [1000, 1001, 1002, 1003]) {
      const fight = m.createFight(levelSpec('boxer', 50), levelSpec('muayThai', 50), seed, { geometry });
      const tr = createCombatTranslator({ ids: { a: 7, b: 9 } });
      let n = 0;
      while (!fight.done && n++ < 20000) {
        const { events } = m.stepFight(fight);
        for (const e of events) for (const c of tr.translate(e, fight.core)) {
          assert.ok(valid.has(c.type), c.type); seen.add(c.type);
          assert.equal(c.tick, e.tick);
          for (const k of ['attacker', 'target']) if (k in c) assert.ok(c[k] === 7 || c[k] === 9, `${k}=${c[k]}`);
          if (c.point) { assert.equal(geometry, '3d'); assert.ok(c.point.length === 3 && c.point.every(Number.isFinite)); withPoint++; }
          if (c.type === 'hit') hits++;
          if (c.damage != null) assert.equal(typeof c.damage, 'number');
        }
      }
      const plain = m.simulateFight(levelSpec('boxer', 50), levelSpec('muayThai', 50), seed, { geometry });
      assert.equal(m.getResult(fight).endTick, plain.endTick);          // el traductor es sólo lectura
      assert.equal(m.getResult(fight).winner, plain.winner);
    }
    for (const t of ['actionStart', 'hit', 'miss']) assert.ok(seen.has(t), 'falta ' + t);
    for (const t of ['roundStart', 'roundEnd', 'fightEnd']) assert.ok(seen.has(t), 'falta ' + t);
    if (geometry === '3d') assert.ok(withPoint > 0 && withPoint <= hits * 3, `point en ${withPoint} eventos`);
  });
}

test('eventos de ronda/fin/posición/clinch traducidos con ids numéricos, src y result del contrato', () => {
  const tr = createCombatTranslator({ ids: { a: 7, b: 9 } });
  const one = (ev) => { const r = tr.translate({ tick: 5, ...ev }); assert.equal(r.length, 1); assert.equal(r[0].tick, 5); assert.equal(r[0].src, ev.type); return r[0]; };
  assert.deepEqual(one({ type: 'clinch', attacker: 'a', defender: 'b', kind: 'thai' }), { type: 'clinch', tick: 5, src: 'clinch', attacker: 7, target: 9, action: 'thai' });
  assert.deepEqual(one({ type: 'break', attacker: 'a', defender: 'b', reason: 'referee' }), { type: 'break', tick: 5, src: 'break', attacker: 7, target: 9, result: 'referee' });
  assert.equal(one({ type: 'sprawl', attacker: 'b', defender: 'a', move: 'dbl' }).target, 7);
  assert.equal(one({ type: 'sweep', attacker: 'a', defender: 'b' }).type, 'sweep');
  assert.deepEqual(one({ type: 'rocked', attacker: 'a', defender: 'b', ticks: 30 }), { type: 'rocked', tick: 5, src: 'rocked', attacker: 7, target: 9 });
  const p = one({ type: 'position', top: 'b', bottom: 'a', pos: 'mount', attacker: 'a', defender: 'b' });
  assert.equal(p.attacker, 9); assert.equal(p.target, 7); assert.equal(p.action, 'mount');
  assert.equal(one({ type: 'subEscape', attacker: 'a', defender: 'b' }).result, 'escape');
  assert.equal(one({ type: 'stoppage', defender: 'b', reason: 'doctor' }).result, 'doctor');
  assert.equal(one({ type: 'roundStart', round: 2 }).type, 'roundStart');
  assert.equal(one({ type: 'roundEnd', round: 2 }).type, 'roundEnd');
  const d = one({ type: 'decision', winner: 'a', kind: 'SD' }); assert.equal(d.attacker, 7); assert.equal(d.result, 'SD');
  const e = one({ type: 'fightEnd', result: { winner: 'b', method: 'TKO' } }); assert.equal(e.attacker, 9); assert.equal(e.result, 'TKO');
  assert.equal(one({ type: 'tap', attacker: 'a', defender: 'b', result: 'tap' }).result, 'tap');
});

test('contrato v0.4: los eventos traducidos llevan round (1-based) del evento KAGE', async () => {
  const { simulateFight } = await import('./index.js');
  const spec = (id, style) => ({ id, name: id, level: 50, style, stats: { fuerza: 55, velocidad: 55, tecnica: 55, resistencia: 55 } });
  const r = simulateFight(spec('a', 'boxer'), spec('b', 'kickboxer'), 77);
  const tr = createCombatTranslator({ ids: { a: 0, b: 1 } });
  const out = tr.translateAll(r.events);
  assert.ok(out.length > 20 && out.every((e) => Number.isInteger(e.round) && e.round >= 1));
  assert.equal(out.find((e) => e.type === 'roundStart').round, 1);
});

test('block: guard {limb, side} del que defiende, espejo del lado que golpea (contrato anim-r7)', async () => {
  const { guardOf } = await import('./events.js');
  assert.deepEqual(guardOf({ type: 'block', move: 'jab' }), { limb: 'glove', side: 'R' });
  assert.deepEqual(guardOf({ type: 'block', move: 'cross' }), { limb: 'glove', side: 'L' });
  assert.deepEqual(guardOf({ type: 'block', move: 'hook' }), { limb: 'forearm', side: 'R' });
  assert.deepEqual(guardOf({ type: 'block', move: 'bodyHook' }), { limb: 'forearm', side: 'R' });
  assert.deepEqual(guardOf({ type: 'block', move: 'highKick' }), { limb: 'forearm', side: 'L' });
  assert.deepEqual(guardOf({ type: 'check', move: 'lowKick' }), { limb: 'shin', side: 'L' });
  assert.deepEqual(guardOf({ type: 'catch', move: 'bodyKick' }), { limb: 'glove', side: 'L' });
  assert.deepEqual(guardOf({ type: 'catch', move: 'lowKick' }), { limb: 'glove', side: 'L' });
  assert.equal(guardOf({ type: 'block', move: 'nope' }), null);
});
