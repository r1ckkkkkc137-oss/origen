// Paridad completa Geometry2D (copia refactorizada) vs referencia KAGE f40b47d (copia intacta).
//   node scripts/parity-full.mjs [--ref /tmp/origen-combat-ref] [--n 12] [--workers 4]
// 28 pares de estilos x 3 niveles (10/50/85) x N seeds (N=12 => 1008). Compara por pelea: winner, method, detail, round,
// endTick, #eventos, hash del stream de eventos, hash de TODOS los ticks y hash del resultado completo. Bit a bit (-0 incluido).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fightDigest, fullSet } from '../digest.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

if (!isMainThread) {
  const { ref, cases } = workerData;
  const nw = await import(new URL('../core/index.js', import.meta.url));
  const rf = await import(pathToFileURL(path.join(ref, 'src/fight/index.js')));
  const diffs = [];
  let done = 0;
  for (const c of cases) {
    const a = fightDigest(rf, c.a, c.b, c.level, c.seed), b = fightDigest(nw, c.a, c.b, c.level, c.seed);
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ c, ref: a, now: b });
    if (++done % 25 === 0) parentPort.postMessage({ progress: 25 });
  }
  parentPort.postMessage({ diffs, done });
} else {
  const ref = arg('ref', '/tmp/origen-combat-ref');
  const per = Number(arg('n', 12)), W = Number(arg('workers', 4));
  const nw = await import('../core/index.js');
  const cases = fullSet(nw.STYLE_IDS, per);
  const pairs = new Set(cases.map((c) => c.a + '/' + c.b)), levels = new Set(cases.map((c) => c.level));
  const t0 = Date.now();
  console.log(`parity: ${cases.length} peleas, ${pairs.size} pares de estilos, niveles ${[...levels]}, ref=${ref}`);
  const chunks = Array.from({ length: W }, (_, i) => cases.filter((_, k) => k % W === i));
  let total = 0, prog = 0; const diffs = [];
  await Promise.all(chunks.map((cs) => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { ref, cases: cs } });
    w.on('message', (m) => { if (m.progress) { prog += m.progress; process.stderr.write(`\r${prog}/${cases.length}`); } else { total += m.done; diffs.push(...m.diffs); } });
    w.on('error', rej); w.on('exit', res);
  })));
  process.stderr.write('\n');
  console.log(`compared=${total} identical=${total - diffs.length} different=${diffs.length} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const d of diffs.slice(0, 10)) console.log('DIFF', JSON.stringify(d.c), '\n  ref', JSON.stringify(d.ref), '\n  new', JSON.stringify(d.now));
  process.exit(diffs.length ? 1 : 0);
}
