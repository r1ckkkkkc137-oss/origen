// Trepar saliente de 1 m: pops, huesos, manos ancladas al borde, pies sobre el borde, llegada en guardia, determinismo, registro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../scenarios.js';
import { CLIPS } from '../clips.js';
import * as API from '../index.js';
import { climbPathAt, CLIMB_T } from '../climb.js';
import { DIM } from '../skeleton3d.js';
import { clone, d3 } from './helpers.mjs';

const T0 = 3.6, H = 1.0;
const BONES = [['shoulderL', 'elbowL', DIM.upperArm], ['elbowL', 'handL', DIM.foreArm], ['hipL', 'kneeL', DIM.thigh], ['kneeL', 'footL', DIM.shin], ['hipR', 'kneeR', DIM.thigh], ['kneeR', 'footR', DIM.shin]];
function runClimb() {
  const fr = []; let info = null;
  simulate('climb1m', { onFrame: (t, sk, A) => { if (A.climbInfo) info = { ...A.climbInfo }; if (t >= T0 - 0.05 && t <= T0 + CLIMB_T + 0.5) fr.push({ s: t - T0, sk: clone(sk) }); } });
  return { fr, info };
}
const R = runClimb();

test('climb: registro y exports', () => {
  assert.ok(CLIPS.climb && CLIPS.climb.climb === true);
  assert.equal(CLIPS.climb.duration, CLIMB_T);
  for (const k of ['CLIMB', 'CLIMB_T', 'planClimb', 'climbPathAt']) assert.ok(k in API, k);
  const p0 = climbPathAt({ dist: 0.65, height: 1 }, 0), p1 = climbPathAt({ dist: 0.65, height: 1 }, CLIMB_T);
  assert.equal(p0.up, 0); assert.ok(Math.abs(p1.up - 1) < 1e-6); assert.ok(Math.abs(p1.fwd - 1.0) < 1e-6);
});

test('climb: A.climbInfo describe el saliente', () => {
  assert.ok(R.info);
  assert.ok(Math.abs(R.info.height - H) < 1e-6 && Math.abs(R.info.dist - 0.65) < 0.02, JSON.stringify(R.info));
  assert.equal(R.info.duration, CLIMB_T);
});

test('climb: sin pops (< 8 cm/frame articulación, < 6 cm pelvis/torso/cabeza/rodillas/pies) y huesos íntegros', () => {
  let prev = null, mx = {}, boneErr = 0;
  for (const { s, sk } of R.fr) {
    if (s < 0.02 || s > CLIMB_T) { prev = null; continue; }
    const P = sk.pose;
    for (const [a, b, L] of BONES) boneErr = Math.max(boneErr, Math.abs(d3(P[a], P[b]) - L) / L);
    if (prev) for (const k in P) mx[k] = Math.max(mx[k] || 0, d3(P[k], prev[k]));
    prev = P;
  }
  assert.ok(boneErr < 0.01, `huesos ${boneErr}`);
  for (const k of ['pelvis', 'spine', 'chest', 'neck', 'head', 'kneeL', 'kneeR', 'footL', 'footR']) assert.ok(mx[k] < 0.06, `${k} ${(mx[k] * 100).toFixed(1)} cm/frame`);
  for (const k of ['elbowL', 'elbowR', 'handL', 'handR', 'shoulderL', 'shoulderR']) assert.ok(mx[k] < 0.08, `${k} ${(mx[k] * 100).toFixed(1)} cm/frame`);
});

test('climb: las muñecas se agarran al borde (y ≈ H) mientras están ancladas', () => {
  for (const { s, sk } of R.fr) if (s > 0.45 && s < 1.0) for (const k of ['handL', 'handR']) assert.ok(Math.abs(sk.pose[k][1] - H) < 0.06, `${k}@${s.toFixed(2)} y=${sk.pose[k][1].toFixed(3)}`);
});

test('climb: los pies no atraviesan el borde y acaban sobre él; llega en guardia', () => {
  for (const { s, sk } of R.fr) {
    const x = sk.pose.footL[0]; // el borde está en x≈1.5 (mundo); detrás, suelo a 0
    for (const [f, toe] of [['footL', 'toeL'], ['footR', 'toeR']]) {
      const p = sk.pose[f], t = sk.tips[toe];
      assert.ok(p[1] > 0.03 && t[1] > -0.02, `${f}@${s.toFixed(2)} y=${p[1].toFixed(3)} dedo ${t[1].toFixed(3)}`);
      if (p[0] > 1.55 && s > 0.3) assert.ok(p[1] > H + 0.03 || s < 1.5, `${f} sobre el borde @${s.toFixed(2)}: y=${p[1].toFixed(3)}`);
    }
    void x;
  }
  const last = R.fr.at(-1).sk, P = last.pose;
  assert.ok(Math.abs(P.footL[1] - (H + 0.08)) < 0.03 && Math.abs(P.footR[1] - (H + 0.08)) < 0.03, `pies ${P.footL[1]} ${P.footR[1]}`);
  assert.ok(P.pelvis[1] > H + 0.7 && P.pelvis[1] < H + 0.9, `pelvis ${P.pelvis[1]}`);
  assert.ok(P.handL[1] > P.pelvis[1] + 0.3 && P.handR[1] > P.pelvis[1] + 0.3, 'manos arriba (guardia)');
  assert.ok(P.head[1] > P.pelvis[1] + 0.4, 'cabeza erguida');
});

test('climb: determinista', () => {
  const R2 = runClimb();
  assert.equal(R2.fr.length, R.fr.length);
  for (let i = 0; i < R.fr.length; i += 7) for (const k in R.fr[i].sk.pose) assert.deepEqual(R2.fr[i].sk.pose[k], R.fr[i].sk.pose[k]);
});
