// UNIDADES. Reglas del módulo (contrato v0.2b de Motor: "MUNDO (World, chunks, raycast) en BLOQUES; SIM y Skeleton3D en METROS"):
//  - Todo lo que el contrato define del World está en BLOQUES: getBlock/setBlock/dig/place (enteros), chunk(cx,cz), Chunk.blocks y
//    World.raycast(origin, dir, maxDist) (origin y maxDist en bloques; hit.dist en bloques).
//  - Lo que consume la SIM / el render está en METROS y se convierte en el borde con BLOCK_SIZE_M (una sola constante): physics.moveAndCollide
//    (cuerpos en m, m/s, m/s²), physics.raycastMeters / World.raycastM, World.ensureChunks(px,pz), AABBs de World.place, y las posiciones de
//    vértices del mesher (por defecto metros; opts.units='blocks' las deja en bloques para que el adaptador 3D escale).
//  - Todo el código interno trabaja en bloques; nada mezcla unidades dentro de una misma función.
// BLOCK_SIZE_M se lee del contrato (BLOCK_M; v0.2b = 0.5 m). Si el contrato no lo define (v0.1) se usa 1.
import * as contracts from '../shared/contracts.js';

export const BLOCK_SIZE_M = contracts.BLOCK_M ?? 1;
/** metros -> bloques (real) */
export const toBlocks = (m) => m / BLOCK_SIZE_M;
/** bloques -> metros (real) */
export const toMeters = (b) => b * BLOCK_SIZE_M;
