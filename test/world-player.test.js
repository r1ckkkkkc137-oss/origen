import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerBody, stepPlayer, playerEye, collides, PLAYER_DEFAULTS } from '../src/world/physics.js';
import { World } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { createRng } from '../src/shared/rng.js';

const S = 0.5;                       // metros por bloque
const GROUND = 10;                   // el suelo ocupa y < 10 (cara superior en y=10 bloques = 5.0 m)
const GY = GROUND * S;
// mundo falso plano: sólido si y < GROUND, o si la celda está en `extra`(x,y,z); agua si `water`(x,y,z)
const fake = (extra = () => false, water = () => false) => ({
  getBlock: (x, y, z) => (y < GROUND || extra(x, y, z) ? B.STONE : water(x, y, z) ? B.WATER : B.AIR),
});
const run = (w, b, input, secs, dt, each) => { for (let t = 0; t < secs - 1e-9; t += dt) { stepPlayer(w, b, input, dt); each?.(b); } return b; };
const none = { moveX: 0, moveZ: 0, jump: false, yaw: 0 };
const fwdX = { moveX: 1, moveZ: 0, jump: false, yaw: 0 };   // yaw 0, moveX=+1 => hacia +X

test('jugador: cae y aterriza sobre el suelo', () => {
  const w = fake(), b = createPlayerBody({ x: 3, y: GY + 8, z: 3 });
  run(w, b, none, 0.2, 1 / 60); assert.equal(b.onGround, false);
  run(w, b, none, 2, 1 / 60);
  assert.equal(b.onGround, true);
  assert.ok(Math.abs(b.y - GY) < 1e-3, `y=${b.y}`);
  assert.equal(b.vy, 0);
  assert.deepEqual(playerEye(b).map((v) => +v.toFixed(3)), [3, +(GY + 1.62).toFixed(3), 3]);
});

test('jugador: caída desde muy alto con dt grande no atraviesa el suelo (substeps)', () => {
  const w = fake(), b = createPlayerBody({ x: 0, y: GY + 300, z: 0 });
  let minY = Infinity; run(w, b, none, 12, 0.2, (p) => { minY = Math.min(minY, p.y); });
  assert.ok(minY >= GY - 1e-3 && b.onGround);
});

test('jugador: no atraviesa paredes (dt chico y grande)', () => {
  for (const dt of [1 / 144, 1 / 60, 1 / 30, 0.2]) {
    const w = fake((x, y) => x >= 30 && y < GROUND + 6), b = createPlayerBody({ x: 10, y: GY, z: 5 });
    run(w, b, fwdX, 6, dt);
    assert.ok(b.x + b.halfW <= 30 * S + 1e-3, `dt ${dt}: x=${b.x}`);
    assert.ok(b.x + b.halfW > 30 * S - 0.05, `dt ${dt}: llegó a la pared (x=${b.x})`);
    assert.equal(collides(w, b), false);
  }
});

test('jugador: sube un escalón de 1 bloque caminando (sin saltar)', () => {
  const w = fake((x, y) => x >= 30 && y < GROUND + 1), b = createPlayerBody({ x: 10, y: GY, z: 5 });
  let jumped = false; run(w, b, fwdX, 4, 1 / 60, (p) => { if (p.vy > 0.5) jumped = true; });
  assert.equal(jumped, false);
  assert.ok(b.x > 30 * S + 0.3, `x=${b.x}`);
  assert.ok(Math.abs(b.y - (GY + S)) < 1e-3 && b.onGround, `y=${b.y}`);
});

test('jugador: NO sube 2 bloques sin saltar; saltando tampoco', () => {
  const w = fake((x, y) => x >= 30 && y < GROUND + 2), b = createPlayerBody({ x: 10, y: GY, z: 5 });
  run(w, b, fwdX, 4, 1 / 60);
  assert.ok(b.x + b.halfW <= 30 * S + 1e-3 && Math.abs(b.y - GY) < 1e-3, `x=${b.x} y=${b.y}`);
  run(w, b, { ...fwdX, jump: true }, 4, 1 / 60);
  assert.ok(b.x + b.halfW <= 30 * S + 1e-3 && b.y < GY + 0.7, `con salto x=${b.x} y=${b.y}`);
});

test('jugador: el salto sube ~1,2 bloques (0,6 m), sale del suelo y vuelve; salta sobre 1 bloque pero no sobre 2', () => {
  const w = fake(), b = createPlayerBody({ x: 3, y: GY, z: 3 });
  stepPlayer(w, b, none, 0.05); assert.equal(b.onGround, true);
  let max = 0, air = 0; run(w, b, { ...none, jump: true }, 0.05, 1 / 120, () => {});
  run(w, b, none, 2, 1 / 120, (p) => { max = Math.max(max, p.y - GY); if (!p.onGround) air++; });
  assert.ok(Math.abs(max - PLAYER_DEFAULTS.jumpHeight) < 0.03, `apex ${max}`);
  assert.ok(max / S >= 1.1 && max / S < 1.4);
  assert.ok(b.onGround && Math.abs(b.y - GY) < 1e-3);
  assert.ok(air * (1 / 120) > 0.55 && air * (1 / 120) < 0.8, `tiempo en el aire ${air / 120}`);
  // en el aire no se puede volver a saltar
  const c = createPlayerBody({ x: 3, y: GY + 3, z: 3 }); run(w, c, { ...none, jump: true }, 0.3, 1 / 60); assert.ok(c.vy < 0);
  // un bloque (muro de 1) sí con salto desde parado a 1 bloque de distancia; con 2 no
  for (const [h, ok] of [[1, true], [2, false]]) {
    const w2 = fake((x, y) => x >= 30 && y < GROUND + h), p = createPlayerBody({ x: 29 * S - 0.35, y: GY, z: 5 });
    // 2 bloques: caminar+saltar contra la pared no debe subir; 1 bloque: sube (por escalón o salto)
    run(w2, p, { ...fwdX, jump: true }, 0.1, 1 / 60); run(w2, p, fwdX, 2, 1 / 60);   // un salto y luego caminar
    assert.equal(p.y > GY + 0.4 && p.onGround, ok, `h=${h} y=${p.y}`);
  }
});

test('jugador: determinismo bit a bit (mismo mundo + misma secuencia de inputs)', () => {
  const trace = (seed) => {
    const w = new World(11), rng = createRng(seed), b = createPlayerBody({ x: 4, y: 100 * S, z: 4 }), out = [];
    for (let i = 0; i < 500; i++) {
      const input = { moveX: Math.round(rng.next() * 2 - 1), moveZ: Math.round(rng.next() * 2 - 1), jump: rng.next() < 0.2, yaw: Math.floor(i / 50) * 0.7, sprint: rng.next() < 0.3 };
      stepPlayer(w, b, input, [1 / 60, 1 / 144, 1 / 30][i % 3]);
      out.push(b.x, b.y, b.z, b.vx, b.vy, b.vz, b.onGround);
    }
    return out;
  };
  const a = trace(5), c = trace(5), d = trace(6);
  assert.equal(a.length, c.length);
  for (let i = 0; i < a.length; i++) assert.ok(Object.is(a[i], c[i]), `diverge en ${i}`);
  assert.ok(a.some((v, i) => !Object.is(v, d[i])), 'otra secuencia debería dar otra trayectoria');
});

test('jugador: dt 1/30 vs 1/60 vs 1/144 dan la misma trayectoria (±3 cm) caminando, saltando y subiendo un escalón', () => {
  const ref = {};
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const w = fake((x, y) => x >= 34 && y < GROUND + 1), b = createPlayerBody({ x: 10, y: GY, z: 5 });
    run(w, b, fwdX, 1.5, dt);                                  // acelera
    run(w, b, { ...fwdX, jump: true }, 0.4, dt);               // salta
    run(w, b, fwdX, 2.0, dt);                                  // aterriza y sube el escalón
    ref[dt.toFixed(4)] = [b.x, b.y, b.z];
  }
  const [a, c, d] = Object.values(ref);
  for (const k of [0, 1, 2]) { assert.ok(Math.abs(a[k] - d[k]) < 0.03, `30 vs 144 eje ${k}: ${a[k]} ${d[k]}`); assert.ok(Math.abs(c[k] - d[k]) < 0.03); }
});

test('jugador: no queda atrapado en esquinas (desliza y puede salir)', () => {
  // esquina interior: paredes x>=30 y z>=30 (3 bloques de alto)
  const w = fake((x, y, z) => y < GROUND + 3 && (x >= 30 || z >= 30)), b = createPlayerBody({ x: 10, y: GY, z: 10 });
  run(w, b, { moveX: 1, moveZ: -1, jump: false, yaw: 0 }, 5, 1 / 60);   // diagonal (+X,+Z) hacia la esquina interior
  assert.equal(collides(w, b), false);
  assert.ok(b.x + b.halfW <= 30 * S + 1e-3 && b.z + b.halfW <= 30 * S + 1e-3);
  const x0 = b.x;
  run(w, b, { moveX: -1, moveZ: 0, jump: false, yaw: 0 }, 1, 1 / 60);   // sale hacia -X
  assert.ok(b.x < x0 - 1, `no salió: ${x0} → ${b.x}`);
  // rozar una pared en diagonal avanza a lo largo de ella
  const w2 = fake((x, y) => x >= 30 && y < GROUND + 3), p = createPlayerBody({ x: 14.5, y: GY, z: 5 });
  run(w2, p, { moveX: 1, moveZ: 1, jump: false, yaw: 0 }, 2, 1 / 60);
  assert.ok(p.z < 5 - 2, `no deslizó: z=${p.z}`);
});

test('jugador: si se coloca un bloque dentro del cuerpo, lo desatasca hacia arriba', () => {
  const w = fake(), b = createPlayerBody({ x: 3.25, y: GY, z: 3.25 });
  run(w, b, none, 0.2, 1 / 60);
  const w2 = fake((x, y, z) => x >= 6 && x <= 7 && z >= 6 && z <= 7 && y === GROUND);    // bloque colocado a los pies
  b.x = 3.25; b.z = 3.25; assert.equal(collides(w2, b), true);
  stepPlayer(w2, b, none, 1 / 60);
  assert.equal(collides(w2, b), false);
  run(w2, b, none, 1, 1 / 60); assert.ok(b.onGround && Math.abs(b.y - (GY + S)) < 1e-3, `y=${b.y}`);
});

test('jugador: agua no es sólida; cae lento, "salto" nada hacia arriba y se puede salir a un borde de 1 bloque', () => {
  // estanque x en [0,20), z en [0,20): suelo hasta y<GROUND-4, agua hasta GROUND (nivel = cara superior del suelo vecino)
  const inPool = (x, z) => x >= 0 && x < 20 && z >= 0 && z < 20;
  const w = { getBlock: (x, y, z) => (inPool(x, z) ? (y < GROUND - 6 ? B.STONE : y < GROUND ? B.WATER : B.AIR) : y < GROUND ? B.STONE : B.AIR) };
  const b = createPlayerBody({ x: 5, y: GY + 2, z: 5 });
  run(w, b, none, 1.2, 1 / 60); assert.equal(b.inWater, true);
  assert.ok(b.vy > -3, `no frena en agua vy=${b.vy}`);
  run(w, b, none, 6, 1 / 60); assert.ok(b.onGround && Math.abs(b.y - (GY - 6 * S)) < 1e-2, `fondo y=${b.y}`);
  run(w, b, { ...none, jump: true }, 4, 1 / 60); assert.ok(b.y > GY - 1.0, `no emerge y=${b.y}`);
  assert.equal(collides(w, b), false);
  // nadar hacia el borde (+X) con salto mantenido sale a tierra
  run(w, b, { moveX: 1, moveZ: 0, jump: true, yaw: 0 }, 8, 1 / 60);
  run(w, b, none, 1.5, 1 / 60);
  assert.ok(b.x > 10 && b.onGround && Math.abs(b.y - GY) < 0.51, `x=${b.x} y=${b.y}`);
});

test('jugador: sobre un mundo real (semilla 7) no se hunde en sólidos ni cae al vacío en 20 s de input aleatorio', () => {
  const w = new World(7), rng = createRng(77), b = createPlayerBody({ x: 8, y: 120 * S, z: 8 });
  let bad = 0;
  for (let i = 0; i < 1200; i++) {
    stepPlayer(w, b, { moveX: Math.round(rng.next() * 2 - 1), moveZ: 1, jump: rng.next() < 0.1, yaw: (i >> 6) * 1.1, sprint: true }, 1 / 60);
    if (collides(w, b) || !(b.y > -1) || !Number.isFinite(b.x)) bad++;
  }
  assert.equal(bad, 0);
});
