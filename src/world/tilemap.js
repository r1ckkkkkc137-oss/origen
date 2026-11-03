// UN SOLO LUGAR para ajustar qué tile del atlas usa cada bloque en cada cara.
// El atlas es el de Rick Arte (/tmp/origen-art src/render/atlas.js, commit 82fee24): tiles de 16px, 4 columnas, índice = fila*4+col
// en el orden de TILE_NAMES. Los primeros 8 nombres coinciden con el TILES de Arte; los siguientes (sand..water) son PROPUESTOS:
// Arte debe agregarlos al final de su TILES en ESTE orden (o se cambia aquí el nombre/orden).
import { B, BLOCK_COUNT } from './blocks.js';

export const ATLAS_COLS = 4;
export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'log_side', 'log_top', 'planks', 'leaves', // existentes (Arte 82fee24)
  'sand', 'snow', 'gravel', 'coal_ore', 'iron_ore', 'water',                              // propuestos, pendientes en el atlas
];
export const ATLAS_ROWS = Math.ceil(TILE_NAMES.length / ATLAS_COLS);
export const tileIndex = (name) => { const i = TILE_NAMES.indexOf(name); if (i < 0) throw new Error(`tile desconocido: ${name}`); return i; };

/** Caras: 0:+x 1:-x 2:+y(top) 3:-y(bottom) 4:+z 5:-z */
export const FACE = Object.freeze({ PX: 0, NX: 1, TOP: 2, BOTTOM: 3, PZ: 4, NZ: 5 });
export const faceKind = (face) => (face === FACE.TOP ? 'top' : face === FACE.BOTTOM ? 'bottom' : 'side');

// Mapa blockId -> nombre de tile. String = misma textura en todas las caras; objeto = { top, side, bottom } (faltantes caen a side).
export const BLOCK_TILES = {
  [B.GRASS]:  { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  [B.DIRT]:   'dirt',
  [B.STONE]:  'stone',
  [B.SAND]:   'sand',
  [B.WATER]:  'water',
  [B.LOG]:    { top: 'log_top', side: 'log_side', bottom: 'log_top' },
  [B.LEAVES]: 'leaves',
  [B.COAL]:   'coal_ore',
  [B.IRON]:   'iron_ore',
  [B.GRAVEL]: 'gravel',
  [B.SNOW]:   'snow',
  [B.PLANKS]: 'planks',
};

/** Índice de tile para (bloque, cara). Se usa también en tests. */
export function tileFor(id, face) {
  const m = BLOCK_TILES[id];
  if (m === undefined) return 0;
  if (typeof m === 'string') return tileIndex(m);
  const kind = faceKind(face);
  return tileIndex(m[kind] ?? m.side);
}

// Tabla plana TILE_OF[id*6+face] para el mesher.
export const TILE_OF = new Uint8Array(256 * 6);
for (let id = 0; id < BLOCK_COUNT; id++) for (let f = 0; f < 6; f++) TILE_OF[id * 6 + f] = id === B.AIR ? 0 : tileFor(id, f);
