import { Chunk } from '../../src/world/chunk.js';
import { World } from '../../src/world/world.js';
export { hashBlocks } from '../../src/world/chunk.js';

/** Mundo falso para físicas: getBlock(x,y,z) desde función. */
export class FakeWorld {
  constructor(fn) { this.fn = fn; }
  getBlock(x, y, z) { return this.fn(x, y, z); }
}
export function filledChunk(cx, cz, id, topY) {
  const c = new Chunk(cx, cz);
  for (let y = 0; y <= topY; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.blocks[x + (z << 4) + (y << 8)] = id;
  return c;
}
export { World };
