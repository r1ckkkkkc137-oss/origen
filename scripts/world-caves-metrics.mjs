// Métricas de cuevas/minerales/entradas + costo de generateChunk. Uso: node scripts/world-caves-metrics.mjs [seed] [N chunks de lado]
// Determinista salvo los ms (reloj). Entrada = componente 4-conexo de columnas donde el bloque superior del terreno (y=h) quedó en AIRE
// (la cueva corta la superficie) y hay aire también en h-1 (no es solo un hoyo de un bloque).
import { generateChunk, columnInfo } from '../src/world/generator.js';
import { B } from '../src/world/blocks.js';
import { SEA_LEVEL, CHUNK_Y } from '../src/world/chunk.js';
const seed = Number(process.argv[2] ?? 1234), N = Number(process.argv[3] ?? 8);
const half = N >> 1;
const chunks = new Map();
const t0 = performance.now();
for (let cz = -half; cz < half; cz++) for (let cx = -half; cx < half; cx++) chunks.set(cx + ',' + cz, generateChunk(seed, cx, cz));
const genMs = performance.now() - t0;
// costo medio con 3 pasadas (regenerando; sampler ya caliente)
const reps = [];
for (let r = 0; r < 3; r++) { const a = performance.now(); for (let cz = -half; cz < half; cz++) for (let cx = -half; cx < half; cx++) generateChunk(seed, cx, cz); reps.push((performance.now() - a) / (N * N)); }
const get = (x, y, z) => { const c = chunks.get((x >> 4) + ',' + (z >> 4)); return c ? c.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)] : 255; };
const x0 = -half * 16, x1 = half * 16;
// histograma por y
const hist = { coal: new Array(CHUNK_Y).fill(0), iron: new Array(CHUNK_Y).fill(0), stone: new Array(CHUNK_Y).fill(0), air: new Array(CHUNK_Y).fill(0) };
let caveAir = 0, exposedOre = { coal: 0, iron: 0 }, totalOre = { coal: 0, iron: 0 };
let floatingAir = 0;
const open = new Set();   // columnas con boca
for (let z = z0(); z < x1; z++) for (let x = x0; x < x1; x++) {
  const h = columnInfo(seed, x, z).height;
  for (let y = 1; y < CHUNK_Y; y++) {
    const id = get(x, y, z);
    if (id === B.COAL) { hist.coal[y]++; totalOre.coal++; } else if (id === B.IRON) { hist.iron[y]++; totalOre.iron++; } else if (id === B.STONE) hist.stone[y]++;
    if ((id === B.COAL || id === B.IRON)) {
      const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, c]) => get(x + a, y + b, z + c) === B.AIR);
      if (nb) exposedOre[id === B.COAL ? 'coal' : 'iron']++;
    }
    if (id === B.AIR && y <= h - 1) { hist.air[y]++; caveAir++; }
  }
  if (h > SEA_LEVEL + 1 && get(x, h, z) === B.AIR && get(x, h - 1, z) === B.AIR) open.add(x + ',' + z);
}
function z0() { return x0; }
// componentes
const seen = new Set(); let comps = [];
for (const k of open) {
  if (seen.has(k)) continue;
  const st = [k]; seen.add(k); let n = 0;
  while (st.length) { const c = st.pop(); n++; const [x, z] = c.split(',').map(Number); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = (x + dx) + ',' + (z + dz); if (open.has(q) && !seen.has(q)) { seen.add(q); st.push(q); } } }
  comps.push(n);
}
const nch = N * N;
const bucket = (arr, lo, hi) => arr.slice(lo, hi + 1).reduce((a, b) => a + b, 0);
const bands = [[1, 7], [8, 15], [16, 23], [24, 31], [32, 47], [48, 63]];
const row = (name, a) => `${name.padEnd(5)} ` + bands.map(([l, h]) => `${l}-${h}:${bucket(a, l, h)}`.padEnd(11)).join('');
const out = {
  seed, chunks: nch, genMsFirstPass: +genMs.toFixed(0), genMsPerChunk: +(reps.reduce((a, b) => a + b) / reps.length).toFixed(2),
  caveAirBlocks: caveAir, coal: totalOre.coal, iron: totalOre.iron, exposedOre, coalPer1kStone: +(1000 * totalOre.coal / hist.stone.reduce((a, b) => a + b, 0)).toFixed(2), ironPer1kStone: +(1000 * totalOre.iron / hist.stone.reduce((a, b) => a + b, 0)).toFixed(2),
  entrances: comps.length, entrancesPerChunk: +(comps.length / nch).toFixed(3), chunksPerEntrance: comps.length ? +(nch / comps.length).toFixed(2) : null, entranceColumns: comps.sort((a, b) => b - a).slice(0, 12),
};
console.log(JSON.stringify(out));
console.log(row('coal', hist.coal)); console.log(row('iron', hist.iron)); console.log(row('air', hist.air));
if (process.env.HIST) { console.log('y coal iron'); for (let y = 1; y < CHUNK_Y; y++) console.log(String(y).padStart(2), String(hist.coal[y]).padStart(6), String(hist.iron[y]).padStart(6), String(hist.air[y]).padStart(7)); }
