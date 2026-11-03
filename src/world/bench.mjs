// Benchmark REAL del módulo de mundo. Uso: node src/world/bench.mjs [seeds=1234,7] [grid=8]
// Por semilla: genera grid×grid chunks (cada uno cronometrado por separado) y malla los (grid-2)² interiores con sus 4 vecinos.
// Reporta N, media/mediana/p95 en ms y triángulos por chunk: greedy vs ingenua con culling vs sin culling. Nada se inventa: todo sale de esta corrida.
import os from 'node:os';
import { generateChunk } from './generator.js';
import { meshChunk, countNaive } from './mesher.js';
import { normalizeSeed } from './seed.js';

const seeds = (process.argv[2] ?? '1234,7').split(',').map((s) => (Number.isNaN(Number(s)) ? s : Number(s)));
const grid = Number(process.argv[3] ?? 8);
const now = () => performance.now();
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, mean: s.reduce((x, y) => x + y, 0) / s.length, median: q(0.5), p95: q(0.95), min: s[0], max: s[s.length - 1] }; };
const f = (x, d = 3) => x.toFixed(d);
const row = (name, st, unit = 'ms') => console.log(`  ${name.padEnd(34)} N=${String(st.n).padStart(4)}  media ${f(st.mean)}  mediana ${f(st.median)}  p95 ${f(st.p95)}  min ${f(st.min)}  max ${f(st.max)} ${unit}`);

console.log(`Node ${process.version} · ${os.cpus()[0]?.model} ×${os.cpus().length} · grid ${grid}×${grid}`);
// calentamiento (JIT) con una semilla aparte, no se cuenta
for (let i = 0; i < 6; i++) { const c = generateChunk(999, i, 0); meshChunk(c, null); }

const allGen = [], allMesh = [], allG = [], allN = [], allNC = [], allVerts = [], allBytes = [];
for (const seed of seeds) {
  const chunks = new Map(), tg = [];
  for (let cz = 0; cz < grid; cz++) for (let cx = 0; cx < grid; cx++) { const t0 = now(); const c = generateChunk(seed, cx, cz); tg.push(now() - t0); chunks.set(cx + ',' + cz, c); }
  const tm = [], gT = [], nT = [], ncT = [];
  for (let cz = 1; cz < grid - 1; cz++) for (let cx = 1; cx < grid - 1; cx++) {
    const c = chunks.get(cx + ',' + cz);
    const nb = { px: chunks.get((cx + 1) + ',' + cz), nx: chunks.get((cx - 1) + ',' + cz), pz: chunks.get(cx + ',' + (cz + 1)), nz: chunks.get(cx + ',' + (cz - 1)) };
    const t0 = now(); const m = meshChunk(c, nb); tm.push(now() - t0);
    const nv = countNaive(c, nb);
    gT.push(m.triangles); nT.push(nv.naiveTriangles); ncT.push(nv.noCullTriangles);
    allVerts.push(m.opaque.vertexCount + m.cutout.vertexCount + m.water.vertexCount);
    allBytes.push([m.opaque, m.cutout, m.water].reduce((s, l) => s + l.positions.byteLength + l.normals.byteLength + l.uvs.byteLength + l.tiles.byteLength + l.indices.byteLength, 0));
  }
  console.log(`\nsemilla ${seed} (uint32 ${normalizeSeed(seed)})`);
  row('generateChunk', stats(tg)); row('meshChunk (con 4 vecinos)', stats(tm));
  allGen.push(...tg); allMesh.push(...tm); allG.push(...gT); allN.push(...nT); allNC.push(...ncT);
}
console.log('\nTOTAL');
row('generateChunk', stats(allGen)); row('meshChunk (con 4 vecinos)', stats(allMesh));
const g = stats(allG), n = stats(allN), nc = stats(allNC), v = stats(allVerts), b = stats(allBytes);
console.log(`  triángulos/chunk (N=${g.n}):`);
console.log(`    greedy                 media ${f(g.mean, 0)}  mediana ${f(g.median, 0)}  p95 ${f(g.p95, 0)}`);
console.log(`    ingenua con culling    media ${f(n.mean, 0)}  mediana ${f(n.median, 0)}  p95 ${f(n.p95, 0)}   (greedy = ${f(100 * g.mean / n.mean, 1)}% de esta)`);
console.log(`    sin culling            media ${f(nc.mean, 0)}  mediana ${f(nc.median, 0)}  p95 ${f(nc.p95, 0)}   (greedy = ${f(100 * g.mean / nc.mean, 2)}% de esta)`);
console.log(`  vértices/chunk media ${f(v.mean, 0)} · memoria de malla/chunk media ${f(b.mean / 1024, 1)} KiB (p95 ${f(b.p95 / 1024, 1)} KiB)`);

// getBlock/solidAt (lo que consume Animador): patrón de muestreador de suelo = por columna, de y alto a bajo hasta el primer sólido. Mundo ya cargado.
{
  const { World } = await import('./world.js');
  const w = new World(seeds[0]); for (let cz = 0; cz < grid; cz++) for (let cx = 0; cx < grid; cx++) w.getChunk(cx, cz);
  const span = grid * 16, cols = 20000; let calls = 0, sink = 0;
  const run = (fn) => { calls = 0; const t0 = now(); for (let i = 0; i < cols; i++) { const x = (i * 37) % span, z = (i * 91) % span; for (let y = 62; y >= 0; y--) { calls++; if (fn(x, y, z)) { sink += y; break; } } } return (now() - t0); };
  run((x, y, z) => w.solidAt(x, y, z)); // calentamiento
  const ts = []; let n1 = 0;
  for (let k = 0; k < 7; k++) { ts.push(run((x, y, z) => w.solidAt(x, y, z))); n1 = calls; }
  const tg = []; for (let k = 0; k < 7; k++) tg.push(run((x, y, z) => w.getBlock(x, y, z) !== 0));
  const s1 = stats(ts), s2 = stats(tg);
  console.log(`\ngetBlock en mundo cargado (${grid}×${grid} chunks, ${cols} columnas por repetición, ${n1} llamadas/repetición, N=7 repeticiones; sink ${sink})`);
  console.log(`  solidAt  mediana ${f(1e6 * s1.median / n1, 1)} ns/llamada · getBlock mediana ${f(1e6 * s2.median / n1, 1)} ns/llamada`);
}

// stepPlayer (jugador de Motor): µs por llamada con dt=1/60 (= 2 subpasos de 1/120) sobre el mundo real cargado, caminando+saltando+sprint (input determinista, sin azar).
{
  const { World } = await import('./world.js');
  const { createPlayerBody, stepPlayer } = await import('./physics.js');
  const w = new World(seeds[0]); for (let cz = -2; cz < grid; cz++) for (let cx = -2; cx < grid; cx++) w.getChunk(cx, cz);
  const b = createPlayerBody({ x: 8, y: 100 * 0.5, z: 8 });
  const stepN = (n, t0i) => { for (let i = 0; i < n; i++) { const k = t0i + i; stepPlayer(w, b, { moveX: 0, moveZ: 1, jump: (k % 90) < 4, yaw: Math.floor(k / 120) * 0.9, sprint: true }, 1 / 60); } };
  stepN(600, 0);                                    // calentamiento
  const ts = [];
  for (let r = 0; r < 20; r++) { const t0 = now(); stepN(1000, 600 + r * 1000); ts.push((now() - t0) / 1000 * 1000); }   // µs por step
  const s = stats(ts);
  console.log(`\nstepPlayer (dt=1/60 → 2 subpasos; 20 lotes de 1000 steps, caminando+saltando+sprint sobre mundo real): µs/step  media ${f(s.mean, 1)}  mediana ${f(s.median, 1)}  p95 ${f(s.p95, 1)}  min ${f(s.min, 1)}  max ${f(s.max, 1)}`);
}
