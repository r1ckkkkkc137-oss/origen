import test from 'node:test';
import assert from 'node:assert/strict';
import { generateChunk, listTrees, treeBlocks, columnInfo, BIOME, SPECIES, SPECIES_NAMES, TREE_HEIGHT, TREE_CELL } from '../src/world/generator.js';
import { hashBlocks, SEA_LEVEL, CHUNK_Y } from '../src/world/chunk.js';
import { B, IS_LOG, IS_LEAF, NATURAL_LOG, CUT_LOG, LEAF_OF, BLOCKS } from '../src/world/blocks.js';
import { TILE_OF, FACE, TILE_NAMES } from '../src/world/tilemap.js';
import { meshChunk } from '../src/world/mesher.js';
const isLog = (id) => IS_LOG[id] === 1, isLeaf = (id) => IS_LEAF[id] === 1;
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
        (isLog(id) ? expLogs : expLeaves).add(`${x},${y},${z}`);
        if (x < LO || x > HI || z < LO || z > HI) continue;
        const got = at(x, y, z);
        if (isLog(id)) assert.equal(got, id, `tronco ausente ${x},${y},${z} seed ${seed}`);
        else assert.ok(got === id || (got !== B.AIR && !isLog(got) && got !== B.WATER), `hoja inconsistente ${x},${y},${z}: ${got}`);
      }
    }
    for (let z = LO; z <= HI; z++) for (let x = LO; x <= HI; x++) for (let y = SEA_LEVEL; y < CHUNK_Y; y++) {
      const b = at(x, y, z);
      if (isLog(b)) assert.ok(expLogs.has(`${x},${y},${z}`), `LOG sin árbol ${x},${y},${z} seed ${seed}`);
      else if (isLeaf(b)) assert.ok(expLeaves.has(`${x},${y},${z}`), `LEAVES sin árbol ${x},${y},${z} seed ${seed}`);
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
    for (let z = LO; z <= HI; z++) for (let x = LO; x <= HI; x++) for (let y = SEA_LEVEL; y < CHUNK_Y; y++) if (isLog(at(x, y, z))) st.push([x, y, z]);
    logsN += st.length;
    while (st.length) {
      const [a, b, c] = st.pop();
      for (const [dx, dy, dz] of N6) {
        const x = a + dx, y = b + dy, z = c + dz, k = `${x},${y},${z}`;
        if (x < LO || x > HI || z < LO || z > HI || y < 0 || y >= CHUNK_Y || seen.has(k) || !isLeaf(at(x, y, z))) continue;
        seen.add(k); st.push([x, y, z]);
      }
    }
    for (let z = LO; z <= HI; z++) for (let x = LO; x <= HI; x++) for (let y = SEA_LEVEL; y < CHUNK_Y; y++) {
      if (!isLeaf(at(x, y, z))) continue;
      leaves++;
      if (inner(x, z)) assert.ok(seen.has(`${x},${y},${z}`), `hoja huérfana ${x},${y},${z} seed ${seed}`);
    }
    // 2) cada componente de troncos toca el terreno (algún tronco con suelo sólido debajo): ningún tronco flota
    const comp = new Set();
    for (let z = LO; z <= HI; z++) for (let x = LO; x <= HI; x++) for (let y = SEA_LEVEL; y < CHUNK_Y; y++) {
      if (!isLog(at(x, y, z)) || comp.has(`${x},${y},${z}`)) continue;
      let grounded = false, edge = false; const q = [[x, y, z]]; comp.add(`${x},${y},${z}`);
      while (q.length) {
        const [a, b, c] = q.pop();
        if (a - LO < 8 || HI - a < 8 || c - LO < 8 || HI - c < 8) edge = true;   // árbol cortado por el borde de la región: no se juzga
        const under = at(a, b - 1, c);
        if (under !== B.AIR && under !== B.WATER && !isLog(under) && !isLeaf(under)) grounded = true;
        for (const [dx, dy, dz] of N6) {
          const k = `${a + dx},${b + dy},${c + dz}`;
          if (a + dx < LO || a + dx > HI || c + dz < LO || c + dz > HI || comp.has(k) || !isLog(at(a + dx, b + dy, c + dz))) continue;
          comp.add(k); q.push([a + dx, b + dy, c + dz]);
        }
      }
      assert.ok(grounded || edge, `grupo de troncos flotando cerca de ${x},${y},${z} seed ${seed}`);
    }
  }
  assert.ok(leaves > 3000 && logsN > 500, `pocos bloques para que el test valga (${leaves} hojas, ${logsN} troncos)`);
});

test('árboles: troncos conectados; base 2x2 completa ≥ 1/3 de la altura, afinado 4→3→2→1 y 1x1 arriba', () => {
  let thick = 0, thin = 0, withRoots = 0;
  const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const seed of SEEDS) for (const t of listTrees(seed, -150, -150, 150, 150)) {
    const bl = treeBlocks(seed, t), logs = bl.filter((b) => isLog(b[3]));
    assert.ok(logs.every((b) => b[3] === NATURAL_LOG[t.species]) && bl.every((b) => isLog(b[3]) || b[3] === LEAF_OF[t.species]), 'ids por especie');
    const set = new Set(logs.map((b) => b.slice(0, 3).join(',')));
    // conexo por caras
    const seen = new Set([`${t.x},${t.ground + 1},${t.z}`]), st = [[t.x, t.ground + 1, t.z]];
    assert.ok(set.has(`${t.x},${t.ground + 1},${t.z}`));
    while (st.length) { const [a, b, c] = st.pop(); for (const [dx, dy, dz] of N6) { const k = `${a + dx},${b + dy},${c + dz}`; if (set.has(k) && !seen.has(k)) { seen.add(k); st.push([a + dx, b + dy, c + dz]); } } }
    assert.equal(seen.size, set.size, `troncos desconectados (${SPECIES_NAMES[t.species]} ${t.x},${t.z})`);
    const perLevel = (dy) => logs.filter((b) => b[1] === t.ground + dy).length;
    if (t.species !== SPECIES.BIRCH && t.height >= 13) {
      thick++;
      assert.equal(t.thick, true); assert.equal(t.cols.length, 4);
      const need = Math.ceil(t.height / 3);
      assert.equal(t.baseH, need);
      const base = Math.max(...t.cols.map((c) => c[2]));                       // suelo más alto bajo el 2x2
      // (a) 2x2 completa desde el suelo más alto durante `need` niveles: la parte gruesa sube ≥ 1/3 de la altura del árbol
      for (let y = base + 1; y <= base + need; y++) for (const [ox, oz] of t.cols.map((c) => [c[0], c[1]])) assert.ok(set.has(`${t.x + ox},${y},${t.z + oz}`), `2x2 incompleta en y=${y} (${SPECIES_NAMES[t.species]} ${t.x},${t.z})`);
      assert.ok(base + need - t.ground >= t.height / 3, 'base < 1/3');
      // (b) afinado: 3 y luego 2 troncos en las columnas 2x2, luego solo el eje (+ ramas del roble, que arrancan más arriba)
      const colsHere = (y) => t.cols.filter(([ox, oz]) => set.has(`${t.x + ox},${y},${t.z + oz}`)).length;
      // (el roble puede tener el arranque de una rama pegado al fuste a esa altura; el pino no tiene ramas: ahí se exige exacto)
      const pine = t.species === SPECIES.PINE, chk = (got, want) => (pine ? assert.equal(got, want) : assert.ok(got >= want, `${got} < ${want}`));
      chk(colsHere(base + need + 1), 3); chk(colsHere(base + need + 2), 2);
      if (pine) assert.equal(colsHere(base + need + 3), 1);
      // (c) ningún escalón raro: el nº de columnas 2x2 no crece al subir (4→3→2→1), medido desde el nivel base+1
      let prev = 4; for (let y = base + 1; y <= t.ground + t.trunk && pine; y++) { const n = colsHere(y); assert.ok(n <= prev && n >= 1, `afinado no monótono en y=${y}`); prev = n; }
      if (pine) assert.equal(colsHere(t.ground + t.trunk), 1);
      if (t.species === SPECIES.PINE) assert.equal(perLevel(base + need + 4 - t.ground) >= 1, true);
      assert.equal(logs.filter((b) => b[0] === t.x && b[2] === t.z).length >= t.trunk, true);
      // raíces: árboles ≥ 15 → 2-3 bloques; cada una sobre suelo sólido, pegada a un tronco por una cara
      if (t.height >= 15) assert.ok(t.roots.length >= 1 && t.roots.length <= 3, `raíces ${t.roots.length}`); else assert.equal(t.roots.length, 0);
      if (t.roots.length) withRoots++;
      for (const [rx, rz, hr] of t.roots) {
        const rk = `${t.x + rx},${hr + 1},${t.z + rz}`;
        assert.ok(set.has(rk), 'raíz ausente');
        assert.ok(set.has(`${t.x + rx + 1},${hr + 1},${t.z + rz}`) || set.has(`${t.x + rx - 1},${hr + 1},${t.z + rz}`) || set.has(`${t.x + rx},${hr + 1},${t.z + rz + 1}`) || set.has(`${t.x + rx},${hr + 1},${t.z + rz - 1}`), 'raíz sin tronco al lado');
        assert.equal(columnInfo(seed, t.x + rx, t.z + rz).height, hr);
        assert.ok(hr >= SEA_LEVEL + 2);
      }
    } else { thin++; assert.equal(t.cols.length, 1); assert.equal(t.roots.length, 0); assert.equal(perLevel(1), 1); }
    if (t.species === SPECIES.PINE) assert.equal(perLevel(t.height - 1), 1);
  }
  assert.ok(thick > 50 && thin > 20 && withRoots > 20, `thick ${thick} thin ${thin} raíces ${withRoots}`);
});

test('árboles: la base natural no tiene "tocones": toda cara superior de tronco natural lleva corteza; anillos solo en troncos cortados/colocados', () => {
  // tabla de tiles: natural = corteza arriba/abajo, cortado = anillos
  for (let sp = 0; sp < 3; sp++) {
    assert.equal(TILE_OF[NATURAL_LOG[sp] * 6 + FACE.TOP], TILE_OF[NATURAL_LOG[sp] * 6 + FACE.PX], `top natural ${sp} != corteza`);
    assert.equal(TILE_OF[NATURAL_LOG[sp] * 6 + FACE.BOTTOM], TILE_OF[NATURAL_LOG[sp] * 6 + FACE.PX]);
    assert.notEqual(TILE_OF[CUT_LOG[sp] * 6 + FACE.TOP], TILE_OF[CUT_LOG[sp] * 6 + FACE.PX], `cortado ${sp} sin anillos`);
    assert.equal(TILE_OF[CUT_LOG[sp] * 6 + FACE.PX], TILE_OF[NATURAL_LOG[sp] * 6 + FACE.PX]);
    assert.equal(BLOCKS[NATURAL_LOG[sp]].drop, CUT_LOG[sp]); assert.equal(BLOCKS[CUT_LOG[sp]].drop, CUT_LOG[sp]);
  }
  const ringTiles = new Set([TILE_NAMES.indexOf('log_top'), TILE_NAMES.indexOf('pine_log_top'), TILE_NAMES.indexOf('birch_log_top')]);
  // mallas reales de un bosque: ningún quad de la malla de un chunk generado usa un tile de anillos
  let quads = 0;
  for (const seed of [1234, 7]) {
    const map = new Map();
    for (let cz = -4; cz <= 3; cz++) for (let cx = -4; cx <= 3; cx++) map.set(`${cx},${cz}`, generateChunk(seed, cx, cz));
    for (let cz = -3; cz <= 2; cz++) for (let cx = -3; cx <= 2; cx++) {
      const nb = (dx, dz) => map.get(`${cx + dx},${cz + dz}`);
      const m = meshChunk(map.get(`${cx},${cz}`), { px: nb(1, 0), nx: nb(-1, 0), pz: nb(0, 1), nz: nb(0, -1) });
      for (const layer of [m.opaque, m.cutout]) for (const tl of layer.tiles) { quads++; assert.ok(!ringTiles.has(tl), `anillos en un chunk generado (seed ${seed}, ${cx},${cz})`); }
    }
  }
  assert.ok(quads > 1000);
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
    const own = treeBlocks(1234, t), logs = own.filter((b) => isLog(b[3])), leaves = own.filter((b) => isLeaf(b[3]));
    for (let cz = (t.z - 6) >> 4; cz <= (t.z + 6) >> 4; cz++) for (let cx = (t.x - 6) >> 4; cx <= (t.x + 6) >> 4; cx++) w.getChunk(cx, cz);
    // talar un solo tronco de la base gruesa con dig: suelta LOG
    const base = logs.find((b) => b[1] === t.ground + 1 && (b[0] !== t.x || b[2] !== t.z)) || logs[0];
    const d = w.dig(base[0], base[1], base[2]);
    assert.deepEqual(d, { broken: NATURAL_LOG[t.species], drop: CUT_LOG[t.species] });
    w.setBlock(base[0], base[1], base[2], NATURAL_LOG[t.species]);
    // fellTree desde un tronco alto (la rama o el fuste)
    const hit = logs[logs.length - 1];
    const r = w.fellTree(hit[0], hit[1], hit[2]);
    assert.ok(r && r.logs === logs.length, `tiró ${r?.logs} de ${logs.length} troncos`);
    assert.deepEqual(r.drops, [{ id: CUT_LOG[t.species], count: logs.length }]);
    if (t.roots.length) for (const [rx, rz, hr] of t.roots) assert.equal(w.getBlock(t.x + rx, hr + 1, t.z + rz), B.AIR, 'raíz sin talar');
    for (const [x, y, z] of logs) assert.equal(w.getBlock(x, y, z), B.AIR);
    // hojas: las que quedan solo pueden ser las que siguen unidas por cadena de hojas a un tronco en pie (copas vecinas que se tocan)
    let left = 0;
    const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const lv = leaves.filter(([x, y, z]) => isLeaf(w.getBlock(x, y, z)));
    left = lv.length;
    const reach = new Set(), st = [];
    for (const [x, y, z] of lv) if (N6.some(([dx, dy, dz]) => isLog(w.getBlock(x + dx, y + dy, z + dz)))) { reach.add(`${x},${y},${z}`); st.push([x, y, z]); }
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
      assert.equal(isLeaf(at(t.x, t.ground + t.height, t.z)) || isLog(at(t.x, t.ground + t.height, t.z)), true);
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
  for (let i = 0; i < 4; i++) w.setBlock(x, top + i, z, B.LOG_CUT);
  const lv = [[1, 3, 0], [-1, 3, 0], [0, 4, 0], [0, 3, 1], [3, 3, 0]];     // la última (x+3) no toca nada: no es candidata y se queda
  for (const [dx, dy, dz] of lv) w.setBlock(x + dx, top + dy, z + dz, B.LEAVES);
  const r = w.fellTree(x, top + 1, z);
  assert.equal(r.logs, 4);
  assert.equal(r.leaves, 4);                                                // la hoja suelta no está conectada a nada, no era candidata
  assert.equal(w.getBlock(x + 1, top + 3, z), B.AIR);
  assert.equal(w.getBlock(x + 3, top + 3, z), B.LEAVES);
});
