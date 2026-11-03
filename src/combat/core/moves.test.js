// fight: guardia contra borrados accidentales de movimientos (regresión de 97e1916).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, MOVE_IDS, GROUND_POSITIONS } from '../data/moves.js';

// Las 42 ids de 42c33da + las sumisiones de la Ronda 17 (heelHook, kneeBar).
const REQUIRED = [
  'jab', 'cross', 'hook', 'uppercut', 'overhand', 'bodyHook', 'bodyCross', 'supermanPunch',
  'spinningBackfist', 'teep', 'lowKick', 'calfKick', 'bodyKick', 'highKick', 'flyingKnee', 'standElbow',
  'clinchEntry', 'clinchKnee', 'clinchKneeHead', 'clinchElbow', 'dirtyUppercut', 'bodyLockTrip', 'breakClinch', 'doubleLeg',
  'singleLeg', 'gnpPunch', 'gnpElbow', 'gnpBody', 'pass', 'takeBack', 'disengage', 'rnc',
  'armbarTop', 'armTriangle', 'kimura', 'sweep', 'getUp', 'shrimp', 'guardElbow', 'armbarGuard',
  'triangle', 'guillotine', 'heelHook', 'kneeBar',
];

test('moves: ninguna id requerida desaparece', () => {
  for (const id of REQUIRED) assert.ok(MOVES[id], `falta el movimiento ${id}`);
});

test('moves: 44 ids canónicas (42 de 42c33da + heelHook + kneeBar)', () => {
  assert.equal(MOVE_IDS.length, 44);
});

test('moves: desde abajo siempre hay una salida (escape/sweep) en cada posición de suelo', () => {
  for (const pos of GROUND_POSITIONS) {
    const outs = MOVE_IDS.filter((k) => MOVES[k].phase === 'ground' && MOVES[k].side === 'bottom'
      && (MOVES[k].kind === 'escape' || MOVES[k].kind === 'sweep') && MOVES[k].pos.includes(pos));
    assert.ok(outs.length > 0, `abajo en ${pos} no hay escape`);
  }
});
