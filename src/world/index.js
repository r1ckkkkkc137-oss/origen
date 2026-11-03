// Punto de entrada de src/world. Uso:  import { createWorld } from './world/index.js';  const world = createWorld(seed);
import { World } from './world.js';
export { World } from './world.js';
export { generateChunk, columnInfo, listTrees, treeBlocks, listCaveEntrances, BIOME, BIOME_NAMES, SPECIES, SPECIES_NAMES, TREE_HEIGHT } from './generator.js';
export { meshChunk } from './mesher.js';
export { STEP as ENTITY_STEP, ITEM_STICK, ITEM_SIZE_M, ITEM_TTL, MAX_ITEMS, FALL_MAX_TIME, rotatedOffset } from './entities.js';
export { createEntityView, meshBlockSet } from './entityView.js';
export { createPlayerBody, stepPlayer, playerEye, PLAYER_DEFAULTS, moveAndCollide, createBody, raycastBlocks, raycastMeters, collides, DEFAULTS as PHYSICS_DEFAULTS } from './physics.js';
export { B, BLOCKS, LAYER, IS_LOG, IS_LEAF, NATURAL_LOG, CUT_LOG, LEAF_OF } from './blocks.js';
export { Chunk, SEA_LEVEL, CHUNK_Y } from './chunk.js';
export { TILE_NAMES, BLOCK_TILES, ATLAS_COLS, ATLAS_ROWS, FACE, tileFor } from './tilemap.js';
export { BLOCK_SIZE_M, toBlocks, toMeters } from './units.js';
/** @param {number|string} seed @returns {World} */
export const createWorld = (seed) => new World(seed);
