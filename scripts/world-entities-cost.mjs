// Coste real de updateEntities: node scripts/world-entities-cost.mjs [seed]
import { createWorld } from '../src/world/index.js';
import { performance } from 'node:perf_hooks';
const seed = Number(process.argv[2] ?? 1234);
const w = createWorld(seed);
for (let cz = -4; cz < 4; cz++) for (let cx = -4; cx < 4; cx++) w.chunk(cx, cz);
const trees = [];
for (let x = -60; x < 60 && trees.length < 8; x++) for (let z = -60; z < 60 && trees.length < 8; z++) {
  for (let y = 15; y < 50; y++) {
    if (![4, 13, 15].includes(w.getBlock(x, y, z)) || [4, 13, 15].includes(w.getBlock(x, y - 1, z))) continue;
    if (!trees.some(t => Math.hypot(t[0] - x, t[2] - z) < 6)) trees.push([x, y, z]);
    break;
  }
}
let ms = 0, frames = 0, maxMs = 0, items = 0;
const t0 = performance.now();
for (const [x, y, z] of trees) w.fellTree(x, y, z, { fromX: x - 3, fromZ: z, leafDrops: 1 });
console.log('árboles cayendo', trees.length, 'fellTree total ms', (performance.now() - t0).toFixed(2));
for (let f = 0; f < 600; f++) {   // 10 s a 60 fps
  const a = performance.now(); w.updateEntities(1 / 60); const d = performance.now() - a;
  ms += d; frames++; maxMs = Math.max(maxMs, d); items = Math.max(items, w.itemDrops.length);
  if (f === 59) console.log('a 1 s: árboles', w.fallingTrees.length, 'items', w.itemDrops.length);
}
console.log(JSON.stringify({ frames, meanMsPerFrame: +(ms / frames).toFixed(4), maxMs: +maxMs.toFixed(3), maxItems: items, itemsAtEnd: w.itemDrops.length, treesAtEnd: w.fallingTrees.length }));
