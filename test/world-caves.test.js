import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { generateChunk, listCaveEntrances, ENT_CELL } from '../src/world/generator.js';
import { hashBlocks, SEA_LEVEL } from '../src/world/chunk.js';
import { B, IS_SOLID, IS_LEAF, IS_LOG } from '../src/world/blocks.js';

const SEEDS = [1234, 1, 7, 99];
const N = 8;                                                   // 8x8 = 64 chunks
const loaded = (seed) => { const w = new World(seed); for (let cz = -N / 2 - 1; cz < N / 2 + 1; cz++) for (let cx = -N / 2 - 1; cx < N / 2 + 1; cx++) w.chunk(cx, cz); return w; };
const R0 = -N / 2 * 16, R1 = N / 2 * 16 - 1;

function surfaceH(w, x, z) { for (let y = 63; y >= 0; y--) { const id = w.getBlock(x, y, z); if (IS_SOLID[id] && !IS_LEAF[id] && !IS_LOG[id]) return y; } return 0; }   // terreno: ignora copas y troncos

test('cuevas: ≥ 1 entrada visible desde la superficie cada ~4–8 chunks (64 chunks, 4 seeds) y cada entrada está abierta al cielo', () => {
  for (const seed of SEEDS) {
    const w = loaded(seed);
    const ents = listCaveEntrances(seed, R0, R0, R1, R1);
    assert.ok(ents.length >= 64 / 8, `seed ${seed}: ${ents.length} entradas en 64 chunks`);
    for (const e of ents) {
      assert.ok(e.h > SEA_LEVEL, 'por encima del mar');
      // la boca debe estar realmente abierta: algún bloque de AIR a ras de la superficie junto al punto de entrada y el túnel baja
      let open = false;
      for (let dz = -3; dz <= 3 && !open; dz++) for (let dx = -3; dx <= 3 && !open; dx++) {
        const x = e.x + dx, z = e.z + dz, hh = surfaceH(w, x, z);
        if (w.getBlock(x, hh + 1, z) === B.AIR && hh >= SEA_LEVEL && w.getBlock(x, hh, z) === B.AIR) open = true;   // columna con hueco en la superficie
      }
      // alternativa: aire en el nivel del terreno original (la superficie "h" listada) con piedra/tierra a los lados
      if (!open) for (let dz = -3; dz <= 3 && !open; dz++) for (let dx = -3; dx <= 3 && !open; dx++) if (w.getBlock(e.x + dx, e.h - 1, e.z + dz) === B.AIR && w.getBlock(e.x + dx, e.h, e.z + dz) === B.AIR) open = true;
      assert.ok(open, `seed ${seed}: entrada en (${e.x},${e.z}) sin abertura`);
      assert.ok(e.bottomY < e.h - 4, 'baja bajo la superficie');
    }
  }
});

test('minerales: carbón más abundante y más somero que hierro; hierro más profundo; solo reemplazan piedra (nunca por encima del terreno; en acantilados pueden asomar)', () => {
  for (const seed of SEEDS) {
    const w = loaded(seed);
    let coal = 0, iron = 0, cy = 0, iy = 0, cMin = 99, cMax = 0, iMin = 99, iMax = 0, exposed = 0;
    for (let cz = -N / 2; cz < N / 2; cz++) for (let cx = -N / 2; cx < N / 2; cx++) {
      const c = w.chunk(cx, cz);
      for (let y = 1; y < 64; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const id = c.get(x, y, z);
        if (id !== B.COAL && id !== B.IRON) continue;
        const X = cx * 16 + x, Z = cz * 16 + z;
        assert.ok(y <= surfaceH(w, X, Z), `ore no flota sobre el terreno (${X},${y},${Z})`);
        if (id === B.COAL) { coal++; cy += y; cMin = Math.min(cMin, y); cMax = Math.max(cMax, y); } else { iron++; iy += y; iMin = Math.min(iMin, y); iMax = Math.max(iMax, y); }
        if ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, d]) => w.getBlock(X + a, y + b, Z + d) === B.AIR)) exposed++;
      }
    }
    assert.ok(coal > 2.5 * iron, `seed ${seed}: carbón ${coal} vs hierro ${iron}`);
    assert.ok(iron > 100, 'hay hierro');
    assert.ok(cy / coal > iy / iron + 4, `carbón más somero (media y ${(cy / coal).toFixed(1)} vs ${(iy / iron).toFixed(1)})`);
    assert.ok(iMax <= 18 && iMin >= 1, `hierro profundo y ${iMin}..${iMax}`);
    assert.ok(cMin >= 8 && cMax <= 52, `carbón y ${cMin}..${cMax}`);
    assert.ok(exposed > 20, `vetas visibles en paredes de cueva (${exposed})`);
  }
});

test('cuevas: no rompen el agua ni dejan bloques flotando sueltos', () => {
  for (const seed of SEEDS) {
    const w = loaded(seed);
    let waterLeak = 0, floating = 0, solid = 0;
    for (let cz = -N / 2 + 1; cz < N / 2 - 1; cz++) for (let cx = -N / 2 + 1; cx < N / 2 - 1; cx++) {
      const c = w.chunk(cx, cz);
      for (let y = 1; y < 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const id = c.get(x, y, z), X = cx * 16 + x, Z = cz * 16 + z;
        const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([a, b, d]) => w.getBlock(X + a, y + b, Z + d));
        if (id === B.WATER && nb.some((q, i) => q === B.AIR && i !== 2)) waterLeak++;       // agua con aire al lado o debajo
        if (IS_SOLID[id]) { solid++; if (!nb.some((q) => IS_SOLID[q])) floating++; }
      }
    }
    assert.equal(waterLeak, 0, `seed ${seed}: agua con aire pegado`);
    assert.ok(floating / solid < 2e-5, `seed ${seed}: ${floating} bloques sueltos de ${solid}`);
  }
});

test('cuevas y minerales son deterministas (misma seed = mismo hash, en cualquier orden de generación) y distintas seeds difieren', () => {
  const hs = (seed, rev) => { const cs = []; for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) cs.push([cx, cz]); if (rev) cs.reverse(); return new Map(cs.map(([cx, cz]) => [`${cx},${cz}`, hashBlocks(generateChunk(seed, cx, cz).blocks)])); };
  const a = hs(1234, false), b = hs(1234, true);
  for (const [k, v] of a) assert.equal(b.get(k), v);
  assert.deepEqual(listCaveEntrances(1234, -64, -64, 64, 64), listCaveEntrances(1234, -64, -64, 64, 64));
  assert.notDeepEqual(listCaveEntrances(1234, -300, -300, 300, 300), listCaveEntrances(1235, -300, -300, 300, 300));
  assert.ok(ENT_CELL >= 16);
});
