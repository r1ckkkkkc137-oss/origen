// Guardia MMA (ortodoxa): métricas objetivas medidas en el esqueleto, + sin penetración de caras de bloque al pisar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, SCENARIOS } from '../scenarios.js';

const sub = (a, b) => a.map((v, i) => v - b[i]); const len = (a) => Math.hypot(...a); const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const flex = (a, b, c) => 180 - Math.acos(dot(sub(a, b), sub(c, b)) / len(sub(a, b)) / len(sub(c, b))) * 180 / Math.PI;
function guardEnd() { let last; simulate('guard', { duration: 2, onFrame: (t, sk, A) => { last = { sk, A }; } }); return last; }

test('guardia MMA: base, pie trasero ~45°, rodillas flexionadas, cadera baja, torso inclinado', () => {
  const { sk, A } = guardEnd(); const P = sk.pose, fw = A.feetWorld();
  const lateral = Math.abs(fw[0].pos[2] - fw[1].pos[2]), stagger = Math.abs(fw[0].pos[0] - fw[1].pos[0]);
  assert.ok(lateral > 0.30 && lateral < 0.55, `ancho de base ${lateral}`);
  assert.ok(stagger > 0.30 && stagger < 0.70, `paso adelantado ${stagger}`);
  const rearDeg = Math.abs(fw[1].yaw) * 180 / Math.PI;
  assert.ok(Math.abs(rearDeg - 45) <= 10, `pie trasero ${rearDeg}°`);
  for (const s of ['L', 'R']) { const f = flex(P['hip' + s], P['knee' + s], P['foot' + s]); assert.ok(f > 25 && f < 75, `flexión rodilla ${s} ${f}`); }
  assert.ok(P.pelvis[1] < 0.84, `cadera baja ${P.pelvis[1]}`);
  const tl = sub(P.head, P.pelvis); const lean = Math.atan2(Math.hypot(tl[0], tl[2]), tl[1]) * 180 / Math.PI;
  assert.ok(lean > 4 && lean < 25, `inclinación de torso ${lean}°`);
});

test('guardia MMA: manos a la altura de cara/mentón (no por encima de la cabeza), codos pegados a las costillas', () => {
  const { sk } = guardEnd(); const P = sk.pose, T = sk.tips;
  for (const s of ['L', 'R']) {
    assert.ok(T['hand' + s][1] >= P.head[1] - 0.02, `mano ${s} >= mentón`);
    assert.ok(T['hand' + s][1] <= T.headTop[1] + 0.02, `mano ${s} no sobre la coronilla (${T['hand' + s][1]} vs ${T.headTop[1]})`);
    assert.ok(len(sub(T['hand' + s], T.face)) < 0.30, `mano ${s} cerca de la cara`);
    const sh = P['shoulder' + s], el = P['elbow' + s];
    assert.ok(sh[1] - el[1] > 0.12, `codo ${s} bajo el hombro`);
    // codo no abierto: desplazamiento lateral hacia afuera respecto del hombro (eje hombro R->L)
    const u = sub(P.shoulderL, P.shoulderR); const un = u.map((v) => v / len(u)); const out = dot(sub(el, sh), un) * (s === 'L' ? 1 : -1);
    assert.ok(out < 0.10, `codo ${s} no abierto (${out.toFixed(3)} m hacia afuera)`);
  }
});

test('puños cortos: el segmento muñeca->puño (tip) mide ≤ 0.13 m (no parece un palo)', () => {
  const { sk } = guardEnd();
  for (const s of ['L', 'R']) assert.ok(len(sub(sk.tips['hand' + s], sk.pose['hand' + s])) <= 0.13);
});

test('sin penetración de caras laterales de bloque al pisar (step y step1m)', () => {
  for (const name of ['step', 'step1m']) {
    const sc = SCENARIOS[name], bm = sc.blockM; let bad = 0;
    simulate(name, { onFrame: (t, sk, A) => A.feetWorld().forEach((f) => {
      const p = sk.pose['foot' + f.side], yaw = f.yaw, fx = Math.cos(yaw), fz = -Math.sin(yaw), sx = -fz, sz = fx;
      for (const l of [-0.06, 0.05, 0.22]) for (const w of [-0.05, 0, 0.05]) {
        const x = p[0] + fx * l + sx * w, z = p[2] + fz * l + sz * w, y = p[1] - 0.08 + 0.006;
        if (sc.terrain(Math.floor(x / bm), Math.floor(y / bm), Math.floor(z / bm))) bad++;
      }
    }) });
    assert.equal(bad, 0, `${name}: ${bad} puntos de pie dentro de bloque`);
  }
});
