// Ronda 5 (Rick): jab/cross a 1,0 m pelvis-pelvis, KO sin el instante arrodillado-erguido, gancho >= 10 m/s desde la rotación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rec, rootReach, strikeSpeed, hookArmMetrics, koMetrics, koTiltMetrics, hookMetrics } from '../../../scripts/anim-metrics.mjs';
import { CLIPS, HITSTOP, HOOK, HOOK_A0, HOOK_A1, HOOK_E } from '../clips.js';
import { KO } from '../reactions.js';
import { DIM } from '../skeleton3d.js';
import { sampleTrack } from '../clips.js';

const sub = (a, b) => a.map((v, i) => v - b[i]), len = (a) => Math.hypot(...a);
const ang = (a, b, c) => { const u = sub(a, b), v = sub(c, b); return Math.acos(u.reduce((s, x, i) => s + x * v[i], 0) / len(u) / len(v)) * 180 / Math.PI; };

for (const [n, s] of [['jab', 'L'], ['cross', 'R']]) {
  test(`${n}: alcance horizontal raíz→puño 1,00±0,05 m al impacto, brazo de largo fijo y sin trabar, pico de velocidad y hit-stop en el impacto`, () => {
    const r = rootReach(n);
    assert.ok(Math.abs(r.rootHoriz - 1.0) <= 0.05, `${n}: ${r.rootHoriz.toFixed(3)} m`);
    assert.ok(r.pelvisFwd >= 0.08, `${n}: la pelvis entra ${r.pelvisFwd.toFixed(3)} m (paso/desliz del pie delantero)`);
    const c = CLIPS[n], R = rec(n, 240), i = R.findIndex((x) => x.cn === n && x.ct >= c.impactT - 1e-9), P = R[i].P;
    // sin brazo de goma: huesos de largo fijo y la IK llega (codo < 177°, no clavado en recto)
    assert.ok(Math.abs(len(sub(P['elbow' + s], P['shoulder' + s])) - DIM.upperArm) < 2e-3 && Math.abs(len(sub(P['hand' + s], P['elbow' + s])) - DIM.foreArm) < 2e-3, `${n}: largo de brazo`);
    const e = ang(P['shoulder' + s], P['elbow' + s], P['hand' + s]);
    assert.ok(e > 160 && e < 177, `${n}: codo ${e.toFixed(1)}°`);
    const v = strikeSpeed(n);
    assert.ok(Math.abs(v.peakClipT60 - c.impactT) < 1 / 60 + 1e-6 && v.atImpact60 >= 0.98 * v.peak60, `${n}: pico a ${v.peakClipT60} (impacto ${c.impactT})`);
    // hit-stop: el puño casi se frena durante HITSTOP (sólo lo empuja el peso que entra: pelvis/torso), < 15 % de la velocidad del impacto
    const j = R.findIndex((x) => x.cn === n && x.ct >= c.impactT + HITSTOP - 1e-9), vh = len(sub(R[j].fist, R[i].fist)) / HITSTOP;
    assert.ok(vh < 0.15 * v.atImpact60, `${n}: ${vh.toFixed(2)} m/s en el hit-stop vs ${v.atImpact60.toFixed(1)} al impacto`);
  });
}

test('KO: desde que apoya las rodillas el torso nunca queda a menos de 35° de la vertical; cae hacia atrás y al costado, peso muerto sin IK', () => {
  const t = koTiltMetrics();
  assert.ok(t.tiltMinAfterKneel >= 35, `torso mínimo tras apoyar rodillas ${t.tiltMinAfterKneel.toFixed(1)}° (a ${t.tiltMinT.toFixed(2)} s)`);
  assert.ok(t.backAtKneel > 0.1 && Math.abs(t.sideAtKneel) > 0.05, `atrás ${t.backAtKneel.toFixed(3)} / costado ${t.sideAtKneel.toFixed(3)} m al apoyar`);
  assert.ok(t.minJointY > -0.025, `suelo ${t.minJointY.toFixed(3)} (${t.minJoint})`);
  // inclinación monótona (no vuelve a erguirse) mientras cae: nunca recupera más de 3°
  const R = rec('ko', 60).filter((r) => r.t >= 1.15 && r.t <= 1.84);
  const tl = R.map((r) => { const v = sub(r.P.neck, r.P.pelvis); return Math.acos(v[1] / len(v)) * 180 / Math.PI; });
  let mx = 0; for (const x of tl) { assert.ok(x > mx - 3, `el torso se vuelve a erguir: ${x.toFixed(1)}° tras ${mx.toFixed(1)}°`); mx = Math.max(mx, x); }
  assert.ok(sampleTrack(KO.tracks.kw, 0.12) > 0.99, 'piernas por FK (sin IK) desde 0,12 s');
  const k = koMetrics();
  assert.ok(k.kneeRrelHipMax <= 0.05, `rodilla R sobre la cadera ${k.kneeRrelHipMax.toFixed(3)} m`);
  assert.ok(k.popMax <= 0.13, `salto máx ${k.popMax.toFixed(3)} m/frame`);
});

test('gancho: >= 10 m/s a 60 Hz en el impacto sin perder la L; la velocidad sale de cadera/torso (el brazo no cambió)', () => {
  const v = strikeSpeed('hook');
  assert.ok(v.atImpact60 >= 10 && Math.abs(v.peakClipT60 - HOOK.impactT) < 1 / 60 + 1e-6, `gancho ${v.atImpact60.toFixed(2)} m/s al impacto (pico ${v.peak60.toFixed(2)} a ${v.peakClipT60})`);
  const m = hookArmMetrics();
  assert.ok(m.abduction >= 80 && m.humerusVsFacing >= 60 && Math.abs(m.elbow - 90) <= 6, `abd ${m.abduction.toFixed(1)} húmero-rival ${m.humerusVsFacing.toFixed(1)} codo ${m.elbow.toFixed(1)}`);
  const r = rootReach('hook'); assert.ok(r.rootHoriz >= 0.62, `alcance ${r.rootHoriz.toFixed(3)}`);   // ronda 6: 0,85–0,88 con la entrada (round6.test.mjs)
  // el brazo es el de r4 (mismo snap de hombro y codo); lo que creció es el giro de cadera y hombros
  assert.equal(HOOK_A0, 110 * Math.PI / 180); assert.equal(HOOK_A1, 97 * Math.PI / 180); assert.equal(HOOK_E, 90 * Math.PI / 180); assert.equal(HOOK.lock.snap0, 0.13);
  const h = hookMetrics('hook', 'L');
  assert.ok(h.hipRot >= 38 && h.shRot >= 36, `giro cadera ${h.hipRot.toFixed(1)}° hombros ${h.shRot.toFixed(1)}° (r4: 33/31)`);
  assert.ok(h.tHip < h.tSh && h.tSh < h.tFistPeak, 'cadena cadera → hombros → puño');
});
