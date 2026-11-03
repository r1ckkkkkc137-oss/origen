import test from 'node:test';
import assert from 'node:assert/strict';
import { run, d3, SC } from './helpers.mjs';
import { DIM } from '../skeleton3d.js';

// suelo independiente (no usa el muestreador del animador): tope del bloque más alto bajo un punto
const topAt = (sc, x, z) => { const bm = sc.blockM; let iy = -1; for (let y = 0; y < 8; y++) if (sc.terrain(Math.floor(x / bm), y, Math.floor(z / bm))) iy = y; return (iy + 1) * bm; };
const footTop = (sc, p, yaw) => { const fx = Math.cos(yaw), fz = -Math.sin(yaw); return Math.max(topAt(sc, p[0] - fx * 0.06, p[2] - fz * 0.06), topAt(sc, p[0], p[2]), topAt(sc, p[0] + fx * DIM.foot, p[2] + fz * DIM.foot)); };

for (const name of ['guard', 'walk', 'step', 'step1m', 'turnWalk']) {
  test(`pies sobre la cara superior del bloque (<1 cm) y sin deslizar: ${name}`, () => {
    const sc = SC[name]; const { frames, feet } = run(name);
    let worst = 0, slide = 0, planted = 0, climbed = 0; const last = {};
    frames.forEach((f, i) => feet[i].forEach((ft) => {
      const pose = f.pose['foot' + ft.side];
      if (!ft.planted) { last[ft.side] = null; return; }
      planted++;
      const sole = pose[1] - DIM.ankleH, want = footTop(sc, [pose[0], 0, pose[2]], ft.yaw0 ?? yawOf(ft));
      worst = Math.max(worst, Math.abs(sole - want)); if (want > 0.4) climbed++;
      const l = last[ft.side]; if (l) slide = Math.max(slide, Math.hypot(pose[0] - l[0], pose[2] - l[2]), Math.abs(pose[1] - l[1])); last[ft.side] = pose.slice();
    }));
    console.log(`  ${name}: pie plantado error de altura max ${(worst * 1000).toFixed(3)} mm, deslizamiento max ${(slide * 1000).toFixed(3)} mm, frames plantados ${planted}, sobre bloque alto ${climbed}`);
    assert.ok(planted > 100); assert.ok(worst < 0.01, `error ${worst}`); assert.ok(slide < 0.001, `desliza ${slide}`);
    if (name.startsWith('step')) assert.ok(climbed > 60, 'los pies deben llegar a subirse a la plataforma');
  });
}
function yawOf(ft) { return ft.yaw; }

test('escalón de 1 bloque: la pelvis baja hacia el pie más bajo y la rodilla nunca se invierte', () => {
  for (const name of ['guard', 'walk', 'step', 'turnWalk']) {
    const { frames, feet } = run(name); let worstInv = 0;
    frames.forEach((f, i) => {
      for (const s of ['L', 'R']) {
        const yw = feet[i].find((q) => q.side === s).yaw, fwd = [Math.cos(yw), -Math.sin(yw)];   // la rodilla apunta hacia donde apunta el pie
        const h = f.pose['hip' + s], k = f.pose['knee' + s], a = f.pose['foot' + s];
        const m = [(h[0] + a[0]) / 2, (h[1] + a[1]) / 2, (h[2] + a[2]) / 2];
        const fw = (k[0] - m[0]) * fwd[0] + (k[2] - m[2]) * fwd[1];   // desplazamiento de rodilla hacia delante respecto a la cuerda cadera-tobillo
        worstInv = Math.min(worstInv, fw);
      }
    });
    assert.ok(worstInv > -0.005, `${name}: rodilla invertida ${worstInv}`);
  }
});

test('escalón: la pelvis se baja hacia el pie más bajo y sube con la plataforma', () => {
  const { frames, feet } = run('step'); let maxDrop = 0, risen = 0;
  frames.forEach((f, i) => {
    const lo = Math.min(f.pose.footL[1], f.pose.footR[1]), hi = Math.max(f.pose.footL[1], f.pose.footR[1]);
    if (hi - lo > 0.3) { const mid = (lo + hi) / 2; maxDrop = Math.max(maxDrop, (f.pose.pelvis[1] - (lo + 0.08 + 0.80))); risen++; }
  });
  assert.ok(risen > 5, 'hubo frames con un pie en cada nivel');
  assert.ok(maxDrop < 0.30, `la pelvis debe quedar cerca del pie bajo (+hip), exceso ${maxDrop}`);
});
