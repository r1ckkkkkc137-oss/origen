// Punto de entrada de src/world. Uso:  import { createWorld } from './world/index.js';  const world = createWorld(seed);
import { World } from './world.js';
export { World } from './world.js';
export { generateChunk, columnInfo, listTrees, BIOME, BIOME_NAMES } from './generator.js';
export { meshChunk } from './mesher.js';
export { moveAndCollide, createBody, raycast, collides, DEFAULTS as PHYSICS_DEFAULTS } from './physics.js';
export { B, BLOCKS, LAYER } from './blocks.js';
export { Chunk, SEA_LEVEL, CHUNK_Y } from './chunk.js';
export { TILE_NAMES, BLOCK_TILES, ATLAS_COLS, ATLAS_ROWS, FACE, tileFor } from './tilemap.js';
export { BLOCK_SIZE_M, toBlocks, toMeters } from './units.js';
/** @param {number|string} seed @returns {World} */
export const createWorld = (seed) => new World(seed);
