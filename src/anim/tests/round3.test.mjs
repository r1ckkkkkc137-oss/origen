// Ronda 3 (feedback de Rick): gancho real (codo fijo ~90°, alcance corto), guardia con columna vertical, hurt/KO/trepada sin saltos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hookMetrics, guardMetrics, climbMetrics, koMetrics, hurtMetrics, pelvisReach, REACH_IDEAL, rootReach } from '../../../scripts/anim-metrics.mjs';
import { HOOK_E } from '../clips.js';

test('gancho: el codo queda FIJO (~90°) de la carga al impacto (±10°) y el golpe no es un jab abierto', () => {
  const m = hookMetrics('hook', 'L');
  const [lo, hi] = m.elbowLoadToImpact;
  assert.ok(lo > 80 && hi < 100, `codo carga→impacto ${lo.toFixed(1)}–${hi.toFixed(1)}° debe estar en 80–100°`);
  assert.ok(hi - lo <= 10, `el codo varía ${(hi - lo).toFixed(1)}° (máx ±5° de la media; el requisito era ±10°)`);
  assert.ok(Math.abs(m.elbowImpact - HOOK_E * 180 / Math.PI) < 6, `codo en el impacto ${m.elbowImpact.toFixed(1)}°`);
});

test('gancho: alcance corto frente al cuerpo (pelvis→puño dentro de la ventana de Combate 0,70±0,08) y cerca del eje', () => {
  const m = hookMetrics('hook', 'L');
  assert.ok(m.reachShoulderMax < 0.6, `puño a ${m.reachShoulderMax.toFixed(2)} m del hombro como mucho (brazo plegado)`);
  // ronda 4: el húmero va abierto al costado (Rick), así que el puño pega a ~0,2 m al costado de la línea de la raíz (cara lateral de la cabeza del rival); ver round4
  assert.ok(Math.abs(m.latImpact) < 0.30, `desvío lateral respecto del centro de los hombros ${m.latImpact.toFixed(2)} m`);
  const r = pelvisReach('hook');
  assert.ok(r.ok, `pelvis→puño ${r.horiz.toFixed(2)} m vs ideal ${r.ideal}±${r.tol}`);
  assert.ok(m.hipRot >= 25, `rotación de cadera ${m.hipRot.toFixed(0)}°`);
  assert.ok(m.tHip < m.tSh && m.tSh < m.tFistPeak, 'cadena cinética cadera → hombros → puño');
  assert.ok(m.popMax < 0.2, `salto máx del gancho ${m.popMax.toFixed(3)} m/frame`);
});

test('jab y cross: la distancia 3D pelvis→puño al impacto cae en la ventana de Combate; low kick ≥ 0,7 m (limitado por la longitud de la pierna)', () => {
  for (const n of ['jab', 'cross']) { const r = pelvisReach(n); assert.ok(Math.abs(r.d3 - r.ideal) <= r.tol, `${n}: d3 ${r.d3.toFixed(2)} vs ${r.ideal}±${r.tol}`); }
  // ronda 4: el low kick se mide desde la RAÍZ (pelvis de la sim) con el paso del pie de apoyo: ver round4
  const k = rootReach('lowkick');
  assert.ok(k.ok, `lowkick raíz→espinilla ${k.rootHoriz.toFixed(2)}`);
});

test('guardia: columna casi vertical (<6° de inclinación) y mentón metido', () => {
  const g = guardMetrics();
  assert.ok(g.leanMax < 6, `inclinación de la columna ${g.leanMin.toFixed(1)}–${g.leanMax.toFixed(1)}° (antes ~10,6°)`);
  assert.ok(g.tot < 7, `desvío total de la vertical ${g.tot.toFixed(1)}°`);
  assert.ok(g.headFwd < 0.2, `cabeza ${g.headFwd.toFixed(2)} m por delante del cuello`);
});

test('trepada 1 m: el codo izquierdo salta < 5 cm/frame (antes 7,4) y el resto no empeora', () => {
  const p = climbMetrics();
  assert.ok(p.elbowL < 5, `elbowL ${p.elbowL} cm/frame`);
  assert.ok(p.elbowR < 8, `elbowR ${p.elbowR} cm/frame`);
});

test('hurt_cabeza / hurt_piernas / KO: sin saltos y con reacción visible', () => {
  const h = hurtMetrics('head', 1.0), l = hurtMetrics('legs', 4.0);
  assert.ok(h.popHead < 0.14 && h.popPelvis < 0.07, `hurt_head pops ${h.popHead.toFixed(3)}/${h.popPelvis.toFixed(3)}`);
  assert.ok(l.popPelvis < 0.07 && l.popMax < 0.14, `hurt_legs pops ${l.popPelvis.toFixed(3)}/${l.popMax.toFixed(3)}`);
  assert.ok(l.pelvisDrop > 0.12, `hurt_legs: la pelvis baja ${l.pelvisDrop.toFixed(2)} m (pierde el peso)`);
  assert.ok(Math.min(...l.kneeL) < 90 || Math.min(...l.kneeR) < 90, 'hurt_legs: la rodilla golpeada se dobla (<90°)');
  const k = koMetrics();
  assert.ok(k.popMax < 0.13, `KO: salto máx de cualquier articulación ${k.popMax.toFixed(3)} m/frame`);
  assert.ok(k.kneeRrelHipMax < 0.25, `KO: la rodilla trasera sube ${k.kneeRrelHipMax.toFixed(2)} m sobre la cadera`);
});
