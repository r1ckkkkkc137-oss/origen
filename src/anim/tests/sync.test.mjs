// API de sincronía con la sim: play(name,{speed,duration,impactIn}), playAt(name,phase01,simImpact01), cancel(), clipInfo(), eventos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimator3D } from '../animator3d.js';

const DT = 1 / 60, ROOT = { pos: [0, 0, 0], yaw: 0 };
const mk = () => { const a = createAnimator3D({ seed: 3 }); for (let i = 0; i < 90; i++) a.update(DT, ROOT); return a; };
const reach = (a) => { const f = a.strike.fist, p = a.skeleton.pose.chest; return Math.hypot(f[0] - p[0], f[2] - p[2]); };
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function run(a, seconds, each) {
  const evs = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) { a.update(DT, ROOT); for (const e of a.events) evs.push({ ...e, t: (i + 1) * DT }); if (each) each(i, a); }
  return evs;
}

test('play(name) sin opciones: compatible (1x, 0.46 s, bloquea mientras hay clip)', () => {
  const a = mk(); assert.equal(a.play('jab'), true); assert.equal(a.play('jab'), false);
  const ev = run(a, 0.6); const end = ev.find((e) => e.type === 'clipEnd'); const imp = ev.find((e) => e.type === 'impact');
  assert.ok(Math.abs(end.t - 0.46) < 0.03, `fin ${end.t}`); assert.ok(Math.abs(imp.t - 0.152) < 0.03, `impacto ${imp.t}`);
  assert.equal(a.play('nope'), false);
});

test('play(name,{speed}) y {duration}: escalan el clip entero', () => {
  let a = mk(); a.play('jab', { speed: 2 }); let ev = run(a, 0.5);
  assert.ok(Math.abs(ev.find((e) => e.type === 'clipEnd').t - 0.23) < 0.03);
  a = mk(); a.play('jab', { duration: 0.32 }); ev = run(a, 0.5);
  assert.ok(Math.abs(ev.find((e) => e.type === 'clipEnd').t - 0.32) < 0.03);
  assert.ok(Math.abs(ev.find((e) => e.type === 'impact').t - 0.152 * 0.32 / 0.46) < 0.03);
});

test('play(name,{impactIn,duration}): el impacto cae donde la sim lo pide (fin del windup) y el clip termina con la sim', () => {
  for (const [ti, tt] of [[0.10, 0.32], [0.18, 0.50], [0.06, 0.25]]) {
    const a = mk(); a.play('jab', { impactIn: ti, duration: tt }); const ev = run(a, tt + 0.2);
    const imp = ev.find((e) => e.type === 'impact'), end = ev.find((e) => e.type === 'clipEnd');
    assert.ok(Math.abs(imp.t - ti) <= DT * 1.5, `impacto ${imp.t} vs ${ti}`); assert.ok(Math.abs(end.t - tt) <= DT * 1.5, `fin ${end.t} vs ${tt}`);
  }
});

test('el puño llega a su máxima extensión en el impacto (no antes ni después) con tiempos deformados', () => {
  const a = mk(); a.play('jab', { impactIn: 0.10, duration: 0.32 }); let best = -1, bestT = 0;
  run(a, 0.32, (i, A) => { const r = reach(A); if (r > best) { best = r; bestT = (i + 1) * DT; } });
  assert.ok(Math.abs(bestT - 0.10) < 0.07, `pico de alcance en ${bestT}`);
});

test('playAt: conducido por la fase de la sim; el impacto cae en simImpact01; termina solo en 1', () => {
  const a = mk(); const total = 0.5, simImp = 0.3; let impactAt = null, ended = false;
  for (let i = 0; i <= 40; i++) {
    const ph = Math.min(1, (i * DT) / total); a.playAt('jab', ph, simImp); a.update(DT, ROOT);
    for (const e of a.events) { if (e.type === 'impact' && impactAt == null) impactAt = ph; if (e.type === 'clipEnd') ended = true; }
  }
  assert.ok(Math.abs(impactAt - simImp) < 0.05, `impacto en fase sim ${impactAt}`); assert.ok(ended); assert.equal(a.clip, null);
});

test('playAt sin refrescar (la sim se cayó): se cancela solo con fundido, sin salto', () => {
  const a = mk(); a.playAt('jab', 0.3); let prev = null, worst = 0, ended = false;
  for (let i = 0; i < 60; i++) { a.update(DT, ROOT); if (a.events.some((e) => e.type === 'clipEnd')) ended = true; const f = a.skeleton.tips.handL.slice(); if (prev) worst = Math.max(worst, d3(f, prev)); prev = f; }
  assert.ok(ended); assert.ok(worst < 0.13, `salto máx ${worst}`);
});

test('cancel(): fundido a la guardia sin salto mayor que la velocidad del propio golpe (<13 cm/frame)', () => {
  const a = mk(); a.play('jab'); run(a, 0.14); let prev = a.skeleton.tips.handL.slice(), worst = 0;
  a.cancel(0.12); run(a, 0.4, (i, A) => { const f = A.skeleton.tips.handL; worst = Math.max(worst, d3(f, prev)); prev = f.slice(); });
  assert.ok(worst < 0.13, `salto máx ${worst}`); assert.equal(a.clip, null);
});

test('play(...,{force:true}) interrumpe el clip activo con fundido; clipInfo da duración e impacto', () => {
  const a = mk(); a.play('jab'); run(a, 0.1); assert.equal(a.play('jab', { force: true }), true);
  const i = a.clipInfo('jab'); assert.equal(i.duration, 0.46); assert.ok(i.impact01 > 0.2 && i.impact01 < 0.45); assert.ok(i.active01[0] < i.impact01 && i.active01[1] > i.impact01);
});

test('determinismo con clips sincronizados', () => {
  const go = () => { const a = mk(); a.play('jab', { impactIn: 0.1, duration: 0.32 }); const out = []; run(a, 0.5, (i, A) => out.push(A.skeleton.tips.handL.map((v) => +v.toFixed(9)).join())); return out.join('|'); };
  assert.equal(go(), go());
});
