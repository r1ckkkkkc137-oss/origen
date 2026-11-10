// Ronda 6 (Rick): contacto real golpe–rival (puño/espinilla paran en la superficie, clavado en el hit-stop) y gancho con entrada
// escalada por la distancia real (combat-gap: gap de pie >= 0,80 m; jab 0,97, cross 0,95, hook/uppercut ~0,85).
import test from 'node:test';
import assert from 'node:assert/strict';
import { duelMetrics, rootReach } from '../../../scripts/anim-metrics.mjs';
import { liveContact } from '../../../scripts/anim-live-contact.mjs';
import { CLIPS, HOOK, JAB, CROSS, LOWKICK, HITSTOP } from '../clips.js';
import { createAnimator3D, pairAnimators, pairedAnimatorFactory } from '../index.js';
import { simulate, simulateDuel, DUEL_DIST } from '../scenarios.js';
import { buildColliders, penetration, firstContact, pushOut, CONTACT } from '../contact.js';

const STR = ['jab', 'cross', 'hook', 'lowkick'];
const M = Object.fromEntries(STR.map((n) => [n, duelMetrics(n)]));

test('API de rival: setOpponent / pairAnimators / pairedAnimatorFactory (lo que usa Motor con createLiveAnimation)', () => {
  const f = pairedAnimatorFactory(); const a = f({ seed: 1 }), b = f({ seed: 2 }), c = f({ seed: 3 });
  assert.equal(a.opp, b); assert.equal(b.opp, a); assert.equal(c.opp, null);
  const [x, y] = pairAnimators(createAnimator3D(), createAnimator3D()); assert.equal(x.opp, y);
  x.setOpponent(null); assert.equal(x.opp, null);
  const sk = y.update(1 / 60, { pos: [1, 0, 0], yaw: Math.PI }); x.setOpponent(() => sk); assert.equal(typeof x.opp, 'function');
});

test('colisores del rival: cabeza esfera, torso/cuello/hombros/piernas cápsulas; primer contacto y salida por la normal', () => {
  const A = createAnimator3D({ seed: 3 }); const sk = A.update(1 / 60, { pos: [0, 0, 0], yaw: 0 });
  const cols = buildColliders(sk); assert.equal(cols.filter((c) => !c.guard).length, 8); assert.equal(cols.length, 12, 'r7: + guantes y antebrazos'); assert.equal(cols[0].kind, 'sph'); assert.equal(cols[0].zone, 'head');
  const h = cols[0].a, O = [h[0], h[1], h[2] - 0.6], T = [h[0], h[1], h[2] + 0.05];
  const fc = firstContact(cols, O, T, 0.02); assert.ok(fc && Math.abs(h[2] - fc.point[2] - (cols[0].r + 0.02)) < 0.003, 'el primer contacto es la superficie frontal');
  const behind = [h[0], h[1], h[2] + 0.30]; assert.ok(firstContact(cols, O, behind, 0.02), 'anti-túnel: un puño que quedó DETRÁS de la cabeza también se detecta');
  const p = h.slice(); p[2] += 0.03; pushOut(cols, p, 0.02); assert.ok(penetration(cols, p, 0.02).pen <= 1e-6);
});

test('penetración en el impacto <= 0,02 m (jab, cross, hook, low kick) a la distancia de conexión de combat-gap; antes atravesaban', () => {
  for (const n of STR) {
    const m = M[n];
    assert.ok(m.after.penImpact <= 0.02 && m.after.segImpact <= 0.02, `${n}: punta ${m.after.penImpact.toFixed(3)} miembro ${m.after.segImpact.toFixed(3)} m`);
    assert.ok(m.after.penMax <= 0.02 && m.after.segMax <= 0.02, `${n}: máx en el golpe ${m.after.penMax.toFixed(3)}/${m.after.segMax.toFixed(3)}`);
    assert.ok(m.contact && m.contact.zone === (n === 'lowkick' ? 'legs' : 'head') && Math.abs(m.contact.early) < 1 / 60 + 1e-6, `${n}: contacto ${JSON.stringify(m.contact)}`);
    assert.equal(m.dist, DUEL_DIST[n]);
  }
  for (const n of ['jab', 'cross', 'lowkick']) assert.ok(M[n].before.segImpact >= 0.03, `${n}: sin enlace el golpe atraviesa ${M[n].before.segImpact.toFixed(3)} m (el test ve el problema)`);
});

test('contacto sin saltos: ninguna articulación salta más que sin contacto (>0,13 m/frame sólo donde el golpe libre ya lo hacía); el golpeado <= 0,13', () => {
  for (const n of STR) {
    const m = M[n];
    assert.ok(m.jumpOther <= Math.max(0.13, m.jumpOtherBefore + 0.005), `${n}: resto del cuerpo ${m.jumpOther.toFixed(3)} (sin contacto ${m.jumpOtherBefore.toFixed(3)})`);
    assert.ok(m.jumpStrikeSide <= m.jumpStrikeSideBefore + (n === 'lowkick' ? 0.07 : 0.01), `${n}: brazo/pierna del golpe ${m.jumpStrikeSide.toFixed(3)} (libre ${m.jumpStrikeSideBefore.toFixed(3)})`);
    assert.ok(m.jumpDefender <= 0.13, `${n}: golpeado ${m.jumpDefender.toFixed(3)} (${m.jumpDefenderWho})`);
  }
  const p1 = duelMetrics('cross', { power: 1 }); assert.ok(p1.jumpDefender <= 0.13, `power 1: ${p1.jumpDefender.toFixed(3)}`);
  for (const n of ['jab', 'cross', 'hook']) assert.ok(M[n].speedImpact60 >= 10, `${n}: llega a ${M[n].speedImpact60.toFixed(1)} m/s al impacto (el ajuste frena de forma continua)`);
});

test('hit-stop: la mano queda clavada en el punto de impacto HITSTOP s y luego suelta suave; acompaña el retroceso <= 6 cm', () => {
  const R = [];
  simulateDuel('cross', { onFrame: (t, sa, sb, a) => R.push({ t, ct: a.clip ? a.clipT : -1, pin: a.contact.pin ? { ...a.contact.pin, p: a.contact.pin.p.slice() } : null, fist: a.strike.fist.slice() }) });
  const on = R.filter((r) => r.pin && !r.pin.done);
  assert.ok(on.length >= 2 && on.length <= 5, `frames clavado ${on.length}`);
  const p0 = on[0].pin.p, pl = on[on.length - 1].pin.p; assert.ok(Math.hypot(pl[0] - p0[0], pl[1] - p0[1], pl[2] - p0[2]) <= 0.061);
  assert.ok(on[0].ct >= CLIPS.cross.impactT - 1e-9 - 1 / 60 && on[on.length - 1].t - on[0].t <= HITSTOP + 2 / 60);
});

test('gancho con entrada: sin rival alcance raíz→puño 0,85–0,88 (paso del pie delantero + pelvis), la L se mantiene, >=10 m/s', () => {
  const r = rootReach('hook'); assert.ok(r.rootHoriz >= 0.85 && r.rootHoriz <= 0.88, `alcance ${r.rootHoriz.toFixed(3)}`);
  assert.ok(r.pelvisFwd >= 0.15, `la pelvis entra ${r.pelvisFwd.toFixed(3)} m`);
  const fz = HOOK.entry.tracks.fLz.reduce((m, k) => Math.max(m, k[1]), 0); assert.ok(fz >= 0.15, 'paso del pie delantero');
  const m = M.hook;
  assert.ok(m.L.abduction >= 80 && m.L.humerusVsFacing >= 60 && Math.abs(m.L.elbow - 90) <= 6, `L con rival a 0,85: ${JSON.stringify(m.L)}`);
  assert.ok(m.speedImpact60 >= 10, `${m.speedImpact60.toFixed(2)} m/s`);
  assert.ok(m.entryK > 0.4 && m.entryK <= 1.1, `k ${m.entryK.toFixed(2)} (escala por la profundidad real de la cabeza del rival)`);
});

test('gancho: si la sim mete la raíz hasta ~0,70 la entrada se apaga sola (no se duplica ni se pasa) y no atraviesa', () => {
  const m = duelMetrics('hook', { closeTo: 0.70 });
  assert.ok(m.rootDistImpact < 0.72, `raíz a ${m.rootDistImpact.toFixed(3)}`);
  assert.ok(m.entryK <= 0.15, `k ${m.entryK.toFixed(2)}`);
  assert.ok(m.after.penImpact <= 0.02 && m.after.segMax <= 0.02, `pen ${m.after.penImpact.toFixed(3)} seg ${m.after.segMax.toFixed(3)}`);
  assert.ok(m.L.abduction >= 80 && m.L.humerusVsFacing >= 60 && Math.abs(m.L.elbow - 90) <= 8, `L ${JSON.stringify(m.L)}`);
  const far = createAnimator3D({ seed: 7, entryDist: 0.70 }), near = createAnimator3D({ seed: 7, entryDist: 0.86 });
  for (const A of [far, near]) { for (let i = 0; i < 70; i++) { if (i === 60) A.play('hook'); A.update(1 / 60, { pos: [0, 0, 0], yaw: 0 }); } }
  assert.ok(far.clipMode.entryK === 0 && Math.abs(near.clipMode.entryK - 1) < 1e-6, 'sin esqueleto rival: k por distancia (0,70 -> 0, 0,86 -> 1)');
});

test('ajuste al blanco: la punta libre en el impacto sigue coincidiendo con clip.aim.ref (si se toca un clip, hay que remedir)', () => {
  for (const [n, c] of [['jab', JAB], ['cross', CROSS], ['lowkick', LOWKICK]]) {
    let tip = null; simulate(n, { onFrame: (t, sk, A) => { if (!tip && A.clip && A.clipT >= c.impactT - 1e-9) { const f = A.strike.fist, r = sk.root.pos; tip = [-(f[2] - r[2]), f[1], f[0] - r[0]]; } } });
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(tip[k] - c.aim.ref[k]) <= 0.03, `${n}[${k}] ${tip[k].toFixed(3)} vs ${c.aim.ref[k]}`);
  }
  for (const [ed, ref] of [[0.70, HOOK.aim.ref], [0.86, HOOK.aim.ref1]]) {
    const A = createAnimator3D({ seed: 7, entryDist: ed }); let tip = null;
    for (let i = 0; i < 90; i++) { if (i === 60) A.play('hook'); A.update(1 / 60, { pos: [0, 0, 0], yaw: 0 }); if (!tip && A.clip && A.clipT >= HOOK.impactT - 1e-9) { const f = A.strike.fist; tip = [-f[2], f[1], f[0]]; } }
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(tip[k] - ref[k]) <= 0.02, `hook d=${ed} [${k}] ${tip[k].toFixed(3)} vs ${ref[k]}`);
  }
});

test('state.hurt.power manda la fuerza de la reacción; sin power, respaldo por daño; el lado del contacto orienta el retroceso', () => {
  const A = createAnimator3D({ seed: 2 }); A.update(1 / 60, { pos: [0, 0, 0], yaw: 0 });
  A.setState({ hurt: { zone: 'head', age: 0, power: 0.9 } }); assert.equal(A.lastReact.power, 0.9);
  const B = createAnimator3D({ seed: 2 }); B.update(1 / 60, { pos: [0, 0, 0], yaw: 0 });
  B.setState({ damage: { head: 0 } }); B.setState({ hurt: { zone: 'head', age: 0 }, damage: { head: 0.2 } }); assert.ok(B.lastReact.power > 0, 'respaldo: salto de daño');
  const lats = {};
  for (const n of ['jab', 'hook', 'cross']) { let L = null; simulateDuel(n, { onFrame: (t, sa, sb, a, b) => { if (!L && b.lastReact) L = b.lastReact.lat; } }); lats[n] = L; }
  assert.ok(lats.hook >= 0.9, `gancho de izquierda pega en mi derecha: retroceso lateral completo (${lats.hook})`);
  assert.ok(Math.abs(lats.jab) < 0.9 && Math.abs(lats.jab) >= 0.35, `jab al centro: lateral reducido (${lats.jab})`);
});

test('sin rival enlazado no cambia nada (hojas del visor, tests previos): corrección siempre 0', () => {
  let mx = 0; simulate('jab', { onFrame: (t, sk, A) => { mx = Math.max(mx, Math.hypot(...A.contact.d), Math.abs(A.contact.aim)); } });
  assert.equal(mx, 0);
});

test('pelea real (createLiveAnimation + pairedAnimatorFactory): punta <= 0,02 m dentro del rival en el impacto, conecta', () => {
  const r = liveContact({ seeds: [1, 2, 3] });
  for (const n of ['jab', 'cross', 'lowkick']) {
    const p = r.per[n]; assert.ok(p && p.n > 0, n);
    assert.ok(p.penImpactMax <= 0.02, `${n}: ${p.penImpactMax.toFixed(3)} m`);
    assert.ok(p.contacts > 0, `${n}: ${p.contacts} contactos`);
  }
});
