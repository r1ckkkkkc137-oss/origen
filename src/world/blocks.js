// Tabla de bloques. Los ids vienen de BLOCK en src/shared/contracts.js (no se inventan ids incompatibles).
// Aliases internos: LOG = BLOCK.WOOD, COAL = BLOCK.ORE (el "ORE" genérico del contrato es mena de carbón).
// IDs PROPUESTOS como adición al contrato (solo al final, sin renumerar): IRON 9, GRAVEL 10, SNOW 11, PLANKS 12.
// Si el contrato define alguno con el mismo nombre, se usa el del contrato.
import { BLOCK } from '../shared/contracts.js';

export const B = Object.freeze({
  AIR: BLOCK.AIR, GRASS: BLOCK.GRASS, DIRT: BLOCK.DIRT, STONE: BLOCK.STONE, LOG: BLOCK.WOOD, LEAVES: BLOCK.LEAVES,
  WATER: BLOCK.WATER, SAND: BLOCK.SAND, COAL: BLOCK.ORE,
  IRON: BLOCK.IRON ?? 9, GRAVEL: BLOCK.GRAVEL ?? 10, SNOW: BLOCK.SNOW ?? 11, PLANKS: BLOCK.PLANKS ?? 12,
});

/** Capa de render: 0 nada, 1 opaco, 2 recortado (hojas, alpha-test), 3 agua (blend). */
export const LAYER = Object.freeze({ NONE: 0, OPAQUE: 1, CUTOUT: 2, WATER: 3 });

// hardness: segundos base de rotura a mano (Infinity = no se puede romper). drop: id de bloque que suelta (0 = nada).
const DEFS = [
  { id: B.AIR,    name: 'air',    solid: false, transparent: true,  liquid: false, hardness: 0,        drop: 0 },
  { id: B.GRASS,  name: 'grass',  solid: true,  transparent: false, liquid: false, hardness: 0.6,      drop: B.DIRT },
  { id: B.DIRT,   name: 'dirt',   solid: true,  transparent: false, liquid: false, hardness: 0.5,      drop: B.DIRT },
  { id: B.STONE,  name: 'stone',  solid: true,  transparent: false, liquid: false, hardness: 1.5,      drop: B.STONE },
  { id: B.SAND,   name: 'sand',   solid: true,  transparent: false, liquid: false, hardness: 0.5,      drop: B.SAND },
  { id: B.WATER,  name: 'water',  solid: false, transparent: true,  liquid: true,  hardness: Infinity, drop: 0 },
  { id: B.LOG,    name: 'log',    solid: true,  transparent: false, liquid: false, hardness: 2.0,      drop: B.LOG },
  { id: B.LEAVES, name: 'leaves', solid: true,  transparent: true,  liquid: false, hardness: 0.2,      drop: 0 },
  { id: B.COAL,   name: 'coal',   solid: true,  transparent: false, liquid: false, hardness: 3.0,      drop: B.COAL },
  { id: B.IRON,   name: 'iron',   solid: true,  transparent: false, liquid: false, hardness: 3.0,      drop: B.IRON },
  { id: B.GRAVEL, name: 'gravel', solid: true,  transparent: false, liquid: false, hardness: 0.6,      drop: B.GRAVEL },
  { id: B.SNOW,   name: 'snow',   solid: true,  transparent: false, liquid: false, hardness: 0.2,      drop: B.SNOW },
  { id: B.PLANKS, name: 'planks', solid: true,  transparent: false, liquid: false, hardness: 1.0,      drop: B.PLANKS },
];

const byId = [];
for (const d of DEFS) byId[d.id] = Object.freeze({ ...d, layer: d.id === B.AIR ? LAYER.NONE : d.id === B.WATER ? LAYER.WATER : d.id === B.LEAVES ? LAYER.CUTOUT : LAYER.OPAQUE });
for (let i = 0; i < byId.length; i++) if (!byId[i]) throw new Error(`id de bloque ${i} sin definición (los ids deben ser contiguos)`);
export const BLOCKS = Object.freeze(byId);
export const BLOCK_COUNT = BLOCKS.length;

// Tablas planas por id (256 entradas) para rutas calientes. id 255 = "chunk vecino ausente": se trata como opaco (no genera caras).
export const IS_SOLID = new Uint8Array(256);
export const IS_OPAQUE = new Uint8Array(256);
export const IS_LIQUID = new Uint8Array(256);
export const LAYER_OF = new Uint8Array(256);
for (const d of BLOCKS) {
  IS_SOLID[d.id] = d.solid ? 1 : 0;
  IS_OPAQUE[d.id] = d.solid && !d.transparent ? 1 : 0;
  IS_LIQUID[d.id] = d.liquid ? 1 : 0;
  LAYER_OF[d.id] = d.layer;
}
IS_SOLID[255] = 1; IS_OPAQUE[255] = 1;

export const blockByName = (name) => BLOCKS.find((b) => b.name === name);
export const isValidBlock = (id) => Number.isInteger(id) && id >= 0 && id < BLOCK_COUNT;
