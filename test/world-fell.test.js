import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { listTrees } from '../src/world/generator.js';
import { BLOCK_SIZE_M as S } from '../src/world/units.js';
import { STEP, FALL_MAX_TIME, ITEM_TTL, ITEM_STICK, rotatedOffset } from '../src/world/entities.js';
import { meshBlockSet } from '../src/world/entityView.js';
import { collides } from '../src/world/physics.js';

// Arena plana: piedra hasta y=20, aire encima, en x,z ∈ [-24,24]. Árbol de prueba: tronco de WOOD en (0,21..21+H-1,0) + copa de LEAVES.
const GROUND = 20, R = 24;
function arena(seed = 5, H = 10, wallX = null) {
  const w = new World(seed);
  for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
    for (let y = 1; y <= GROUND; y++) w.setBlock(x, y, z, B.STONE);
    for (let y = GROUND + 1; y < 60; y++) w.setBlock(x, y, z, B.AIR);
  }
  for (let y = 0; y < H; y++) w.setBlock(0, GROUND + 1 + y, 0, B.LOG);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 2; dy++)
    if ((dx || dz || dy === 2) && Math.abs(dx) + Math.abs(dz) <= 3) w.setBlock(dx, GROUND + H - 1 + dy, dz, B.LEAVES);
  if (wallX !== null) for (let y = GROUND + 1; y < GROUND + 40; y++) for (let z = -6; z <= 6; z++) w.setBlock(wallX, y, z, B.STONE);
  return w;
}
const run = (w, maxSteps = 4000) => { let n = 0; while (w.fallingTrees.length && n < maxSteps) { w.stepEntities(1); n++; } return n; };
const centroid = (items) => { let x = 0, z = 0; for (const it of items) { x += it.x / S; z += it.z / S; } return [x / items.length, z / items.length]; };

const DIRS = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };

test('fellTree con golpe: cae hacia el lado OPUESTO al golpe (4 direcciones, fromX/fromZ) y termina en 90°', () => {
  for (const [name, [dx, dz]] of Object.entries(DIRS)) {
    const w = arena();
    const r = w.fellTree(0, GROUND + 1, 0, { fromX: 0.5 - dx * 3, fromZ: 0.5 - dz * 3 });   // el jugador está en el lado -d
    assert.deepEqual(r.direction.map((v) => Math.round(v)), [dx, dz], name);
    assert.equal(w.fallingTrees.length, 1);
    const n = run(w);
    assert.equal(w.fallingTrees.length, 0, 'la entidad se elimina al impactar');
    assert.ok(n * STEP <= FALL_MAX_TIME, `tiempo acotado ${n * STEP}s`);
    const ev = w.consumeEntityEvents();
    const imp = ev.find((e) => e.type === 'impact');
    assert.ok(Math.abs(imp.theta - Math.PI / 2) < 1e-9, `impacto a 90° (${imp.theta})`);
    const [cx, cz] = centroid(w.itemDrops);
    // el tronco queda tendido en el suelo hacia d: centroide a ~H/2 bloques del pie, casi sin desvío lateral
    assert.ok((cx - 0.5) * dx + (cz - 0.5) * dz > 3, `${name}: avanza en la dirección de caída`);
    assert.ok(Math.abs((cx - 0.5) * dz - (cz - 0.5) * dx) < 0.8, `${name}: sin desvío lateral`);
  }
});

test('fellTree con dirX/dirZ (vector del golpe) gana sobre from, y la altura de impacto es la del suelo', () => {
  const w = arena();
  const r = w.fellTree(0, GROUND + 1, 0, { dirX: 0, dirZ: -2, fromX: 99, fromZ: 99 });
  assert.deepEqual(r.direction, [0, -1]);
  run(w);
  for (const it of w.itemDrops) assert.ok(it.y > (GROUND + 1) * S - 1e-9 - 0.05 && it.y < (GROUND + 1) * S + 1.0, `item y=${it.y}`);
});

test('tiempo de caída realista (árbol de 5 m: 1–3 s) y sigue un péndulo invertido (θ crece, ω crece)', () => {
  const w = arena(5, 10);
  w.fellTree(0, GROUND + 1, 0, { dirX: 1, dirZ: 0 });
  const t = w.fallingTrees[0]; let last = t.theta, lastW = t.omega, mono = true, steps = 0;
  while (w.fallingTrees.length && steps < 5000) { w.stepEntities(1); steps++; const q = w.fallingTrees[0]; if (q) { if (q.theta < last || q.omega < lastW) mono = false; last = q.theta; lastW = q.omega; } }
  assert.ok(mono);
  const secs = steps * STEP;
  assert.ok(secs > 1 && secs < 3, `cae en ${secs}s`);
});

test('suelta tantas maderas como logs (id = versión CUT del tronco), nada acreditado antes de impactar y sin palos por defecto', () => {
  const w = arena(5, 10);
  const r = w.fellTree(0, GROUND + 1, 0, { dirX: 1, dirZ: 0 });
  assert.equal(r.logs, 10);
  assert.ok(r.leaves > 20);
  assert.equal(w.itemDrops.length, 0, 'aún no hay items');
  for (let y = GROUND + 1; y < GROUND + 11; y++) assert.equal(w.getBlock(0, y, 0), B.AIR, 'troncos fuera del grid');
  run(w);
  const items = w.itemDrops;
  assert.equal(items.length, 10);
  assert.ok(items.every((i) => i.id === B.LOG_CUT));
  assert.deepEqual(r.drops, [{ id: B.LOG_CUT, count: 10 }]);
  assert.equal(items.filter((i) => i.id === ITEM_STICK).length, 0);
});

test('hojas: con leafDrops dan 0..6 palos (determinista); sin la opción, ninguno', () => {
  const a = arena(), b = arena();
  a.fellTree(0, GROUND + 1, 0, { dirX: 1, dirZ: 0, leafDrops: true }); run(a);
  b.fellTree(0, GROUND + 1, 0, { dirX: 1, dirZ: 0, leafDrops: true }); run(b);
  const sa = a.itemDrops.filter((i) => i.id === ITEM_STICK), sb = b.itemDrops.filter((i) => i.id === ITEM_STICK);
  assert.ok(sa.length <= 6);
  assert.equal(sa.length, sb.length);
  assert.equal(a.itemDrops.length, 10 + sa.length);
});

test('determinismo: mismo seed + mismos golpes + misma secuencia de dt = mismo estado bit a bit (árbol generado, dirección por hash)', () => {
  const seed = 1234, t = listTrees(seed, -60, -60, 60, 60).find((q) => q._ok !== false);
  const mk = () => {
    const w = new World(seed);
    const lg = t._blocks.find((b) => b[3] >= 4 && b[3] !== 5 && b[3] !== 14 && b[3] !== 16) ?? t._blocks[0];
    const r = w.fellTree(lg[0], lg[1], lg[2], { /* sin dirección: hash determinista */ });
    for (let i = 0; i < 90; i++) w.updateEntities(1 / 60);         // 1.5 s a 60 fps
    for (let i = 0; i < 400; i++) w.updateEntities(1 / 30 + (i % 3) * 0.001);
    return { w, r };
  };
  const A = mk(), Bw = mk();
  assert.deepEqual(A.r.direction, Bw.r.direction);
  assert.ok(A.r.direction && Math.abs(Math.hypot(...A.r.direction) - 1) < 1e-12);
  assert.ok(A.w.itemDrops.length > 0);
  assert.equal(JSON.stringify(A.w.itemDrops), JSON.stringify(Bw.w.itemDrops));
  assert.equal(JSON.stringify(A.w.consumeEntityEvents()), JSON.stringify(Bw.w.consumeEntityEvents()));
  // y otra seed da otra dirección por hash (no es una constante)
  const dirs = new Set();
  for (const s of [1, 2, 3, 4, 5, 6]) { const w = arena(s); dirs.add(w.fellTree(0, GROUND + 1, 0, {}).direction.map((v) => v.toFixed(4)).join()); }
  assert.ok(dirs.size >= 5, 'la dirección por defecto depende de la seed');
});

test('árbol junto a una pared: se detiene al tocarla (sin atravesarla) y los items no quedan dentro de sólidos', () => {
  const w = arena(5, 10, 3);                                        // pared en x=3, el árbol cae hacia +x
  w.fellTree(0, GROUND + 1, 0, { dirX: 1, dirZ: 0 });
  const n = run(w);
  assert.equal(w.fallingTrees.length, 0);
  const imp = w.consumeEntityEvents().find((e) => e.type === 'impact');
  assert.ok(imp.theta < 0.7, `se detuvo temprano (θ=${imp.theta})`);
  assert.ok(n * STEP < FALL_MAX_TIME);
  assert.equal(w.itemDrops.length, 10);
  for (let i = 0; i < 600; i++) w.stepEntities(1);
  for (const it of w.itemDrops) { assert.ok(!collides(w, it), 'item fuera de sólidos'); assert.ok(it.x / S < 3.0 + 0.2, 'no atraviesa la pared'); }
});

test('items: caen con gravedad, se asientan sobre el suelo y se recogen con pickupItems(pos, radio)', () => {
  const w = arena();
  w.fellTree(0, GROUND + 1, 0, { dirX: 1, dirZ: 0 });
  run(w); for (let i = 0; i < 800; i++) w.stepEntities(1);
  const items = w.itemDrops, top = (GROUND + 1) * S;
  assert.equal(items.length, 10);
  for (const it of items) { assert.ok(it.onGround, 'en el suelo'); assert.ok(Math.abs(it.y - top) < 0.02, `y=${it.y} ~ ${top}`); assert.ok(it.vx === 0 && it.vz === 0); }
  const [cx, cz] = items.map((i) => [i.x, i.z]).reduce((a, p) => [a[0] + p[0] / items.length, a[1] + p[1] / items.length], [0, 0]);
  assert.deepEqual(w.pickupItems([cx + 50, top, cz], 2), [], 'lejos: nada');
  assert.equal(w.itemDrops.length, 10);
  const first = items[0], got1 = w.pickupItems([first.x, first.y, first.z], 0.3);
  assert.ok(got1.length >= 1 && got1.length < 10);
  assert.ok(got1.every((g) => g.id === B.LOG_CUT && g.count === 1));
  const got2 = w.pickupItems({ x: cx, y: top, z: cz }, 10);
  assert.equal(got1.length + got2.length, 10);
  assert.equal(w.itemDrops.length, 0);
});

test('items desaparecen tras ITEM_TTL s de simulación y el tope MAX_ITEMS se respeta', () => {
  const w = arena(); w.fellTree(0, GROUND + 1, 0, { dirX: 1, dirZ: 0 }); run(w);
  assert.equal(w.itemDrops.length, 10);
  for (let t = 0; t < ITEM_TTL + 5; t += 0.25) w.updateEntities(0.25);
  assert.equal(w.itemDrops.length, 0);
});

test('retrocompatibilidad: fellTree(x,y,z) y fellTree(x,y,z,maxLogs) siguen siendo instantáneos, sin entidades, con {logs,leaves,drops}', () => {
  const w = arena(); const r = w.fellTree(0, GROUND + 1, 0);
  assert.equal(r.logs, 10); assert.ok(r.leaves > 0); assert.deepEqual(r.drops, [{ id: B.LOG_CUT, count: 10 }]);
  assert.equal(r.tree, null); assert.equal(r.direction, null);
  assert.equal(w.fallingTrees.length + w.itemDrops.length, 0);
  assert.equal(w.getBlock(0, GROUND + 5, 0), B.AIR);
  const w2 = arena(); const r2 = w2.fellTree(0, GROUND + 1, 0, 3);
  assert.equal(r2.logs, 3);
  const w3 = arena(); const r3 = w3.fellTree(0, GROUND + 1, 0, { instant: true });
  assert.equal(r3.logs, 10); assert.equal(r3.tree, null); assert.equal(w3.fallingTrees.length, 0);
  assert.equal(arena().fellTree(5, GROUND + 1, 5, { fromX: 0, fromZ: 0 }), null, 'no es tronco');
});

test('rotatedOffset: gira el punto sobre el eje horizontal de la base (up -> d a 90°)', () => {
  const tree = { axis: [0, 0, -1] };                                // d = +x  => a = (dz,0,-dx) = (0,0,-1)
  const o = rotatedOffset(tree, 0, 3, 0, Math.PI / 2);
  assert.ok(Math.abs(o[0] - 3) < 1e-9 && Math.abs(o[1]) < 1e-9 && Math.abs(o[2]) < 1e-9);
  const p = rotatedOffset({ axis: [1, 0, 0] }, 0, 3, 0, Math.PI / 2);   // d = +z
  assert.ok(Math.abs(p[2] - 3) < 1e-9 && Math.abs(p[1]) < 1e-9);
});

test('meshBlockSet: descarta caras ocultas entre bloques, hojas en capa cutout, posiciones en metros relativas al pivote', () => {
  const one = meshBlockSet([{ x: 0, y: 0, z: 0, id: B.LOG }], [0, 0, 0]);
  assert.equal(one.opaque.triangleCount, 12); assert.equal(one.cutout.triangleCount, 0);
  const two = meshBlockSet([{ x: 0, y: 0, z: 0, id: B.LOG }, { x: 0, y: 1, z: 0, id: B.LOG }], [0, 0, 0]);
  assert.equal(two.opaque.triangleCount, 20);
  const lf = meshBlockSet([{ x: 0, y: 0, z: 0, id: B.LOG }, { x: 1, y: 0, z: 0, id: B.LEAVES }], [0, 0, 0]);
  assert.equal(lf.opaque.triangleCount, 12, "el tronco junto a una hoja (translúcida) conserva sus 6 caras");
  assert.equal(lf.cutout.triangleCount, 10, "la hoja no dibuja la cara pegada al tronco opaco");
  let max = 0; for (const v of one.opaque.positions) max = Math.max(max, Math.abs(v));
  assert.ok(Math.abs(max - S) < 1e-6);
  const sh = meshBlockSet([{ x: 5, y: 7, z: 9, id: B.LOG }], [5, 7, 9]);
  assert.deepEqual(Array.from(sh.opaque.positions), Array.from(one.opaque.positions));
  for (const t of one.opaque.tiles) assert.ok(t >= 0);
});

test('coste: un update de entidades con árbol cayendo + 100 items es barato (< 2 ms por frame a 60 fps, medición informativa)', () => {
  const w = arena(); w.fellTree(0, GROUND + 1, 0, { dirX: 1, dirZ: 0 });
  let c = 0; const t0 = process.hrtime.bigint();
  while (w.fallingTrees.length && c < 600) { w.updateEntities(1 / 60); c++; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / c;
  assert.ok(ms < 5, `${ms.toFixed(3)} ms/frame`);
});
