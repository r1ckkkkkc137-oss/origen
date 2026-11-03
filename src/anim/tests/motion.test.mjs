import test from 'node:test';
import assert from 'node:assert/strict';
import { run, d3, SC, clone } from './helpers.mjs';
import { createAnimator3D } from '../index.js';

const maxPop = (name, { skip = true } = {}) => {
  const { frames, strike } = run(name); let m = 0, where = '';
  for (let i = 1; i < frames.length; i++) {
    if (skip && (strike[i] || strike[i - 1])) continue;
    for (const k in frames[i].pose) { const d = d3(frames[i].pose[k], frames[i - 1].pose[k]); if (d > m) { m = d; where = `${k}@${(i / 60).toFixed(2)}s`; } }
  }
  return { m, where };
};

test('determinismo: misma semilla + mismo input => pose idéntica bit a bit; otra semilla difiere en el idle', () => {
  const a = run('turnWalk', { seed: 5 }).frames, b = run('turnWalk', { seed: 5 }).frames, c = run('guard', { seed: 6 }).frames, d = run('guard', { seed: 5 }).frames;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(c), JSON.stringify(d));
  // el dt no cambia el resultado cualitativo (sin Math.random en el sim)
  const src = ['animator3d', 'footplacement', 'clips', 'skeleton3d', 'ik', 'math3'];
  return Promise.all(src.map(async (f) => { const t = (await import('node:fs')).readFileSync(new URL(`../${f}.js`, import.meta.url), 'utf8'); assert.ok(!/Math\.random|Date\.now|performance\.now/.test(t), `${f} usa fuente no determinista`); }));
});

for (const [name, lim] of [['guard', 1], ['walk', 4.5], ['turn90', 4.5], ['turnWalk', 4.5], ['step', 5]]) {
  test(`sin pops: ${name} (<= ${lim} cm/frame a 60 fps fuera del golpe)`, () => {
    const { m, where } = maxPop(name);
    console.log(`  ${name}: pop max ${(m * 100).toFixed(2)} cm/frame (${where})`);
    assert.ok(m * 100 <= lim, `pop ${(m * 100).toFixed(2)} cm en ${where}`);
  });
}

test('salto de rumbo de 90° en un frame: sin pop >4 cm/frame, sin deslizar pies plantados, el rumbo verdadero no se toca', () => {
  const { frames, feet } = run('turn90'); let m = 0, slide = 0; const last = {};
  for (let i = 1; i < frames.length; i++) {
    for (const k in frames[i].pose) m = Math.max(m, d3(frames[i].pose[k], frames[i - 1].pose[k]));
    feet[i].forEach((ft) => { const p = frames[i].pose['foot' + ft.side]; if (ft.planted && last[ft.side]) slide = Math.max(slide, Math.hypot(p[0] - last[ft.side][0], p[2] - last[ft.side][2])); last[ft.side] = ft.planted ? p.slice() : null; });
  }
  const yawTrue = frames.map((f) => f.root.yaw), vis = frames.map((f) => f.visualYaw);
  assert.equal(yawTrue[frames.length - 1], Math.PI / 2);
  const t90 = vis.findIndex((v, i) => i > 90 && Math.abs(v - Math.PI / 2) < 0.05) / 60;
  const pivots = new Set(feet.flatMap((f, i) => (i > 90 ? f.filter((x) => !x.planted).map((x) => x.side + Math.floor(i / 20)) : []))).size;
  console.log(`  turn90: pop max ${(m * 100).toFixed(2)} cm/frame, deslizamiento planted ${(slide * 1000).toFixed(3)} mm, rumbo visual alcanza 90° en t=${t90.toFixed(2)} s (salto del sim en 1.50 s)`);
  assert.ok(m * 100 < 4, `pop ${m * 100}`); assert.ok(slide < 0.001); assert.ok(vis[91] < 0.2, 'el rumbo visual no salta de golpe'); assert.ok(Math.abs(vis[frames.length - 1] - Math.PI / 2) < 0.01);
  assert.ok(pivots > 0, 'debe dar pasos de pivote');
});

test('jab: cadena cinética (cadera -> torso -> puño), snap, retroceso, transferencia de peso, fuera del golpe sin pops', () => {
  const frames = [], A = createAnimator3D({ seed: 1 }); const fist = [], hip = [], sh = [], ev = [];
  const root = { pos: [0, 0, 0], yaw: 0 };
  for (let i = 0; i < 90; i++) A.update(1 / 60, root);
  const t0 = A.t; A.play('jab');
  for (let i = 0; i < 80; i++) {
    const sk = A.update(1 / 60, root);
    const yawOf = (a, b) => Math.atan2(-(b[2] - a[2]), b[0] - a[0]);   // rumbo de la línea a->b respecto a +X
    hip.push(yawOf(sk.pose.hipL, sk.pose.hipR)); sh.push(yawOf(sk.pose.shoulderL, sk.pose.shoulderR)); fist.push(sk.pose.handL.slice()); frames.push(clone(sk));
  }
  // L = mano adelantada (puño del jab). Extensión = distancia hombro->mano.
  const ext = frames.map((f) => d3(f.pose.shoulderL, f.pose.handL));
  const iMax = ext.indexOf(Math.max(...ext));
  const peak = (arr) => { const base = arr[0]; let k = 0, v = 0; arr.slice(0, 40).forEach((x, i) => { if (Math.abs(x - base) > v) { v = Math.abs(x - base); k = i; } }); return { k, v }; };
  const pH = peak(hip), pS = peak(sh);
  const rise = (arr, frac) => { const base = arr[0], tgt = base + (arr[iMax] - base) * frac; return arr.findIndex((x) => (x - base) * Math.sign(tgt - base) >= Math.abs(tgt - base)); };
  const first = (arr, thr) => arr.findIndex((x) => Math.abs(x - arr[0]) > thr);
  const hipStart = first(hip, 0.02), shStart = first(sh, 0.02), fistStart = ext.findIndex((x) => x > ext[0] + 0.03);
  console.log(`  jab: extensión ${(ext[0] * 100).toFixed(0)} -> ${(ext[iMax] * 100).toFixed(0)} cm en frame ${iMax} (${(iMax / 60 * 1000).toFixed(0)} ms), rotación cadera pico ${(pH.v * 57.3).toFixed(1)}° @${pH.k}, hombros ${(pS.v * 57.3).toFixed(1)}° @${pS.k}; inicio cadera f${hipStart} hombros f${shStart} puño f${fistStart}`);
  assert.ok(ext[iMax] > ext[0] + 0.12, 'el brazo debe extenderse');
  assert.ok(hipStart <= shStart && shStart <= fistStart, 'cadera antes que hombros antes que puño');
  assert.ok(pH.v > 0.08 && pS.v > 0.12, 'rotación visible de cadera y hombros');
  assert.ok(A.strike && true);
  // vuelve a guardia
  assert.ok(Math.abs(ext[79] - ext[0]) < 0.03, 'recuperación a guardia');
  // el pie adelantado (L) recibe el peso: pelvis se desplaza hacia el lado/delante del pie lead durante el golpe
  const pel0 = frames[0].pose.pelvis, pelK = frames[iMax].pose.pelvis;
  assert.ok(pelK[0] - pel0[0] > 0.005, `la pelvis avanza hacia el pie lead (+X): ${(pelK[0] - pel0[0]) * 100} cm`);
});

test('jab: duración, pico de velocidad del puño y no-pops antes/después del golpe (blend)', () => {
  const { frames, strike } = run('jab'); let pre = 0, fistMax = 0;
  for (let i = 1; i < frames.length; i++) { for (const k in frames[i].pose) { const d = d3(frames[i].pose[k], frames[i - 1].pose[k]); if (!strike[i] && !strike[i - 1]) pre = Math.max(pre, d); else if (k === 'handL') fistMax = Math.max(fistMax, d); } }
  console.log(`  jab: pop fuera del golpe ${(pre * 100).toFixed(2)} cm/frame; velocidad máx del puño ${(fistMax * 100).toFixed(1)} cm/frame = ${(fistMax * 60).toFixed(1)} m/s`);
  assert.ok(pre * 100 <= 1); assert.ok(fistMax * 60 > 5 && fistMax * 60 < 14);
});

test('rendimiento: update() del animador < 0.5 ms por frame (CPU, un humanoide)', () => {
  const sc = SC.walk, A = createAnimator3D({ seed: 1, getBlock: sc.terrain, blockM: sc.blockM });
  for (let i = 0; i < 60; i++) A.update(1 / 60, sc.root(i / 60));
  const t0 = process.hrtime.bigint(); const N = 3000;
  for (let i = 0; i < N; i++) A.update(1 / 60, sc.root((i % 360) / 60 + 1));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`  update: ${(ms * 1000).toFixed(1)} µs/frame (${(1000 / ms).toFixed(0)} humanoides a 1 ms)`);
  assert.ok(ms < 0.5);
});
