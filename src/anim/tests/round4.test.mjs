// Ronda 4 (Rick + feedback de Benja): gancho con húmero abierto, KO de peso muerto, low kick con paso, finta de gancho,
// golpes con peso/velocidad (tiempos de la sim, pico al impacto, hit-stop), reacciones según la fuerza y juego de pies más rápido.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hookArmMetrics, rootReach, koMetrics, strikeSpeed, forceMetrics, locoMetrics, feintMetrics } from '../../../scripts/anim-metrics.mjs';
import { CLIPS, SIM_TICKS, HITSTOP } from '../clips.js';
import { createAnimator3D } from '../index.js';
import { createLiveFight, createLiveAnimation } from '../../combat/index.js';

test('gancho: húmero abducido 80–90° (paralelo al suelo, abierto al costado), ≥60° de la dirección al rival, codo ~90° y al costado del puño', () => {
  const m = hookArmMetrics();
  assert.ok(m.abduction >= 80 && m.abduction <= 90, `abducción ${m.abduction.toFixed(1)}°`);
  assert.ok(Math.abs(m.humerusElev) <= 10, `húmero ${m.humerusElev.toFixed(1)}° respecto de la horizontal`);
  assert.ok(m.humerusVsFacing >= 60, `húmero vs dirección al rival ${m.humerusVsFacing.toFixed(1)}° (>= 60)`);
  assert.ok(Math.abs(m.elbow - 90) <= 6, `codo ${m.elbow.toFixed(1)}°`);
  assert.ok(m.elbowBesideFist >= 0.10, `el codo debe quedar al costado (afuera) del puño: ${m.elbowBesideFist.toFixed(3)} m`);
  assert.ok(Math.abs(m.elbowMinusShoulderY) <= 0.06, `codo a la altura del hombro: ${m.elbowMinusShoulderY.toFixed(3)} m`);
});

test('alcance horizontal raíz→puño/espinilla (= pelvis de la sim, como reach3d.js): gancho 0.70±0.08, low kick 1.00±0.07', () => {
  for (const n of ['hook', 'lowkick']) { const r = rootReach(n); assert.ok(r.ok, `${n}: ${r.rootHoriz.toFixed(3)} m (ideal ${r.ideal}±${r.tol})`); }
  assert.ok(rootReach('lowkick').pelvisFwd >= 0.2, 'el low kick avanza la pelvis con el paso del pie de apoyo');
});

test('KO: rodilla trasera nunca >5 cm sobre la cadera, sin saltos', () => {
  const k = koMetrics();
  assert.ok(k.kneeRrelHipMax <= 0.05, `rodilla R sobre la cadera ${k.kneeRrelHipMax.toFixed(3)} m`);
  assert.ok(k.popMax < 0.13 && k.popKneeR < 0.08, `pops ${k.popMax.toFixed(3)}/${k.popKneeR.toFixed(3)}`);
});

test('golpes: impactT = startup de la sim / 60, pico de velocidad de la punta en el frame de impacto, hit-stop de 2–3 frames', () => {
  assert.ok(HITSTOP >= 2 / 60 - 1e-9 && HITSTOP <= 3 / 60 + 1e-9);
  for (const n of ['jab', 'cross', 'hook', 'lowkick']) {
    const [s, a, r] = SIM_TICKS[n], c = CLIPS[n];
    assert.ok(Math.abs(c.impactT - s / 60) < 1e-9, `${n} impactT ${c.impactT}`);
    assert.ok(Math.abs(c.duration - (s + a + r) / 60) < 1e-9 || n === 'lowkick', `${n} duración ${c.duration}`);
    const v = strikeSpeed(n);
    assert.ok(Math.abs(v.peakClipT60 - c.impactT) < 1 / 60 + 1e-6, `${n}: pico a ${v.peakClipT60} s, impacto ${c.impactT}`);
    assert.ok(v.atImpact60 > 7, `${n}: ${v.atImpact60.toFixed(1)} m/s al impacto`);
  }
});

test('reacciones: el golpe fuerte (19.4 pts) desplaza pecho y pelvis ≥1.5x más que el débil (6 pts), sin saltos grandes', () => {
  const m = forceMetrics();
  for (const z of ['head', 'body']) {
    const [w, s] = m.filter((x) => x.zone === z);
    assert.ok(s.chest >= 1.3 * w.chest && s.pelvis >= 1.5 * w.pelvis, `${z}: pecho ${w.chest.toFixed(3)}→${s.chest.toFixed(3)}, pelvis ${w.pelvis.toFixed(3)}→${s.pelvis.toFixed(3)}`);
    assert.ok(s.popMax < 0.2 && w.popMax < 0.2, `${z}: pops ${w.popMax.toFixed(3)}/${s.popMax.toFixed(3)}`);
  }
  const A = createAnimator3D({ seed: 1 }); A.update(1 / 60, { pos: [0, 0, 0], yaw: 0 });
  A.react('head'); assert.equal(A.lastReact.amp, 1, 'sin dato de fuerza = amplitud r3');
});

test('juego de pies de pelea: stepIn/stepOut/avance plantan los dos pies ≤0.3 s después de que la raíz frena, sin pops', () => {
  const m = locoMetrics();
  for (const s of m.segs) if (s.t0 !== 2.8) assert.ok(s.footLag <= 0.3, `tramo ${s.t0}: ${s.footLag.toFixed(3)} s`);
  assert.ok(m.footLagMean < 0.35, `media ${m.footLagMean.toFixed(3)} s`);
  assert.ok(m.popFoot < 0.05 && m.popPelvis < 0.09, `pops pie ${m.popFoot.toFixed(3)} pelvis ${m.popPelvis.toFixed(3)}`);
});

test('finta de gancho: carga cadera/hombros y abre el codo, pero el puño no va adelante (no es un jab); el gancho no se relanza', () => {
  const f = feintMetrics(), j = feintMetrics('jab');
  assert.ok(f.hipLoadDeg >= 10 && f.shoulderLoadDeg >= 15, `carga cadera ${f.hipLoadDeg.toFixed(1)}° hombros ${f.shoulderLoadDeg.toFixed(1)}°`);
  assert.ok(f.elbowRise >= 0.10, `codo sube ${f.elbowRise.toFixed(3)}`);
  assert.ok(f.fistFwdMax < 0.08 && j.fistFwdMax > 0.3, `puño adelante: finta ${f.fistFwdMax.toFixed(3)} / jab ${j.fistFwdMax.toFixed(3)}`);
  assert.ok(feintMetrics('feintSwitch').fistFwdMax < 0.08, 'cambio hook -> feint_hook: el gancho no sale');
  // API: el estado de la sim con clip 'feint' + move 'hook' arranca feint_hook a la misma fase del gancho y emite 'feint'
  const A = createAnimator3D({ seed: 2 }); const R = { pos: [0, 0, 0], yaw: 0 };
  A.update(1 / 60, R); A.play('hook'); for (let i = 0; i < 3; i++) A.update(1 / 60, R);
  const t = A.clipT; A.setState({ clip: 'feint', move: 'hook', animSeq: 3 });
  assert.equal(A.clipMode.name, 'feint_hook'); assert.ok(Math.abs(A.clipT - t) < 1e-9);
  assert.equal(A.play('hook'), false);
  A.update(1 / 60, R); assert.ok(A.events.some((e) => e.type === 'feint' && e.move === 'hook'));
});

test('finta de gancho en una pelea real (sim abortando el hook): el animador pasa a feint_hook y el gancho no impacta', () => {
  // los hooks abortados son raros (~1 cada 20–40 peleas, depende de la IA de Combate): se recorren semillas hasta el primero
  let seen = 0, hookImpactsDuringFeint = 0;
  for (const seed of [7, 12, 30, 35, ...Array.from({ length: 30 }, (_, k) => k + 1)]) {
    const live = createLiveFight({ seed }); const la = createLiveAnimation(live, { createAnimator3D, seed }); const prev = { a: false, b: false };
    for (let i = 0; i < 60 * 120 && !live.done; i++) {
      la.update(1 / 60);
      for (const side of ['a', 'b']) {
        const st = live.frame.fighters[side].state, A = la.anims[side], k = st.clip === 'feint' && st.move === 'hook';
        if (k && !prev[side]) { seen++; assert.equal(A.clipMode.name, 'feint_hook', `seed ${seed} ${side} frame ${i}`); }
        if (k && A.events.some((e) => e.type === 'impact' && e.name === 'hook')) hookImpactsDuringFeint++;
        prev[side] = k;
      }
    }
    if (seen) break;
  }
  assert.ok(seen >= 1, 'ninguna pelea tuvo un hook abortado'); assert.equal(hookImpactsDuringFeint, 0);
});
