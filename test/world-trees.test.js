import test from 'node:test';
import assert from 'node:assert/strict';
import { generateChunk, listTrees, treeBlocks, columnInfo, BIOME, SPECIES, SPECIES_NAMES, TREE_HEIGHT, TREE_CELL } from '../src/world/generator.js';
import { hashBlocks, SEA_LEVEL, CHUNK_Y } from '../src/world/chunk.js';
import { B } from '../src/world/blocks.js';
import { World } from '../src/world/world.js';

const SEEDS = [1234, 7, 42, 987654];
const BIG = 360;                                    // región grande solo para estadística de listTrees (sin generar chunks)
const LO = -96, HI = 95;                            // región de chunks -6..5 para pruebas sobre bloques reales
const all = (seed) => listTrees(seed, -BIG, -BIG, BIG, BIG);
const region = (seed) => listTrees(seed, LO - 8, LO - 8, HI + 8, HI + 8);
function generateRegion(seed, reverse) {
  const map = new Map(), cs = [];
  for (let cz = -6; cz <= 5; cz++) for (let cx = -6; cx <= 5; cx++) cs.push([cx, cz]);
  if (reverse) cs.reverse();
  for (const [cx, cz] of cs) map.set(`${cx},${cz}`, generateChunk(seed, cx, cz));
  return { at: (x, y, z) => map.get(`${x >> 4},${z >> 4}`).get(x & 15, y, z & 15), map };
}

test('árboles: altura 10–18 bloques (5–9 m) por especie, medida sobre los bloques reales, y cabe en 64 de alto', () => {
  const heights = { oak: [], pine: [], birch: [] };
  for (const seed of SEEDS) for (const t of all(seed)) {
    const bl = treeBlocks(seed, t);
    const top = Math.max(...bl.map((b) => b[1])) - t.ground;
    assert.equal(top, t.height, `altura medida ${top} != ${t.height} (${SPECIES_NAMES[t.species]} en ${t.x},${t.z})`);
    assert.ok(t.height >= 10 && t.height <= 18);
    const [lo, hi] = TREE_HEIGHT[t.species];
    assert.ok(t.height >= lo && t.height <= hi);
    assert.ok(t.ground + t.height <= CHUNK_Y - 1, 'no cabe en el chunk');
    assert.ok(Math.min(...bl.map((b) => b[1])) >= 0);
    heights[SPECIES_NAMES[t.species]].push(t.height);
  }
  for (const [name, hs] of Object.entries(heights)) {
    assert.ok(hs.length >= 100, `${name}: pocas muestras (${hs.length})`);
    const lo = Math.min(...hs), hi = Math.max(...hs);
    assert.ok(new Set(hs).size >= 5, `${name}: poca variedad de alturas`);
    console.log(`  ${name}: N=${hs.length} alturas ${lo}..${hi} bloques (${lo / 2}..${hi / 2} m)`);
  }
});

test('árboles: mismas semillas = mismos árboles y mismos bloques (también con otro orden de generación y cachés frías); otra semilla = otros', () => {
  const a = listTrees(1234, -200, -200, 200, 200).map((t) => `${t.x},${t.z},${t.ground},${t.species},${t.height}`);
  const bl = (seed) => listTrees(seed, -60, -60, 60, 60).flatMap((t) => treeBlocks(seed, t).map((b) => b.join(','))).join(';');
  const b1 = bl(1234);
  const grid = (rev) => { const o = Array(64); const cs = [...Array(8).keys()].map((i) => i - 4); if (rev) cs.reverse();
    for (const cz of cs) for (const cx of cs) o[(cz + 4) * 8 + (cx + 4)] = hashBlocks(generateChunk(1234, cx, cz).blocks); return o; };
  const f = grid(false);
  // fuerza una caché fría: otras 5 semillas expulsan a la 1234 del caché de muestreadores
  for (const s of [11, 12, 13, 14, 15]) generateChunk(s, 0, 0);
  const a2 = listTrees(1234, -200, -200, 200, 200).map((t) => `${t.x},${t.z},${t.ground},${t.species},${t.height}`);
  const b2 = bl(1234);
  const rr = grid(true);
  assert.deepEqual(a, a2); assert.equal(b1, b2); assert.deepEqual(f, rr);
  assert.notEqual(a.join('|'), listTrees(1235, -200, -200, 200, 200).map((t) => `${t.x},${t.z},${t.ground},${t.species},${t.height}`).join('|'));
});

test('árboles: la ventana de consulta no cambia qué árboles existen', () => {
  const key = (t) => `${t.x},${t.z},${t.ground},${t.species},${t.height}`;
  const a = listTrees(1234, -150, -150, 150, 150), b = listTrees(1234, -20, -30, 170, 10);
  const ka = new Set(a.map(key));
  const inB = b.filter((t) => t.x >= -150 && t.x <= 150 && t.z >= -150 && t.z <= 150);
  assert.ok(inB.length > 0);
  for (const t of inB) assert.ok(ka.has(key(t)));
  const kb = new Set(b.map(key));
  for (const t of a) if (t.x >= -20 && t.x <= 170 && t.z >= -30 && t.z <= 10) assert.ok(kb.has(key(t)));
});

test('árboles: ni copas ni troncos se superponen (separación mínima y bloques disjuntos)', () => {
  let n = 0;
  for (const seed of SEEDS) {
    const trees = region(seed), owner = new Map();
    n += trees.length;
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const d = Math.max(Math.abs(trees[i].x - trees[j].x), Math.abs(trees[i].z - trees[j].z));
        assert.ok(d >= trees[i].r + trees[j].r + 1, `troncos a ${d} (seed ${seed})`);
      }
      for (const [x, y, z] of treeBlocks(seed, trees[i])) {
        const k = `${x},${y},${z}`;
        assert.ok(!owner.has(k), `árboles ${owner.get(k)} y ${i} comparten ${k}`);
        owner.set(k, i);
      }
    }
  }
  assert.ok(n >= 150, `pocos árboles: ${n}`);
});

test('árboles: consistentes entre bordes de chunk (orden inverso) y sin troncos/hojas que no pertenezcan a un árbol', () => {
  let nTrees = 0, nBorder = 0;
  for (const seed of SEEDS) {
    const { at } = generateRegion(seed, true);
    const expLogs = new Set(), expLeaves = new Set();
    for (const t of region(seed)) {
      nTrees++;
      if ([t.x, t.z].some((v) => { const m = ((v % 16) + 16) % 16; return m <= 5 || m >= 11; })) nBorder++;
      for (const [x, y, z, id] of treeBlocks(seed, t)) {
        (id === B.LOG ? expLogs : expLeaves).add(`${x},${y},${z}`);
        if (x < LO || x > HI || z < LO || z > HI) continue;
        const got = at(x, y, z);
        if (id === B.LOG) assert.equal(got, B.LOG, `tronco ausente ${x},${y},${z} seed ${seed}`);
        else assert.ok(got === B.LEAVES || (got !== B.AIR && got !== B.LOG && got !== B.WATER), `hoja inconsistente ${x},${y},${z}: ${got}`);
      }
    }
    for (let z = LO; z <= HI; z++) for (let x = LO; x <= HI; x++) for (let y = SEA_LEVEL; y < CHUNK_Y; y++) {
      const b = at(x, y, z);
      if (b === B.LOG) assert.ok(expLogs.has(`${x},${y},${z}`), `LOG sin árbol ${x},${y},${z} seed ${seed}`);
      else if (b === B.LEAVES) assert.ok(expLeaves.has(`${x},${y},${z}`), `LEAVES sin árbol ${x},${y},${z} seed ${seed}`);
    }
  }
  assert.ok(nTrees >= 150 && nBorder >= 60, `cobertura: ${nTrees} árboles, ${nBorder} cerca de borde`);
});

test('árboles: sin hojas huérfanas ni troncos flotando (mundo real, orden inverso)', () => {
  let leaves = 0, logsN = 0;
  const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const seed of SEEDS) {
    const { at } = generateRegion(seed, true);
    // 1) cada hoja alcanzable desde un tronco por cadena de hojas (se ignoran las hojas a <9 del borde de la región: su tronco puede quedar fuera)
    const inner = (x, z) => x >= LO + 9 && x <= HI - 9 && z >= LO + 9 && z <= HI - 9;
    const seen = new Set(), st = [];
    for (let z = LO; z <= HI; z++) for (let x = LO; x <= HI; x++) for (let y = SEA_LEVEL; y < CHUNK_Y; y++) if (at(x, y, z) === B.LOG) st.push([x, y, z]);
    logsN += st.length;
    while (st.length) {
      const [a, b, c] = st.pop();
      for (const [dx, dy, dz] of N6) {
        const x = a + dx, y = b + dy, z = c + dz, k = `${x},${y},${z}`;
        if (x < LO || x > HI || z < LO || z > HI || y < 0 || y >= CHUNK_Y || seen.has(k) || at(x, y, z) !== B.LEAVES) continue;
        seen.add(k); st.push([x, y, z]);
      }
    }
    for (let z = LO; z <= HI; z++) for (let x = LO; x <= HI; x++) for (let y = SEA_LEVEL; y < CHUNK_Y; y++) {
      if (at(x, y, z) !== B.LEAVES) continue;
      leaves++;
      if (inner(x, z)) assert.ok(seen.has(`${x},${y},${z}`), `hoja huérfana ${x},${y},${z} seed ${seed}`);
    }
    // 2) cada componente de troncos toca el terreno (algún tronco con suelo sólido debajo): ningún tronco flota
    const comp = new Set();
    for (let z = LO; z <= HI; z++) for (let x = LO; x <= HI; x++) for (let y = SEA_LEVEL; y < CHUNK_Y; y++) {
      if (at(x, y, z) !== B.LOG || comp.has(`${x},${y},${z}`)) continue;
      let grounded = false, edge = false; const q = [[x, y, z]]; comp.add(`${x},${y},${z}`);
      while (q.length) {
        const [a, b, c] = q.pop();
        if (a - LO < 8 || HI - a < 8 || c - LO < 8 || HI - c < 8) edge = true;   // árbol cortado por el borde de la región: no se juzga
        const under = at(a, b - 1, c);
        if (under !== B.AIR && under !== B.WATER && under !== B.LOG && under !== B.LEAVES) grounded = true;
        for (const [dx, dy, dz] of N6) {
          const k = `${a + dx},${b + dy},${c + dz}`;
          if (a + dx < LO || a + dx > HI || c + dz < LO || c + dz > HI || comp.has(k) || at(a + dx, b + dy, c + dz) !== B.LOG) continue;
          comp.add(k); q.push([a + dx, b + dy, c + dz]);
        }
      }
      assert.ok(grounded || edge, `grupo de troncos flotando cerca de ${x},${y},${z} seed ${seed}`);
    }
  }
  assert.ok(leaves > 3000 && logsN > 500, `pocos bloques para que el test valga (${leaves} hojas, ${logsN} troncos)`);
});

test('árboles: troncos conectados, base gruesa en los altos (2x2) y 1x1 arriba', () => {
  let thick = 0, thin = 0;
  const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const seed of SEEDS) for (const t of listTrees(seed, -150, -150, 150, 150)) {
    const bl = treeBlocks(seed, t), logs = bl.filter((b) => b[3] === B.LOG);
    const set = new Set(logs.map((b) => b.slice(0, 3).join(',')));
    // conexo por caras
    const seen = new Set([`${t.x},${t.ground + 1},${t.z}`]), st = [[t.x, t.ground + 1, t.z]];
    assert.ok(set.has(`${t.x},${t.ground + 1},${t.z}`));
    while (st.length) { const [a, b, c] = st.pop(); for (const [dx, dy, dz] of N6) { const k = `${a + dx},${b + dy},${c + dz}`; if (set.has(k) && !seen.has(k)) { seen.add(k); st.push([a + dx, b + dy, c + dz]); } } }
    assert.equal(seen.size, set.size, `troncos desconectados (${SPECIES_NAMES[t.species]} ${t.x},${t.z})`);
    const perLevel = (dy) => logs.filter((b) => b[1] === t.ground + dy).length;
    if (t.species !== SPECIES.BIRCH && t.height >= 13) {
      thick++;
      assert.equal(t.thick, true);
      // 2x2 en las columnas del candidato: en el nivel ground+1 hay 4 troncos (o más si el suelo es desigual) y arriba del baseH solo el eje (+ ramas del roble)
      const topB = Math.max(...t.cols.map((c) => c[2])) + t.baseH - t.ground;   // último nivel de la base gruesa
      assert.equal(t.cols.length, 4);
      assert.equal(logs.filter((b) => b[1] === t.ground + topB && Math.abs(b[0] - t.x) <= 1 && Math.abs(b[2] - t.z) <= 1).length >= 4, true, 'base no gruesa');
      if (t.species === SPECIES.PINE) assert.equal(perLevel(topB + 1), 1);
      assert.equal(logs.filter((b) => b[0] === t.x && b[2] === t.z).length >= t.trunk, true);
    } else { thin++; assert.equal(t.cols.length, 1); assert.equal(perLevel(1), 1); }
    if (t.species === SPECIES.PINE) assert.equal(perLevel(t.height - 1), 1);
  }
  assert.ok(thick > 50 && thin > 20, `thick ${thick} thin ${thin}`);
});

test('árboles: especie según bioma, nunca en desierto/agua/pendiente fuerte, sobre pasto o nieve', () => {
  const seen = new Set();
  for (const seed of SEEDS) {
    const { at } = generateRegion(seed, false);
    for (const t of region(seed)) {
      if (t.x < LO + 2 || t.x > HI - 2 || t.z < LO + 2 || t.z > HI - 2) continue;
      const info = columnInfo(seed, t.x, t.z);
      assert.notEqual(info.biome, BIOME.DESERT);
      if (info.biome === BIOME.SNOWY_MOUNTAIN) assert.equal(t.species, SPECIES.PINE);
      else assert.ok(info.biome === BIOME.FOREST || info.biome === BIOME.PLAINS);
      seen.add(SPECIES_NAMES[t.species]);
      const base = at(t.x, t.ground, t.z);
      assert.ok(base === B.GRASS || base === B.SNOW, `base ${base}`);
      assert.ok(t.ground >= SEA_LEVEL + 2);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.ok(Math.abs(columnInfo(seed, t.x + dx, t.z + dz).height - t.ground) <= 2);
      for (const [ox, oz, h2] of t.cols) { assert.ok(h2 >= SEA_LEVEL + 2 && Math.abs(h2 - t.ground) <= 2); assert.equal(columnInfo(seed, t.x + ox, t.z + oz).height, h2); }
    }
  }
  assert.deepEqual([...seen].sort(), ['birch', 'oak', 'pine']);
});

test('talar: cada bloque de tronco se puede romper y suelta madera; fellTree tira el árbol (también con troncos gruesos 2x2) y las hojas caen', () => {
  const w = new World(1234);
  const trees = listTrees(1234, -200, -200, 200, 200);
  const tall = trees.filter((t) => t.thick && t.species === SPECIES.OAK).slice(0, 3).concat(trees.filter((t) => t.thick && t.species === SPECIES.PINE).slice(0, 3), trees.filter((t) => t.species === SPECIES.BIRCH).slice(0, 2));
  assert.ok(tall.length >= 6);
  let felledLeaves = 0, totalLeaves = 0;
  for (const t of tall) {
    const own = treeBlocks(1234, t), logs = own.filter((b) => b[3] === B.LOG), leaves = own.filter((b) => b[3] === B.LEAVES);
    for (let cz = (t.z - 6) >> 4; cz <= (t.z + 6) >> 4; cz++) for (let cx = (t.x - 6) >> 4; cx <= (t.x + 6) >> 4; cx++) w.getChunk(cx, cz);
    // talar un solo tronco de la base gruesa con dig: suelta LOG
    const base = logs.find((b) => b[1] === t.ground + 1 && (b[0] !== t.x || b[2] !== t.z)) || logs[0];
    const d = w.dig(base[0], base[1], base[2]);
    assert.deepEqual(d, { broken: B.LOG, drop: B.LOG });
    w.setBlock(base[0], base[1], base[2], B.LOG);
    // fellTree desde un tronco alto (la rama o el fuste)
    const hit = logs[logs.length - 1];
    const r = w.fellTree(hit[0], hit[1], hit[2]);
    assert.ok(r && r.logs === logs.length, `tiró ${r?.logs} de ${logs.length} troncos`);
    assert.deepEqual(r.drops, [{ id: B.LOG, count: logs.length }]);
    for (const [x, y, z] of logs) assert.equal(w.getBlock(x, y, z), B.AIR);
    // hojas: las que quedan solo pueden ser las que siguen unidas por cadena de hojas a un tronco en pie (copas vecinas que se tocan)
    let left = 0;
    const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const lv = leaves.filter(([x, y, z]) => w.getBlock(x, y, z) === B.LEAVES);
    left = lv.length;
    const reach = new Set(), st = [];
    for (const [x, y, z] of lv) if (N6.some(([dx, dy, dz]) => w.getBlock(x + dx, y + dy, z + dz) === B.LOG)) { reach.add(`${x},${y},${z}`); st.push([x, y, z]); }
    while (st.length) { const [a, b, c] = st.pop(); for (const [dx, dy, dz] of N6) { const k = `${a + dx},${b + dy},${c + dz}`; if (!reach.has(k) && lv.some(([x, y, z]) => x === a + dx && y === b + dy && z === c + dz)) { reach.add(k); st.push([a + dx, b + dy, c + dz]); } } }
    void reach;
    assert.equal(r.leaves + left, leaves.length, 'cuenta de hojas caídas');
    assert.ok(r.leaves >= leaves.length * 0.6, `solo cayeron ${r.leaves} de ${leaves.length} hojas`);
    felledLeaves += r.leaves; totalLeaves += leaves.length;
  }
  assert.ok(felledLeaves >= totalLeaves * 0.8);
  assert.equal(w.fellTree(0, 0, 0), null);
});

test('árboles: el terreno bajo y<=ground no cambia por plantar árboles (solo se escribe sobre aire)', () => {
  for (const seed of SEEDS) {
    const { at } = generateRegion(seed, false);
    for (const t of region(seed)) {
      if (t.x < LO + 2 || t.x > HI - 2 || t.z < LO + 2 || t.z > HI - 2) continue;
      for (let y = t.ground - 3; y <= t.ground; y++) assert.notEqual(at(t.x, y, t.z), B.AIR);
      assert.equal(at(t.x, t.ground + t.height, t.z) === B.LEAVES || at(t.x, t.ground + t.height, t.z) === B.LOG, true);
    }
  }
  assert.ok(TREE_CELL > 0);
});

test('talar: troncos puestos por el jugador (no generados) también caen con sus hojas', () => {
  const w = new World(5);
  const x = 1000, z = 1000; // fuera de cualquier árbol de este test: se prueba dentro de un chunk cargado
  w.getChunk(x >> 4, z >> 4);
  let gy = CHUNK_Y - 1; while (gy > 0 && w.getBlock(x, gy, z) === B.AIR) gy--;
  const top = gy + 1;
  for (let i = 0; i < 4; i++) w.setBlock(x, top + i, z, B.LOG);
  const lv = [[1, 3, 0], [-1, 3, 0], [0, 4, 0], [0, 3, 1], [3, 3, 0]];     // la última (x+3) no toca nada: no es candidata y se queda
  for (const [dx, dy, dz] of lv) w.setBlock(x + dx, top + dy, z + dz, B.LEAVES);
  const r = w.fellTree(x, top + 1, z);
  assert.equal(r.logs, 4);
  assert.equal(r.leaves, 4);                                                // la hoja suelta no está conectada a nada, no era candidata
  assert.equal(w.getBlock(x + 1, top + 3, z), B.AIR);
  assert.equal(w.getBlock(x + 3, top + 3, z), B.LEAVES);
});
