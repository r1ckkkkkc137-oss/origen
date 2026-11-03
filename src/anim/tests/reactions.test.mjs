// Reacciones por zona, rocked, KO, getUp y setState(): pops, penetración del suelo, longitudes de hueso, determinismo, estados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimator3D } from '../animator3d.js';
import { CLIPS } from '../clips.js';
import { KO_END } from '../reactions.js';
import { DIM } from '../skeleton3d.js';

const ROOT = { pos: [0, 0, 0], yaw: 0 };
const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const BONES = [['shoulderL', 'elbowL', DIM.upperArm], ['elbowL', 'handL', DIM.foreArm], ['hipL', 'kneeL', DIM.thigh], ['kneeL', 'footL', DIM.shin], ['hipR', 'kneeR', DIM.thigh], ['kneeR', 'footR', DIM.shin]];
// corre una lista de [t, fn(A)] y devuelve estadísticas por frame
function run(actions, dur, hz = 60) {
  const A = createAnimator3D({ seed: 3 }); const dt = 1 / hz; const acts = actions.slice();
  const st = { maxPelvis: 0, maxHead: 0, maxJoint: 0, minY: 1e9, boneErr: 0, frames: [], ev: [] }; let prev = null;
  for (let i = 0; i * dt <= dur; i++) {
    const t = i * dt; while (acts.length && acts[0][0] <= t + 1e-9) acts.shift()[1](A);
    const sk = A.update(dt, ROOT); const P = sk.pose;
    st.ev.push(...A.events.map((e) => ({ ...e, t })));
    for (const k in P) st.minY = Math.min(st.minY, P[k][1]);
    for (const k of ['handL', 'handR', 'footL', 'footR']) st.minY = Math.min(st.minY, sk.tips[k === 'footL' ? 'toeL' : k === 'footR' ? 'toeR' : k][1]);
    for (const [a, b, L] of BONES) st.boneErr = Math.max(st.boneErr, Math.abs(len(P[a], P[b]) - L) / L);
    if (prev) {
      st.maxPelvis = Math.max(st.maxPelvis, len(P.pelvis, prev.pelvis)); st.maxHead = Math.max(st.maxHead, len(P.head, prev.head));
      for (const k in P) st.maxJoint = Math.max(st.maxJoint, len(P[k], prev[k]));
    }
    prev = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.slice()])); st.frames.push({ t, P: prev });
  }
  st.A = A; return st;
}

test('reacciones hurt_head/body/legs: arrancan y terminan en la guardia (sin pops), huesos intactos, sin atravesar el suelo', () => {
  for (const zone of ['head', 'body', 'legs']) {
    const r = run([[0.8, (A) => A.react(zone)]], 2.2);
    assert.ok(r.maxHead < 0.14, `${zone}: cabeza ${r.maxHead.toFixed(3)} m/frame`);
    assert.ok(r.maxPelvis < 0.07, `${zone}: pelvis ${r.maxPelvis.toFixed(3)} m/frame`);
    assert.ok(r.boneErr < 0.01, `${zone}: huesos ${r.boneErr}`);
    assert.ok(r.minY > -0.02, `${zone}: suelo ${r.minY}`);
    // vuelve: la última pose coincide con la de antes de la reacción (idle determinista, misma fase no, pero a < 6 cm)
    const base = run([], 2.2).frames; const a = r.frames.at(-1).P, b = base.at(-1).P;
    assert.ok(len(a.head, b.head) < 0.06 && len(a.handL, b.handL) < 0.06, `${zone}: no vuelve a guardia`);
    // y la reacción SE VE (>= 8 cm de cabeza o 5 cm de pelvis respecto de no reaccionar)
    const dev = Math.max(...r.frames.map((f, i) => Math.max(len(f.P.head, base[i].P.head), len(f.P.pelvis, base[i].P.pelvis))));
    assert.ok(dev > 0.08, `${zone}: reacción invisible ${dev}`);
  }
});

test('hurt_head tira la cabeza atrás, hurt_body dobla el torso adelante y hurt_legs baja la cadera', () => {
  const base = run([], 1.6).frames;
  const dev = (zone, f) => Math.max(...run([[0.8, (A) => A.react(zone)]], 1.6).frames.map((fr, i) => f(fr.P, base[i].P)));
  assert.ok(dev('head', (p, b) => b.head[0] - p.head[0]) > 0.04, 'cabeza atrás (-x)');
  assert.ok(dev('body', (p, b) => p.head[0] - b.head[0]) > 0.12 && dev('body', (p, b) => b.head[1] - p.head[1]) > 0.10, 'torso hacia adelante y hundido');
  assert.ok(dev('legs', (p, b) => b.pelvis[1] - p.pelvis[1]) > 0.10, 'cadera abajo');
});

test('power escala la reacción', () => {
  const base = run([], 1.6).frames; const m = (pw) => Math.max(...run([[0.8, (A) => A.react('body', { power: pw })]], 1.6).frames.map((f, i) => len(f.P.head, base[i].P.head)));
  assert.ok(m(1.0) > m(0.4) * 1.5);
});

test('rocked: sostenido, baja la guardia y se balancea; sale con cancel sin saltos', () => {
  const r = run([[0.5, (A) => A.play('rocked', { force: true })], [3.0, (A) => A.cancel(0.3)]], 4.5);
  assert.ok(r.ev.some((e) => e.type === 'clipHold' && e.name === 'rocked'));
  assert.ok(r.maxJoint < 0.10 && r.maxPelvis < 0.03, `pops rocked ${r.maxJoint} ${r.maxPelvis}`);
  const mid = r.frames.find((f) => f.t >= 2.0).P, g = run([], 4.5).frames.find((f) => f.t >= 2.0).P;
  assert.ok(g.handL[1] - mid.handL[1] > 0.2, 'manos abajo');
  const ys = r.frames.filter((f) => f.t > 1.5 && f.t < 2.9).map((f) => f.P.head[2]);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.03, 'vaivén lateral');
  const last = r.frames.at(-1).P; assert.ok(len(last.head, g.head) < 0.08, 'vuelve a guardia');
});

test('KO: cae de espaldas y queda tendido (todo a ras de suelo), sin pops fuera de la caída, sin atravesar el suelo', () => {
  const r = run([[0.5, (A) => A.play('ko', { force: true })]], 4);
  assert.ok(r.ev.some((e) => e.type === 'clipHold' && e.name === 'ko'));
  assert.ok(r.minY > -0.025, `suelo ${r.minY}`);
  assert.ok(r.boneErr < 0.01, `huesos ${r.boneErr}`);
  assert.ok(r.maxHead < 0.13 && r.maxPelvis < 0.06, `caída: cabeza ${r.maxHead} pelvis ${r.maxPelvis}`);
  const P = r.frames.at(-1).P;
  for (const k of ['pelvis', 'chest', 'head', 'handL', 'handR', 'kneeL']) assert.ok(P[k][1] < 0.45 || k === 'kneeL', `${k} y=${P[k][1]}`);
  assert.ok(P.head[1] < 0.35 && P.chest[1] < 0.3 && P.pelvis[1] < 0.25, 'tendido');
  assert.ok(P.head[0] < P.pelvis[0] - 0.5, 'cabeza hacia atrás (-x)');
  // quieto al final (hold): < 3 mm/frame
  const a = r.frames.at(-2).P, b = r.frames.at(-1).P; assert.ok(len(a.head, b.head) < 0.003);
});

test('getUp: arranca exactamente donde queda ko (sin salto), termina en guardia, sin pops ni suelo', () => {
  const r = run([[0.5, (A) => A.play('ko', { force: true })], [3.0, (A) => A.play('getUp', { force: true })]], 6);
  let worst = 0; for (let i = 1; i < r.frames.length; i++) if (r.frames[i].t > 2.9) worst = Math.max(worst, ...Object.keys(r.frames[i].P).map((k) => len(r.frames[i].P[k], r.frames[i - 1].P[k])));
  assert.ok(worst < 0.10, `salto máximo en getUp ${worst}`);
  const at = (t) => r.frames.find((f) => f.t >= t).P;
  assert.ok(len(at(3.0).head, at(2.98).head) < 0.02, 'sin salto al empezar');
  assert.ok(r.minY > -0.025, `suelo ${r.minY}`); assert.ok(r.boneErr < 0.01);
  assert.ok(r.frames.find((f) => f.t >= 3.9).P.head[1] > 0.7 && r.frames.find((f) => f.t >= 3.9).P.head[1] < 1.4, 'a mitad: en cuclillas');
  const g = run([], 6).frames.at(-1).P, e = r.frames.at(-1).P;
  assert.ok(len(e.head, g.head) < 0.06 && len(e.pelvis, g.pelvis) < 0.06, 'termina en guardia');
  assert.ok(r.ev.some((e) => e.type === 'clipEnd' && e.name === 'getUp'));
});

test('setState: guard, hurt (flanco por age), rocked, ko/down -> getUp, determinismo', () => {
  const play = () => { const A = createAnimator3D({ seed: 5 }); const names = []; let last = '';
    const seq = [[0.3, { hurt: { zone: 'head', age: 0.0 } }], [0.5, { hurt: { zone: 'head', age: 0.2 } }], [0.7, { hurt: { zone: 'body', age: 0.0 } }],
      [1.5, { rocked: true }], [2.5, { rocked: false }], [3.0, { stance: 'ko' }], [4.5, { stance: 'stand' }], [6.5, { stance: 'stand', guard: 1 }]];
    let si = 0, cur = {}; const dt = 1 / 60;
    for (let i = 0; i * dt < 8; i++) { const t = i * dt; while (si < seq.length && seq[si][0] <= t) cur = seq[si++][1]; A.setState(cur); A.update(dt, ROOT); const n = A.clip ? A.clipMode.name : '-'; if (n !== last) { names.push(n + '@' + t.toFixed(1)); last = n; } }
    return { names, A };
  };
  const a = play(), b = play();
  assert.deepEqual(a.names, b.names, 'determinista');
  const s = a.names.join(' ');
  assert.match(s, /hurt_head@0\.3/); assert.match(s, /hurt_body@0\.7/); assert.match(s, /rocked@/); assert.match(s, /ko@3\.0/); assert.match(s, /getUp@4\.5/);
  assert.equal((s.match(/hurt_head/g) || []).length, 1, 'un solo hurt_head (age creciente no re-dispara)');
  assert.ok(a.A.guard.target === 1);
});

test('clips de reacción registrados con duración, hold y compatibilidad con clipInfo', () => {
  const A = createAnimator3D({ seed: 1 });
  for (const n of ['hurt_head', 'hurt_body', 'hurt_legs', 'rocked', 'ko', 'getUp']) { assert.ok(CLIPS[n], n); assert.ok(A.clipInfo(n).duration > 0.3); }
  assert.ok(CLIPS.ko.hold && CLIPS.rocked.hold && CLIPS.getUp.from === 'ko');
  assert.ok(KO_END.hipPitch < -1.4);
});
