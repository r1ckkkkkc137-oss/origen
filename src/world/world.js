// World: implementa la interfaz World de src/shared/contracts.js (seed, getBlock, setBlock, chunk, chunks, raycast) y agrega
// edición de juego (dig/place), diff serializable, carga por radio y mallas.
// Unidades (ver units.js): contrato v0.2 = mundo en BLOQUES (getBlock/setBlock/chunk/raycast). Helpers de la sim con reales en METROS:
// ensureChunks, raycastM, AABBs de place, meshChunk (posiciones, por defecto).
import { B, BLOCKS, IS_SOLID, IS_LIQUID, IS_LOG, IS_LEAF, isValidBlock } from './blocks.js';
import { CHUNK_Y, localIndex } from './chunk.js';
import { generateChunk, listTrees, treeBlocks } from './generator.js';
import { meshChunk } from './mesher.js';
import { normalizeSeed } from './seed.js';
import { raycastBlocks, raycastMeters } from './physics.js';
import { toBlocks } from './units.js';
import { createEntityState, createFallingTree, fallDirection, updateEntities as _updateEntities, stepEntities as _stepEntities, pickupItems as _pickupItems } from './entities.js';

const keyOf = (cx, cz) => `${cx},${cz}`;
export const chunkCoord = (v) => v >> 4;

const LEAF_CHAIN_REACH = 7, LEAF_DECAY_DIST = 4;

export class World {
  /** @param {number|string} seed */
  constructor(seed) {
    this.seed = normalizeSeed(seed);
    this._chunks = new Map();  // key -> Chunk
    this._last = null;         // último chunk consultado (caché)
    this.edits = new Map();    // key -> { cx, cz, m: Map<localIdx, { orig:number(-1=desconocido), id:number }> }
    this.entities = createEntityState(); // árboles cayendo e items sueltos (transitorio: no entra en serialize())
  }

  // ---------- chunks ----------
  /** Contrato: genera o devuelve el chunk. */
  chunk(cx, cz) { return this.getChunk(cx, cz); }
  /** Contrato: chunks actualmente cargados. */
  chunks() { return this._chunks.values(); }

  peekChunk(cx, cz) { return this._chunks.get(keyOf(cx, cz)) || null; }

  /** Devuelve el chunk, generándolo (y aplicando sus ediciones guardadas) si no está en caché. */
  getChunk(cx, cz) {
    const l = this._last;                                  // caché de 1 entrada: getBlock/solidAt consecutivos casi siempre caen en el mismo chunk
    if (l && l.cx === cx && l.cz === cz) return l;
    const k = keyOf(cx, cz);
    let c = this._chunks.get(k);
    if (c) { this._last = c; return c; }
    c = generateChunk(this.seed, cx, cz);
    const e = this.edits.get(k);
    if (e) for (const [idx, v] of e.m) c.blocks[idx] = v.id;
    // la "original" de ediciones cargadas desde disco se desconoce (-1); la guardamos desde el generado limpio si hace falta
    this._chunks.set(k, c); this._last = c;
    return c;
  }

  unloadChunk(cx, cz) { this._last = null; return this._chunks.delete(keyOf(cx, cz)); }

  // ---------- bloques ----------
  /** Bloque en coords globales (enteras, bloques). Fuera de rango vertical (y<0, y>=SY) => AIR (contrato). Genera el chunk si hace falta. */
  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return B.AIR;
    const c = this.getChunk(x >> 4, z >> 4);
    return c.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)];
  }

  /**
   * ¿Celda sólida? (x,y,z enteros, BLOQUES). Es el `getBlock` que espera Animador (`createAnimator3D({ getBlock: (x,y,z)=>world.solidAt(x,y,z), blockM: BLOCK_M })`):
   * `world.getBlock` devuelve el id (el agua, id 6, es truthy y NO es suelo). y<0 cuenta como suelo (igual que physics); y>=SY, no.
   */
  solidAt(x, y, z) {
    if (y < 0) return true;
    if (y >= CHUNK_Y) return false;
    const c = this.getChunk(x >> 4, z >> 4);
    return IS_SOLID[c.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)]] === 1;
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
   * Tala un árbol entero a partir de UN bloque de tronco (sirve con troncos gruesos 2x2 y ramas): quita todos los LOG conectados por
   * caras (hasta maxLogs) y deja caer sus hojas: las del árbol generado dueño de esos troncos (exacto, no toca copas vecinas) o, si los
   * troncos no son de un árbol generado, las que quedan a más de LEAF_DECAY_DIST hojas de un tronco en pie. Devuelve
   * { logs, leaves, drops: [{ id, count }], tree, direction } o null si (x,y,z) no es un tronco. Cada cambio pasa por setBlock (diff y dirty normales).
   *
   * Firmas (retrocompatible):
   *  - fellTree(x,y,z) / fellTree(x,y,z,maxLogs:number): comportamiento de siempre. Instantáneo: sin entidad (tree = null, direction = null);
   *    el que llama acredita r.drops.
   *  - fellTree(x,y,z,{ fromX, fromZ, dirX, dirZ, maxLogs, instant, leafDrops }): el árbol CAE como entidad FallingTree. fromX/fromZ = de dónde viene
   *    el golpe (bloques, p.ej. la posición del jugador / BLOCK_M): cae en sentido opuesto. dirX/dirZ = vector del golpe (cae en ese sentido; gana
   *    sobre from). Sin dirección: ángulo por hash3 de la base (determinista). instant:true = como la firma vieja. Con entidad, r.drops describe lo
   *    que SE SOLTARÁ al impactar (lo mismo que antes); NO acreditarlo: llegan como ItemDrop y se recogen con world.pickupItems.
   */
  fellTree(x, y, z, arg = 4096) {
    if (!IS_LOG[this.getBlock(x, y, z)]) return null;
    const opts = typeof arg === 'object' && arg !== null ? arg : null;
    const maxLogs = typeof arg === 'number' ? arg : (opts && Number.isFinite(opts.maxLogs) ? opts.maxLogs : 4096);
    const animate = !!opts && !opts.instant;
    const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const key = (a, b, c) => `${a},${b},${c}`;
    const logs = [], seen = new Set([key(x, y, z)]), st = [[x, y, z]];
    while (st.length && logs.length < maxLogs) {
      const [a, b, c] = st.pop(); logs.push([a, b, c]);
      for (const [dx, dy, dz] of N6) {
        const k = key(a + dx, b + dy, c + dz);
        if (!seen.has(k) && IS_LOG[this.getBlock(a + dx, b + dy, c + dz)]) { seen.add(k); st.push([a + dx, b + dy, c + dz]); }
      }
    }
    const dropCount = new Map(), logBlocks = [], leafBlocks = [];
    for (const [a, b, c] of logs) { const id = this.getBlock(a, b, c); const d = BLOCKS[id].drop; dropCount.set(d, (dropCount.get(d) ?? 0) + 1); logBlocks.push([a, b, c, id]); this.setBlock(a, b, c, B.AIR); }
    let leaves = 0;
    // 1) árboles generados: las hojas son EXACTAMENTE las del árbol dueño de los troncos (treeBlocks), así una copa vecina que solo se toca no se ve afectada
    const owned = new Set();
    let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
    for (const [a, , c] of logs) { mnx = Math.min(mnx, a); mxx = Math.max(mxx, a); mnz = Math.min(mnz, c); mxz = Math.max(mxz, c); }
    for (const t of listTrees(this.seed, mnx - 1, mnz - 1, mxx + 1, mxz + 1)) {
      const bl = treeBlocks(this.seed, t);
      if (!bl.some((q) => IS_LOG[q[3]] && seen.has(key(q[0], q[1], q[2])))) continue;
      for (const q of bl) {
        if (IS_LOG[q[3]]) owned.add(key(q[0], q[1], q[2]));
        else if (q[3] === this.getBlock(q[0], q[1], q[2]) && this.setBlock(q[0], q[1], q[2], B.AIR)) { leaves++; leafBlocks.push([q[0], q[1], q[2], q[3]]); }
      }
    }
    // 2) troncos que no son de un árbol generado: decay genérico (hojas a ≤ LEAF_DECAY_DIST de cadena de un tronco en pie sobreviven)
    if (logs.some(([a, b, c]) => !owned.has(key(a, b, c)))) {
      const cand = new Map();
      let fr = [];
      const addC = (a, b, c) => { const k = key(a, b, c); if (!cand.has(k) && IS_LEAF[this.getBlock(a, b, c)]) { cand.set(k, [a, b, c]); fr.push([a, b, c]); } };
      for (const [a, b, c] of logs) if (!owned.has(key(a, b, c))) for (const [dx, dy, dz] of N6) addC(a + dx, b + dy, c + dz);
      for (let d = 1; d < LEAF_CHAIN_REACH && fr.length; d++) { const cur = fr; fr = []; for (const [a, b, c] of cur) for (const [dx, dy, dz] of N6) addC(a + dx, b + dy, c + dz); }
      const supported = new Set();
      fr = [];
      for (const [k, [a, b, c]] of cand) if (N6.some(([dx, dy, dz]) => IS_LOG[this.getBlock(a + dx, b + dy, c + dz)])) { supported.add(k); fr.push([a, b, c]); }
      for (let d = 1; d < LEAF_DECAY_DIST && fr.length; d++) {
        const cur = fr; fr = [];
        for (const [a, b, c] of cur) for (const [dx, dy, dz] of N6) { const k = key(a + dx, b + dy, c + dz); if (cand.has(k) && !supported.has(k)) { supported.add(k); fr.push([a + dx, b + dy, c + dz]); } }
      }
      for (const [k, [a, b, c]] of cand) if (!supported.has(k)) { const id = this.getBlock(a, b, c); if (this.setBlock(a, b, c, B.AIR)) { leaves++; leafBlocks.push([a, b, c, id]); } }
    }
    const result = { logs: logs.length, leaves, drops: [...dropCount].map(([id, count]) => ({ id, count })), tree: null, direction: null };
    if (animate) {
      // base = bloques de tronco del nivel más bajo
      let yMin = Infinity; for (const l of logBlocks) if (l[1] < yMin) yMin = l[1];
      let cx = 0, cz = 0, n = 0;
      for (const l of logBlocks) if (l[1] === yMin) { cx += l[0] + 0.5; cz += l[2] + 0.5; n++; }
      cx /= n; cz /= n;
      const d = fallDirection(this.seed, cx, cz, [Math.floor(cx), yMin, Math.floor(cz)], opts);
      const tree = createFallingTree(this, this.entities.nextId++, logBlocks, leafBlocks, d);
      tree.opts = { leafDrops: !!opts.leafDrops };
      this.entities.trees.push(tree);
      this.entities.events.push({ type: 'fell', treeId: tree.id, x: tree.pivotM[0], y: tree.pivotM[1], z: tree.pivotM[2], logs: logs.length, leaves });
      result.tree = tree; result.direction = [d[0], d[1]];
    }
    return result;
  }

  // ---------- entidades (árbol que cae, items) ----------
  /** Avanza las entidades dt segundos con subpasos fijos de 1/120 s (acumulador). Devuelve cuántos subpasos hizo. */
  updateEntities(dt) { return _updateEntities(this, this.entities, dt); }
  /** Exactamente n subpasos fijos (para tests/replays: sin acumulador). */
  stepEntities(n = 1) { for (let i = 0; i < n; i++) _stepEntities(this, this.entities); return n; }
  /** Quita y devuelve los items a <= radiusM metros de pos ([x,y,z] o {x,y,z}, metros): [{ id, count, x, y, z }]. id = bloque (CUT_LOG...) o ITEM_STICK. */
  pickupItems(pos, radiusM = 1.5) { return _pickupItems(this.entities, pos, radiusM); }
  /** Árboles cayendo (solo lectura) e items vivos (solo lectura). */
  get fallingTrees() { return this.entities.trees; }
  get itemDrops() { return this.entities.items; }
  /** Eventos pendientes ({type:'fell'|'impact', ...}, en metros) para sonido/partículas; vacía la cola. */
  consumeEntityEvents() { const e = this.entities.events; this.entities.events = []; return e; }
  /** Termina de caer (instantáneamente, pasos fijos) todos los árboles en vuelo, p.ej. antes de guardar. Devuelve cuántos pasos usó. */
  settleEntities(maxSteps = 2000) { let n = 0; while (this.entities.trees.length && n < maxSteps) { _stepEntities(this, this.entities); n++; } return n; }

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
   * Garantiza cargados los chunks a distancia <= radius (en chunks, círculo; radio fraccionario permitido: solo es el umbral de distancia, las coords de chunk son siempre enteras) de la posición mundo (px,pz) EN METROS, de cerca a lejos, y descarga
   * los que superan radius + unloadMargin. maxNew limita cuántos chunks se generan en esta llamada (reparto de carga entre frames).
   * Devuelve { added:[{cx,cz}], removed:[{cx,cz}], pending:n } (pending = chunks que faltan por generar).
   */
  ensureChunks(px, pz, radius, opts = {}) {
    const maxNew = opts.maxNew ?? Infinity, margin = opts.unloadMargin ?? 2;
    const pcx = Math.floor(toBlocks(px)) >> 4, pcz = Math.floor(toBlocks(pz)) >> 4;
    const want = [], R = Math.floor(radius), r2 = radius * radius;   // desplazamientos SIEMPRE enteros; un radio fraccionario (4.5) solo es el umbral de la distancia circular dx²+dz² <= r²
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= r2) want.push([d2, pcx + dx, pcz + dz]);
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
      if (dx * dx + dz * dz > ur * ur) { this._chunks.delete(k); this._last = null; removed.push({ cx: c.cx, cz: c.cz }); }
    }
    return { added, removed, pending };
  }

  // ---------- raycast ----------
  /**
   * CONTRATO v0.2 (mundo en BLOQUES): raycast(origin:[x,y,z], dir:[x,y,z], maxDist) con origen y maxDist en BLOQUES; hit.dist en bloques.
   * Devuelve { pos:[bx,by,bz], normal, block, dist, place:[bx,by,bz] (celda previa: extra, donde se colocaría un bloque) } o null.
   * Atraviesa aire y agua (opts.hitLiquid=true golpea agua). Ver physics.raycastBlocks.
   */
  raycast(origin, dir, maxDist = 6, opts) { return raycastBlocks(this, origin, dir, maxDist, opts); }
  /** Igual pero con origin y maxDist en METROS (espacio de la sim) y hit.dist en METROS. */
  raycastM(originM, dir, maxDistM = 3, opts) { return raycastMeters(this, originM, dir, maxDistM, opts); }

  // ---------- malla ----------
  /** Malla greedy del chunk (carga los 4 vecinos para que los bordes sean correctos). opts.units: 'meters' (defecto) | 'blocks'. Ver mesher.js. */
  meshChunk(cx, cz, opts) {
    const c = this.getChunk(cx, cz);
    const n = { px: this.getChunk(cx + 1, cz), nx: this.getChunk(cx - 1, cz), pz: this.getChunk(cx, cz + 1), nz: this.getChunk(cx, cz - 1) };
    return meshChunk(c, n, opts);
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
      this._chunks.delete(k); this._last = null;
      this._markDirty(ch.cx, ch.cz);
    }
  }
}
