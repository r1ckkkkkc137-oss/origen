import test from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_BONES } from '../../shared/contracts.js';
import { createAnimator3D } from '../index.js';
import { run, d3 } from './helpers.mjs';
import { DIM } from '../skeleton3d.js';

test('contrato: Skeleton3D con los 17 HUMAN_BONES, padres, root y pose [x,y,z] mundo', () => {
  const A = createAnimator3D({ seed: 1 });
  const root = { pos: [3, 0, -2], yaw: 0.7 };
  const sk = A.update(1 / 60, root);
  assert.deepEqual(sk.bones, [...HUMAN_BONES]);
  assert.equal(Object.keys(sk.pose).length, 17);
  for (const b of HUMAN_BONES) { assert.ok(Array.isArray(sk.pose[b]) && sk.pose[b].length === 3 && sk.pose[b].every(Number.isFinite), b); assert.ok(b in sk.parent); }
  assert.equal(sk.parent.pelvis, null);
  for (const b of HUMAN_BONES) if (sk.parent[b] !== null) assert.ok(HUMAN_BONES.includes(sk.parent[b]));
  // la raíz es del sim: se devuelve tal cual y la animación no la modifica
  assert.deepEqual(sk.root.pos, [3, 0, -2]); assert.equal(sk.root.yaw, 0.7);
  assert.equal(typeof sk.visualYaw, 'number');
  for (let i = 0; i < 120; i++) A.update(1 / 60, root);
  assert.deepEqual(root, { pos: [3, 0, -2], yaw: 0.7 }, 'el animador no debe mutar la raíz del sim');
  assert.deepEqual(sk.root.pos, [3, 0, -2]);
  // pelvis proyectada sobre la raíz (la raíz no se desplaza por la animación)
  assert.ok(Math.hypot(sk.pose.pelvis[0] - 3, sk.pose.pelvis[2] + 2) < 0.08);
});

test('contrato: frente local +X (yaw 0), metros, Y arriba', () => {
  const A = createAnimator3D({ seed: 1 });
  let sk; for (let i = 0; i < 180; i++) sk = A.update(1 / 60, { pos: [0, 0, 0], yaw: 0 });
  const p = sk.pose;
  assert.ok(p.pelvis[1] > 0.7 && p.pelvis[1] < 1.0 && p.head[1] > 1.3 && p.head[1] < 1.9, 'alturas en metros');
  assert.ok(p.handL[0] > p.shoulderL[0] - 0.05 && p.handR[0] > p.shoulderR[0] - 0.05, 'las manos van al frente (+X)');
  assert.ok(sk.tips.face[0] > p.head[0], 'la cara mira a +X');
  // lateral: izquierda = -Z con yaw 0 (derecha = +Z, mano derecha, Y arriba, adelante +X)
  assert.ok(p.shoulderL[2] < p.shoulderR[2], 'L en -Z, R en +Z');
  // yaw = +90° (convención three rotation.y): el frente pasa a -Z
  const B = createAnimator3D({ seed: 1 }); let s2; for (let i = 0; i < 180; i++) s2 = B.update(1 / 60, { pos: [0, 0, 0], yaw: Math.PI / 2 });
  assert.ok(s2.tips.face[2] < s2.pose.head[2] - 0.03 && Math.abs(s2.tips.face[0] - s2.pose.head[0]) < 0.03, 'yaw +90° => frente -Z');
});

test('longitudes de hueso conservadas en guardia/caminar/jab/escalón/giro (<1e-6 m)', () => {
  const segs = [['hipL', 'kneeL', DIM.thigh], ['kneeL', 'footL', DIM.shin], ['hipR', 'kneeR', DIM.thigh], ['kneeR', 'footR', DIM.shin],
    ['shoulderL', 'elbowL', DIM.upperArm], ['elbowL', 'handL', DIM.foreArm], ['shoulderR', 'elbowR', DIM.upperArm], ['elbowR', 'handR', DIM.foreArm]];
  let worst = 0, rigid = 0;
  for (const sc of ['guard', 'walk', 'jab', 'step', 'step1m', 'turn90', 'turnWalk']) {
    const { frames } = run(sc);
    const ref = frames[0].pose;
    for (const f of frames) {
      for (const [a, b, L] of segs) { const e = Math.abs(d3(f.pose[a], f.pose[b]) - L); worst = Math.max(worst, e); }
      // segmentos rígidos del tronco constantes
      for (const [a, b] of [['pelvis', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['hipL', 'hipR']]) rigid = Math.max(rigid, Math.abs(d3(f.pose[a], f.pose[b]) - d3(ref[a], ref[b])));
    }
  }
  console.log(`  longitud hueso: error max ${worst.toExponential(2)} m (brazos/piernas), tronco ${rigid.toExponential(2)} m`);
  assert.ok(worst < 1e-6, `error ${worst}`); assert.ok(rigid < 1e-6, `tronco ${rigid}`);
});
