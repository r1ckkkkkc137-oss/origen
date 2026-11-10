// Golpes (jab con paso, cross, gancho, low kick) y bloqueo: cadena cinética, pies sin deslizar, alcance, determinismo, longitudes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, SCENARIOS } from '../scenarios.js';
import { CLIPS } from '../clips.js';
import { DIM } from '../skeleton3d.js';
import { createAnimator3D } from '../animator3d.js';
import { flat } from '../testTerrain.js';

const T0 = 1.5, HZ = 240;
const sub = (a, b) => a.map((v, i) => v - b[i]); const len = (a) => Math.hypot(...a); const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const angle = (a, b, c) => Math.acos(dot(sub(a, b), sub(c, b)) / len(sub(a, b)) / len(sub(c, b))) * 180 / Math.PI;
const unwrap = (a) => { for (let i = 1; i < a.length; i++) { while (a[i] - a[i - 1] > Math.PI) a[i] -= 2 * Math.PI; while (a[i] - a[i - 1] < -Math.PI) a[i] += 2 * Math.PI; } return a; };
const lineYaw = (P, a, b) => Math.atan2(P[b][2] - P[a][2], P[b][0] - P[a][0]);

function rec(name, hz = HZ) {
  const R = [];
  simulate(name, { hz, onFrame: (t, sk, A) => R.push({ t, P: Object.fromEntries(Object.entries(sk.pose).map(([k, v]) => [k, v.slice()])), root: sk.root.pos.slice(), fist: A.strike.fist.slice(), active: A.strike.active, feet: A.feetWorld(), tip: sk.tips }) });
  return R;
}
// instante (rel. a T0) en que una señal alcanza la fracción f de su recorrido total en la ventana del clip
// ronda 4: con carga (wind-up) la señal primero va al revés: el cruce se mide entre el extremo de la carga y el extremo del golpe
function cross(sig, R, f) {
  const a0 = sig[0]; let m = 0, im = 0; sig.forEach((v, i) => { if (Math.abs(v - a0) > Math.abs(m)) { m = v - a0; im = i; } });
  let lo = a0, il = 0; for (let i = 0; i < im; i++) if ((sig[i] - lo) * Math.sign(m) < 0) { lo = sig[i]; il = i; }
  const tgt = lo + (sig[im] - lo) * f; for (let i = il; i <= im; i++) if ((sig[i] - tgt) * Math.sign(m) >= 0) return R[i].t - T0;
  return R[im].t - T0;
}
function window(R, dur) { return R.filter((r) => r.t >= T0 - 0.1 && r.t <= T0 + dur); }

test('cadena cinética jab/cross/gancho: cadera -> hombros -> puño (orden y no simultáneos)', () => {
  for (const [name, dur] of [['jab', CLIPS.jab.duration], ['cross', CLIPS.cross.duration], ['hook', CLIPS.hook.duration]]) {
    const R = window(rec(name), dur);
    const hip = unwrap(R.map((r) => lineYaw(r.P, 'hipL', 'hipR'))), sh = unwrap(R.map((r) => lineYaw(r.P, 'shoulderL', 'shoulderR')));
    const sp = R.map((r, i) => (i && r.t > T0 + 0.03) ? len(sub(r.fist, R[i - 1].fist)) * HZ : 0);
    const tHip = cross(hip, R, 0.5), tSh = cross(sh, R, 0.5);
    let k = 0; sp.forEach((v, i) => { if (v > sp[k]) k = i; }); const tFist = R[k].t - T0;
    assert.ok(tHip < tSh + 1e-9, `${name}: cadera ${tHip.toFixed(3)} antes que hombros ${tSh.toFixed(3)}`);
    assert.ok(tSh < tFist, `${name}: hombros ${tSh.toFixed(3)} antes que el pico del puño ${tFist.toFixed(3)}`);
    assert.ok(tHip < tFist - 0.005, `${name}: cadera antes que el puño por >5 ms`);
    const total = Math.abs(hip[hip.length - 1] - hip[0]); void total;
  }
});

test('cross: rotación de cadera >=30°, brazo casi extendido; gancho: codo ~90° y horizontal; jab alcanza', () => {
  const at = (name, ti) => { const R = rec(name); return R.find((r) => r.t >= T0 + ti - 1e-9); };
  const rot = (name, dur) => { const R = window(rec(name), dur); const hip = unwrap(R.map((r) => lineYaw(r.P, 'hipL', 'hipR'))); return (Math.max(...hip) - Math.min(...hip)) * 180 / Math.PI; };
  assert.ok(rot('cross', CLIPS.cross.duration) >= 30, `cross cadera ${rot('cross', CLIPS.cross.duration)}°`);
  assert.ok(rot('hook', CLIPS.hook.duration) >= 25, `gancho cadera ${rot('hook', CLIPS.hook.duration)}°`);
  const c = at('cross', CLIPS.cross.impactT), P = c.P;
  assert.ok(angle(P.shoulderR, P.elbowR, P.handR) >= 140, `cross extendido ${angle(P.shoulderR, P.elbowR, P.handR)}`);
  const j = at('jab', CLIPS.jab.impactT).P; assert.ok(angle(j.shoulderL, j.elbowL, j.handL) >= 120, 'jab extendido');
  const h = at('hook', CLIPS.hook.impactT).P; const ea = angle(h.shoulderL, h.elbowL, h.handL);
  assert.ok(ea > 70 && ea < 115, `gancho codo ${ea}°`);
  assert.ok(Math.abs(h.elbowL[1] - h.shoulderL[1]) < 0.08, 'codo del gancho horizontal');
  assert.ok(Math.abs(h.handL[1] - h.shoulderL[1]) < 0.12, 'puño del gancho a la altura del hombro');
});

test('low kick: pie de apoyo pivota, cadera gira >=60°, la espinilla pega a la altura del muslo, vuelve a la guardia', () => {
  const R = rec('lowkick'); const w = window(R, CLIPS.lowkick.duration);
  const hip = unwrap(w.map((r) => lineYaw(r.P, 'hipL', 'hipR'))); assert.ok((Math.max(...hip) - Math.min(...hip)) * 180 / Math.PI >= 60, 'giro de cadera');
  const im = R.find((r) => r.t >= T0 + CLIPS.lowkick.impactT - 1e-9);
  const rel = sub(im.fist, im.root);
  assert.ok(rel[1] > 0.5 && rel[1] < 0.9, `altura del impacto (muslo) ${rel[1]}`);
  assert.ok(rel[0] > 0.45, `alcance ${rel[0]}`);
  // el pie de apoyo giró sobre la bola >= 60°
  const yaws = w.map((r) => r.feet[0].yaw); assert.ok((Math.max(...yaws) - Math.min(...yaws)) * 180 / Math.PI >= 60, 'pivote del pie de apoyo');
  // el pie que patea recorre una trayectoria rápida (pico) después del giro de cadera
  const sp = w.map((r, i) => (i && r.t > T0 + 0.05) ? len(sub(r.fist, w[i - 1].fist)) * HZ : 0); let k = 0; sp.forEach((v, i) => { if (v > sp[k]) k = i; });
  const hs = hip.map((v, i) => i ? Math.abs(v - hip[i - 1]) : 0); let kh = 0; hs.forEach((v, i) => { if (v > hs[kh]) kh = i; });
  assert.ok(w[k].t > w[kh].t, 'la patada pega después del pico de giro de cadera');
  assert.ok(sp[k] > 8, `velocidad de la patada ${sp[k]} m/s`);
  // vuelve a la guardia
  const end = R[R.length - 1], base = R[Math.round((T0 - 0.2) * HZ)];
  assert.ok(len(sub(end.P.footR, base.P.footR)) < 0.06 && len(sub(end.P.footL, base.P.footL)) < 0.06, 'pies de vuelta en la guardia');
});

test('pies sin deslizar: pie plantado (punto de apoyo / bola del pie) fijo, también en pivotes y en el paso del jab', () => {
  for (const name of ['jab', 'cross', 'hook', 'lowkick', 'block']) {
    const R = rec(name, 60);
    for (let s = 0; s < 2; s++) {
      let worst = 0;
      for (let i = 1; i < R.length; i++) { const a = R[i - 1].feet[s], b = R[i].feet[s]; if (a.planted && b.planted) worst = Math.max(worst, Math.hypot(b.contact[0] - a.contact[0], b.contact[2] - a.contact[2], b.contact[1] - a.contact[1])); }
      assert.ok(worst < 0.004, `${name} pie ${s} desliza ${worst * 100} cm/frame`);
    }
  }
});

test('paso del jab: pie adelantado avanza >=10 cm, sólo se mueve en el aire, el trasero no se mueve', () => {
  const R = rec('jab', 60); const w = window(R, CLIPS.jab.duration);
  const z0 = w[0].feet[0].pos[0], zmax = Math.max(...w.map((r) => r.feet[0].pos[0]));
  assert.ok(zmax - z0 >= 0.10, `avance ${zmax - z0}`);
  const rear = w.map((r) => r.feet[1].contact); assert.ok(Math.max(...rear.map((p) => len(sub(p, rear[0])))) < 0.01, 'pie trasero fijo (bola del pie; ronda 4: el talón sube al empujar)');
  for (let i = 1; i < w.length; i++) { const a = w[i - 1].feet[0], b = w[i].feet[0]; const mv = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]); if (mv > 0.004) assert.ok(!(a.planted && b.planted), 'se arrastró plantado'); }
  const end = R[R.length - 1].feet[0].pos; assert.ok(Math.abs(end[0] - z0) < 0.02, 'vuelve a su sitio');
});

test('sin penetración de suelo ni saltos en cabeza durante los clips; longitudes de hueso constantes; determinismo', () => {
  for (const name of ['jab', 'cross', 'hook', 'lowkick', 'block']) {
    const A1 = rec(name, 60), A2 = rec(name, 60);
    assert.deepEqual(A1.map((r) => r.P.handL), A2.map((r) => r.P.handL), `${name} determinista`);
    assert.deepEqual(A1.map((r) => r.fist), A2.map((r) => r.fist), `${name} fist determinista`);
    let minAnk = 9;
    for (const r of A1) { minAnk = Math.min(minAnk, r.P.footL[1], r.P.footR[1]); }
    assert.ok(minAnk > DIM.ankleH - 0.02, `${name}: tobillo bajo el suelo ${minAnk}`);
    for (const r of A1) {
      for (const s of ['L', 'R']) {
        assert.ok(Math.abs(len(sub(r.P['elbow' + s], r.P['shoulder' + s])) - DIM.upperArm) < 2e-3, `${name} brazo`);
        assert.ok(Math.abs(len(sub(r.P['hand' + s], r.P['elbow' + s])) - DIM.foreArm) < 2e-3, `${name} antebrazo`);
        assert.ok(Math.abs(len(sub(r.P['knee' + s], r.P['hip' + s])) - DIM.thigh) < 2e-3, `${name} muslo`);
        assert.ok(Math.abs(len(sub(r.P['foot' + s], r.P['knee' + s])) - DIM.shin) < 2e-3, `${name} espinilla`);
      }
    }
    let maxHead = 0; for (let i = 1; i < A1.length; i++) maxHead = Math.max(maxHead, len(sub(A1[i].P.head, A1[i - 1].P.head)));
    assert.ok(maxHead < 0.08, `${name}: salto de cabeza ${maxHead}`);
  }
});

test('bloqueo: setGuardLevel(1) sube las manos a la cara y baja el mentón; con 0 vuelve a la guardia; clip block vuelve solo', () => {
  const A = createAnimator3D({ seed: 3, getBlock: flat(), blockM: 0.5 }); const root = { pos: [0, 0, 0], yaw: 0 };
  const step = (n) => { let sk; for (let i = 0; i < n; i++) sk = A.update(1 / 60, root); return sk; };
  const snap = (sk) => ({ hL: sk.tips.handL.slice(), hR: sk.tips.handR.slice(), face: sk.tips.face.slice(), headY: sk.pose.head[1], chin: sk.pose.head.slice() });
  const g0 = snap(step(120));
  A.setGuardLevel(1); const g1 = snap(step(40));
  const dFace = (g) => Math.max(len(sub(g.hL, g.face)), len(sub(g.hR, g.face)));
  assert.ok(dFace(g1) < 0.26 && g1.hL[1] >= g1.face[1] - 0.03 && g1.hR[1] >= g1.face[1] - 0.03, `manos a la cara ${dFace(g0)} -> ${dFace(g1)}`);
  assert.ok(g1.hL[1] > g0.hL[1] + 0.04, 'manos más altas');
  assert.ok(g1.headY < g0.headY, 'cuerpo/mentón más bajos');
  A.setGuardLevel(0); const g2 = snap(step(60));
  assert.ok(len(sub(g2.hL, g0.hL)) < 0.03, 'vuelve a la guardia');
  assert.equal(A.play('block'), true); step(20); const mid = snap(step(1)); assert.ok(mid.hL[1] > g0.hL[1] + 0.025, 'clip block levanta manos'); step(60);
  assert.equal(A.clip, null, 'el clip block termina solo');
});
