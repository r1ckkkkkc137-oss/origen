// Uso: node gen-hash.mjs <seed> <orden: forward|reverse|spiral> -> imprime JSON {"cx,cz": hash}
import { generateChunk } from '../../src/world/generator.js';
import { hashBlocks } from '../../src/world/chunk.js';
const seed = Number(process.argv[2]), order = process.argv[3] || 'forward';
const list = [];
for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) list.push([cx, cz]);
if (order === 'reverse') list.reverse();
if (order === 'spiral') list.sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])) || b[0] - a[0]);
const out = {};
for (const [cx, cz] of list) out[`${cx},${cz}`] = hashBlocks(generateChunk(seed, cx, cz).blocks);
const sorted = Object.fromEntries(Object.entries(out).sort());
process.stdout.write(JSON.stringify(sorted));
