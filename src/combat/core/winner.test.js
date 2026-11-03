// Regresión: el resultado de pelea cumple el contrato (winner 'a'|'b'|null, reason 'ko'|'decision'|'draw', null <=> 'draw')
// y los jueces no empatan por ritmo calmo (antes |diff|<0.8 daba 10-10 y la pelea visual con seed 11 quedaba sin ganador).
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateFight, STYLE_IDS } from './index.js';

const sp = (style) => ({ style, stats: { fuerza: 50, velocidad: 50, resistencia: 50, tecnica: 50 } });

test('contrato de resultado y pocos empates (semillas 1..48, pares de estilos)', () => {
  let n = 0, draws = 0;
  for (let seed = 1; seed <= 48; seed++) {
    const a = STYLE_IDS[seed % STYLE_IDS.length], b = STYLE_IDS[(seed * 3 + 1) % STYLE_IDS.length];
    const r = simulateFight(sp(a), sp(b), seed);
    assert.ok(r.winner === 'a' || r.winner === 'b' || r.winner === null, `winner ${r.winner}`);
    assert.ok(['ko', 'decision', 'draw'].includes(r.reason), `reason ${r.reason}`);
    assert.equal(r.winner === null, r.reason === 'draw', `winner/reason inconsistentes (seed ${seed})`);
    n++; if (r.winner === null) draws++;
  }
  assert.ok(draws / n <= 0.06, `empates ${draws}/${n}`);
});

test('seed 11 (juego headless de Motor): hay ganador', () => {
  for (const [a, b] of [['boxer', 'muayThai'], ['kickboxer', 'wrestler'], ['bjj', 'brawler']]) {
    const r = simulateFight(sp(a), sp(b), 11);
    assert.notEqual(r.winner, null, `${a}-${b} seed 11 sin ganador`);
  }
});

// Animador r15/r6: BLOCK/PARRY con target; KO/HIT final con koZone+move; fatigue en tick.
import { createFight, stepFight, FIGHT_EVENTS, FIGHT_EVENTS_EXT } from './index.js';

const KO_ZONES = new Set(['jaw', 'temple', 'body', 'legs']);
const STRIKE_ZONES = new Set(['head', 'body', 'legs']);

test('BLOCK/PARRY traen target head|body|legs; KO trae koZone+move; HIT final con koZone; fatigue en tick', () => {
  let blocks = 0, parries = 0, kos = 0;
  let sawFatigue = false;
  for (let seed = 1; seed <= 80; seed++) {
    const a = STYLE_IDS[seed % STYLE_IDS.length], b = STYLE_IDS[(seed * 5 + 2) % STYLE_IDS.length];
    const fight = createFight(sp(a), sp(b), seed);
    const cap = fight.core.opt.maxTicks + fight.tailTicks + 10;
    while (!fight.done && fight.core.t < cap) {
      const { tick, events } = stepFight(fight);
      if (tick?.a && typeof tick.a.fatigue === 'number') {
        assert.ok(tick.a.fatigue >= 0 && tick.a.fatigue <= 1, `fatigue a fuera de 0..1: ${tick.a.fatigue}`);
        assert.ok(tick.b.fatigue >= 0 && tick.b.fatigue <= 1, `fatigue b fuera de 0..1: ${tick.b.fatigue}`);
        sawFatigue = true;
      }
      for (const e of events) {
        if (e.type === FIGHT_EVENTS.BLOCK) {
          blocks++;
          assert.ok(STRIKE_ZONES.has(e.target), `BLOCK sin target válido: ${JSON.stringify(e)}`);
        }
        if (e.type === FIGHT_EVENTS_EXT.PARRY) {
          parries++;
          assert.ok(STRIKE_ZONES.has(e.target), `PARRY sin target válido: ${JSON.stringify(e)}`);
        }
        if (e.type === FIGHT_EVENTS.KO) {
          kos++;
          assert.ok(e.move != null && e.move !== '', `KO sin move: ${JSON.stringify(e)}`);
          assert.ok(KO_ZONES.has(e.koZone), `KO sin koZone válida: ${JSON.stringify(e)}`);
          // el HIT del mismo tick (o inmediato) que causó el KO debe llevar koZone
          const hit = fight.events.filter((x) => x.type === FIGHT_EVENTS.HIT && x.move === e.move && x.attacker === e.attacker).at(-1);
          assert.ok(hit, `KO sin HIT previo move=${e.move}`);
          assert.equal(hit.koZone, e.koZone, `HIT.koZone !== KO.koZone (${hit.koZone} vs ${e.koZone})`);
        }
      }
    }
  }
  assert.ok(sawFatigue, 'fatigue no apareció en tick.a/b');
  assert.ok(blocks >= 10, `pocos BLOCK para validar target (${blocks})`);
  assert.ok(kos >= 1, `ningún KO en 80 semillas (${kos})`);
});
