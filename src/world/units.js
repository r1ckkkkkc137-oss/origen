// UNIDADES. Regla única del módulo:
//  - Coordenadas ENTERAS (getBlock/setBlock/dig/place, índices de chunk, Chunk.blocks) están en BLOQUES.
//  - Coordenadas REALES en espacio mundo (posiciones de vértices del mesh, cuerpos de physics, origen/dirección/distancia del raycast,
//    ensureChunks) están en METROS.
//  - Todo el código interno trabaja en bloques; se convierte en el borde con estas funciones. BLOCK_SIZE_M es la ÚNICA constante.
// BLOCK_SIZE_M se lee del contrato (contracts.js v0.2: BLOCK_M = 1). Si el contrato es v0.1 (sin BLOCK_M) se usa 1 (valor de v0.2).
import * as contracts from '../shared/contracts.js';

export const BLOCK_SIZE_M = contracts.BLOCK_M ?? 1;
/** metros -> bloques (real) */
export const toBlocks = (m) => m / BLOCK_SIZE_M;
/** bloques -> metros (real) */
export const toMeters = (b) => b * BLOCK_SIZE_M;
