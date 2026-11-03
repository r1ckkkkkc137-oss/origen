// Chunk SX x SY x SZ del contrato (16 x 64 x 16). Uint8Array con índice local idx = x + SX*(z + SZ*y) = x + z*16 + y*256 (== chunkIndex del contrato).
// Dimensiones en BLOQUES. Implementa el typedef Chunk del contrato: { cx, cz, blocks, dirty }.
import { CHUNK } from '../shared/contracts.js';
if (CHUNK.SX !== 16 || CHUNK.SZ !== 16) throw new Error('src/world asume chunks de 16x16 en XZ (índices con << 4)');
export const CHUNK_X = CHUNK.SX;
export const CHUNK_Z = CHUNK.SZ;
export const CHUNK_Y = CHUNK.SY;
export const CHUNK_AREA = CHUNK_X * CHUNK_Z;
export const CHUNK_VOLUME = CHUNK_AREA * CHUNK_Y;
export const SEA_LEVEL = 20; // el agua llega hasta y = SEA_LEVEL inclusive (bloques)

/** Índice local; sin validar rango. */
export const localIndex = (x, y, z) => x + (z << 4) + (y << 8);

export class Chunk {
  constructor(cx, cz, blocks) {
    this.cx = cx; this.cz = cz;
    this.blocks = blocks || new Uint8Array(CHUNK_VOLUME);
    this.dirty = true;  // contrato: la malla está desactualizada (true al generarse; World la pone en true al editar; quien remalla la baja)
    this.version = 0;   // se incrementa en cada set(); sirve para invalidar mallas
  }
  inBounds(x, y, z) { return x >= 0 && x < 16 && z >= 0 && z < 16 && y >= 0 && y < CHUNK_Y; }
  /** get local; fuera de rango devuelve 0 (aire). */
  get(x, y, z) { return this.inBounds(x, y, z) ? this.blocks[x + (z << 4) + (y << 8)] : 0; }
  /** set local; devuelve false si fuera de rango. */
  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false;
    this.blocks[x + (z << 4) + (y << 8)] = id; this.version++;
    return true;
  }
  /** Mayor y con bloque no-aire, o -1 si vacío. */
  topY() {
    const b = this.blocks;
    for (let i = CHUNK_VOLUME - 1; i >= 0; i--) if (b[i] !== 0) return i >> 8;
    return -1;
  }
}

/** Hash FNV-1a de 32 bits de un Uint8Array (para tests/bench de determinismo). */
export function hashBlocks(blocks) {
  let h = 0x811c9dc5;
  for (let i = 0; i < blocks.length; i++) { h ^= blocks[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
