// World: implementa la interfaz World de src/shared/contracts.js (seed, getBlock, setBlock, chunk, chunks, raycast) y agrega
// edición de juego (dig/place), diff serializable, carga por radio y mallas.
// Unidades (ver units.js): argumentos ENTEROS = bloques; reales (raycast, ensureChunks, AABBs de place) = metros.
import { B, BLOCKS, IS_SOLID, IS_LIQUID, isValidBlock } from './blocks.js';
import { CHUNK_Y, localIndex } from './chunk.js';
import { generateChunk } from './generator.js';
import { meshChunk } from './mesher.js';
import { normalizeSeed } from './seed.js';
import { raycast } from './physics.js';
import { toBlocks } from './units.js';

const keyOf = (cx, cz) => `${cx},${cz}`;
export const chunkCoord = (v) => v >> 4;

export class World {
  /** @param {number|string} seed */
  constructor(seed) {
    this.seed = normalizeSeed(seed);
    this._chunks = new Map();  // key -> Chunk
    this.edits = new Map();    // key -> { cx, cz, m: Map<localIdx, { orig:number(-1=desconocido), id:number }> }
  }

  // ---------- chunks ----------
  /** Contrato: genera o devuelve el chunk. */
  chunk(cx, cz) { return this.getChunk(cx, cz); }
  /** Contrato: chunks actualmente cargados. */
  chunks() { return this._chunks.values(); }

  peekChunk(cx, cz) { return this._chunks.get(keyOf(cx, cz)) || null; }

  /** Devuelve el chunk, generándolo (y aplicando sus ediciones guardadas) si no está en caché. */
  getChunk(cx, cz) {
    const k = keyOf(cx, cz);
    let c = this._chunks.get(k);
    if (c) return c;
    c = generateChunk(this.seed, cx, cz);
    const e = this.edits.get(k);
    if (e) for (const [idx, v] of e.m) c.blocks[idx] = v.id;
    // la "original" de ediciones cargadas desde disco se desconoce (-1); la guardamos desde el generado limpio si hace falta
    this._chunks.set(k, c);
    return c;
  }

  unloadChunk(cx, cz) { return this._chunks.delete(keyOf(cx, cz)); }

  // ---------- bloques ----------
  /** Bloque en coords globales (enteras, bloques). Fuera de rango vertical (y<0, y>=SY) => AIR (contrato). Genera el chunk si hace falta. */
  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return B.AIR;
    const c = this.getChunk(x >> 4, z >> 4);
    return c.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)];
  }

  /** Escritura de bajo nivel (sin reglas de juego). Registra diff y marca chunk.dirty (y los vecinos cargados si es borde). true si CAMBIÓ. */
  setBlock(x, y, z, id) {
    if (y < 0 || y >= CHUNK_Y || !isValidBlock(id)) return false;
    const cx = x >> 4, cz = z >> 4;
    const c = this.getChunk(cx, cz);
    const lx = x & 15, lz = z & 15;
    const idx = localIndex(lx, y, lz);
    const prev = c.blocks[idx];
    if (prev === id) return false;
    c.blocks[idx] = id; c.version++;
    const k = keyOf(cx, cz);
    let e = this.edits.get(k);
    if (!e) { e = { cx, cz, m: new Map() }; this.edits.set(k, e); }
    const old = e.m.get(idx);
    const orig = old ? old.orig : prev;
    if (orig === id) { e.m.delete(idx); if (e.m.size === 0) this.edits.delete(k); }
    else e.m.set(idx, { orig, id });
    this._markDirty(cx, cz);
    if (lx === 0) this._markDirty(cx - 1, cz);
    if (lx === 15) this._markDirty(cx + 1, cz);
    if (lz === 0) this._markDirty(cx, cz - 1);
    if (lz === 15) this._markDirty(cx, cz + 1);
    return true;
  }

  _markDirty(cx, cz) { const c = this._chunks.get(keyOf(cx, cz)); if (c) c.dirty = true; }

  /** Lista {cx,cz} de los chunks cargados con chunk.dirty=true y les baja la bandera (quien llama debe remallarlos). */
  consumeDirty() {
    const r = [];
    for (const c of this._chunks.values()) if (c.dirty) { c.dirty = false; r.push({ cx: c.cx, cz: c.cz }); }
    return r;
  }

  /**
   * Rompe un bloque. Devuelve { broken, drop } (drop = id de bloque que suelta, 0 = nada) o null si no se puede
   * (aire, agua, fuera de rango).
   */
  dig(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return null;
    const id = this.getBlock(x, y, z);
    if (id === B.AIR || !Number.isFinite(BLOCKS[id].hardness)) return null;
    this.setBlock(x, y, z, B.AIR);
    return { broken: id, drop: BLOCKS[id].drop };
  }

  /**
   * ¿Se puede colocar `id` en (x,y,z) (enteros, bloques)? Reglas: rango válido, id no-aire, la celda es aire o agua, y toca (6 caras) un
   * bloque sólido (sin bloques flotando en el vacío). `solids` opcional: AABBs en METROS {minX,minY,minZ,maxX,maxY,maxZ} de entidades que
   * no deben quedar dentro del bloque (solo se chequea si el bloque a colocar es sólido).
   */
  canPlace(x, y, z, id, solids) {
    if (y < 0 || y >= CHUNK_Y || !isValidBlock(id) || id === B.AIR) return false;
    const cur = this.getBlock(x, y, z);
    if (cur !== B.AIR && !IS_LIQUID[cur]) return false;
    if (!(IS_SOLID[this.getBlock(x + 1, y, z)] || IS_SOLID[this.getBlock(x - 1, y, z)] || IS_SOLID[this.getBlock(x, y + 1, z)] ||
          IS_SOLID[this.getBlock(x, y - 1, z)] || IS_SOLID[this.getBlock(x, y, z + 1)] || IS_SOLID[this.getBlock(x, y, z - 1)])) return false;
    if (solids && IS_SOLID[id]) {
      for (const a of solids) {
        if (toBlocks(a.minX) < x + 1 && toBlocks(a.maxX) > x && toBlocks(a.minY) < y + 1 && toBlocks(a.maxY) > y &&
            toBlocks(a.minZ) < z + 1 && toBlocks(a.maxZ) > z) return false;
      }
    }
    return true;
  }

  /** Coloca un bloque si canPlace; devuelve true/false. */
  place(x, y, z, id, solids) {
    if (!this.canPlace(x, y, z, id, solids)) return false;
    return this.setBlock(x, y, z, id);
  }

  /** y del bloque sólido más alto de la columna (ignora agua), o -1. */
  surfaceY(x, z) {
    for (let y = CHUNK_Y - 1; y >= 0; y--) if (IS_SOLID[this.getBlock(x, y, z)]) return y;
    return -1;
  }

  // ---------- carga por radio ----------
  /**
   * Garantiza cargados los chunks a distancia <= radius (en chunks, círculo) de la posición mundo (px,pz) EN METROS, de cerca a lejos, y descarga
   * los que superan radius + unloadMargin. maxNew limita cuántos chunks se generan en esta llamada (reparto de carga entre frames).
   * Devuelve { added:[{cx,cz}], removed:[{cx,cz}], pending:n } (pending = chunks que faltan por generar).
   */
  ensureChunks(px, pz, radius, opts = {}) {
    const maxNew = opts.maxNew ?? Infinity, margin = opts.unloadMargin ?? 2;
    const pcx = Math.floor(toBlocks(px)) >> 4, pcz = Math.floor(toBlocks(pz)) >> 4;
    const want = [];
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= radius * radius) want.push([d2, pcx + dx, pcz + dz]);
    }
    want.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const added = []; let pending = 0;
    for (const [, cx, cz] of want) {
      if (this._chunks.has(keyOf(cx, cz))) continue;
      if (added.length >= maxNew) { pending++; continue; }
      this.getChunk(cx, cz); added.push({ cx, cz });
    }
    const removed = [];
    const ur = radius + margin;
    for (const [k, c] of this._chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > ur * ur) { this._chunks.delete(k); removed.push({ cx: c.cx, cz: c.cz }); }
    }
    return { added, removed, pending };
  }

  // ---------- raycast (contrato) ----------
  /**
   * Contrato: raycast(origin:[x,y,z], dir:[x,y,z], maxDist) con origen y distancia en METROS. Devuelve
   * { pos:[bx,by,bz] (bloque golpeado, enteros), normal:[nx,ny,nz] (cara golpeada), block:id, dist (m) } | null.
   * Atraviesa aire y agua. Extras en el hit: place:[bx,by,bz] (celda previa, donde se colocaría un bloque). Ver physics.raycast para opts.
   */
  raycast(origin, dir, maxDist = 6, opts) { return raycast(this, origin, dir, maxDist, opts); }

  // ---------- malla ----------
  /** Malla greedy del chunk (carga los 4 vecinos para que los bordes sean correctos). Ver mesher.js. */
  meshChunk(cx, cz) {
    const c = this.getChunk(cx, cz);
    const n = { px: this.getChunk(cx + 1, cz), nx: this.getChunk(cx - 1, cz), pz: this.getChunk(cx, cz + 1), nz: this.getChunk(cx, cz - 1) };
    return meshChunk(c, n);
  }

  // ---------- guardado ----------
  /** Diff serializable (JSON): solo ediciones reales (las que devuelven un bloque a su valor original se descartan). */
  serialize() {
    const chunks = [];
    for (const e of this.edits.values()) {
      const flat = [];
      for (const idx of [...e.m.keys()].sort((a, b) => a - b)) flat.push(idx, e.m.get(idx).id);
      if (flat.length) chunks.push({ cx: e.cx, cz: e.cz, edits: flat });
    }
    chunks.sort((a, b) => a.cx - b.cx || a.cz - b.cz);
    return { v: 1, seed: this.seed, chunks };
  }

  /** Reconstruye un World desde serialize(). Las ediciones se aplican al generar cada chunk. */
  static deserialize(data) {
    if (!data || data.v !== 1) throw new Error('formato de guardado desconocido');
    const w = new World(data.seed);
    w.loadEdits(data);
    return w;
  }

  /** Mezcla un diff en este mundo (descarga chunks afectados que estén cargados para que se regeneren con las ediciones). */
  loadEdits(data) {
    for (const ch of data.chunks) {
      const k = keyOf(ch.cx, ch.cz);
      const m = new Map();
      for (let i = 0; i < ch.edits.length; i += 2) m.set(ch.edits[i], { orig: -1, id: ch.edits[i + 1] });
      this.edits.set(k, { cx: ch.cx, cz: ch.cz, m });
      this._chunks.delete(k);
      this._markDirty(ch.cx, ch.cz);
    }
  }
}
