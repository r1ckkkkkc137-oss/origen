// Traductor KAGE FIGHT_EVENTS -> CombatEvent del contrato.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_EVENT } from '../shared/contracts.js';
import * as m from './core/index.js';
import { levelSpec } from './digest.js';
import { createCombatTranslator, KAGE_TO_COMBAT, UNMAPPED } from './events.js';

test('cada tipo KAGE está mapeado o explícitamente descartado (partición sin huecos ni solapes)', () => {
  const all = [...m.ALL_EVENT_TYPES];
  for (const t of all) assert.ok((t in KAGE_TO_COMBAT) !== UNMAPPED.includes(t), `${t}: mapeado XOR descartado`);
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
    if (geometry === '3d') assert.ok(withPoint > 0 && withPoint <= hits * 3, `point en ${withPoint} eventos`);
  });
}
