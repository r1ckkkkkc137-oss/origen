import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBone } from '../ik.js';
import { createRng } from '../../shared/rng.js';
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('IK: alcanzable => efector a <1 mm del objetivo, longitudes de hueso intactas', () => {
  const r = createRng(42); let n = 0, worst = 0, worstLen = 0;
  for (let i = 0; i < 20000; i++) {
    const l1 = 0.25 + r.next() * 0.3, l2 = 0.25 + r.next() * 0.3;
    const root = [r.next() * 4 - 2, r.next() * 4 - 2, r.next() * 4 - 2];
    const dist = Math.abs(l1 - l2) + 0.01 + r.next() * ((l1 + l2) * 0.99 - Math.abs(l1 - l2) - 0.01);
    let dir = [r.next() * 2 - 1, r.next() * 2 - 1, r.next() * 2 - 1]; const dl = Math.hypot(...dir) || 1; dir = dir.map((v) => v / dl);
    const target = root.map((v, k) => v + dir[k] * dist);
    const pole = [r.next() * 2 - 1, r.next() * 2 - 1, r.next() * 2 - 1];
    const o = solveTwoBone(root, target, l1, l2, pole);
    worst = Math.max(worst, d(o.end, target)); worstLen = Math.max(worstLen, Math.abs(d(root, o.mid) - l1), Math.abs(d(o.mid, o.end) - l2)); n++;
    assert.equal(o.clamped, false);
  }
  assert.ok(worst < 1e-3, `error de efector ${worst}`); assert.ok(worstLen < 1e-9, `longitud ${worstLen}`);
  console.log(`  IK: ${n} casos, error efector max ${(worst * 1000).toExponential(2)} mm, error longitud max ${worstLen.toExponential(2)} m`);
});

test('IK: fuera de alcance => se clampa sin estirar huesos y apunta al objetivo', () => {
  const o = solveTwoBone([0, 0, 0], [0, -3, 0], 0.44, 0.42, [1, 0, 0]);
  assert.equal(o.clamped, true);
  assert.ok(Math.abs(d([0, 0, 0], o.mid) - 0.44) < 1e-9 && Math.abs(d(o.mid, o.end) - 0.42) < 1e-9);
  assert.ok(Math.abs(o.end[0]) < 1e-9 && o.end[1] < 0 && d([0, 0, 0], o.end) <= (0.86) + 1e-9);
});

test('IK: el polo manda (rodilla/codo hacia el lado del polo) y es continuo', () => {
  const o = solveTwoBone([0, 1, 0], [0.1, 0.35, 0], 0.44, 0.42, [1, 0, 0]);
  assert.ok(o.mid[0] > 0.1, 'la rodilla debe ir hacia +X (polo)');
  const o2 = solveTwoBone([0, 1, 0], [0.1, 0.35, 0], 0.44, 0.42, [-1, 0, 0]);
  assert.ok(o2.mid[0] < 0);
  // continuidad al barrer el eje por debajo del polo
  let prev = null, maxJump = 0;
  for (let a = -80; a <= 80; a += 0.5) { const t = [Math.sin(a * Math.PI / 180) * 0.6, 1 - Math.cos(a * Math.PI / 180) * 0.6, 0]; const k = solveTwoBone([0, 1, 0], t, 0.44, 0.42, [1, 0.05, 0], undefined, prev?.bend); if (prev) maxJump = Math.max(maxJump, d(k.mid, prev.mid)); prev = { mid: k.mid.slice(), bend: k.bend.slice() }; }
  assert.ok(maxJump < 0.02, `salto de rodilla ${maxJump}`);
});
