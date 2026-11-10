// VISTA de las entidades del mundo (árbol que cae + items). No importa three: recibe THREE por parámetro (igual que threeAdapter.js).
//   const ev = createEntityView(THREE, scene, world, atlas, { tileNames: TILES });   // atlas = createAtlas(seed)
//   // cada frame, DESPUÉS de world.updateEntities(dt):
//   ev.update();                       // sincroniza: una malla por árbol cayendo (se malla UNA vez) + cubitos de items (una sola malla dinámica)
//   ev.stats() -> { trees, items, triangles, drawCalls }
// Un árbol se malla una sola vez al aparecer (caras visibles entre SUS bloques, en metros, relativas al pivote) y después solo cambia el
// transform del grupo: position = pivote (m), quaternion = giro θ alrededor del eje horizontal a = up x d. Los items son cubos de 0.2 m.
import { IS_OPAQUE, LAYER_OF, IS_LEAF } from './blocks.js';
import { TILE_OF } from './tilemap.js';
import { BLOCK_SIZE_M as S } from './units.js';
import { buildTileMap, createGeometry, createVoxelMaterial } from './threeAdapter.js';
import { ITEM_SIZE_M, ITEM_STICK, MAX_ITEMS } from './entities.js';
import { ATLAS_COLS, ATLAS_ROWS, TILE_NAMES } from './tilemap.js';

const FACE_DIR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

class Buf {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.tile = []; this.idx = []; this.n = 0; }
  finish() {
    const vc = this.n, Idx = vc > 65535 ? Uint32Array : Uint16Array;
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), uvs: new Float32Array(this.uv), tiles: new Uint8Array(this.tile), indices: Idx.from(this.idx), vertexCount: vc, triangleCount: this.idx.length / 3 };
  }
}

// emite el quad 1x1 de la cara `face` del bloque en (bx,by,bz) (relativo al origen, en bloques); mismas convenciones de vértices/UV/winding que mesher.js
function emitFace(buf, bx, by, bz, face, tile) {
  const d = face >> 1, front = (face & 1) === 0, u = (d + 1) % 3, v = (d + 2) % 3, B3 = [bx, by, bz];
  const i = B3[d] + (front ? 1 : 0), u0 = B3[u], v0 = B3[v];
  const P = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const uv = [[u0, v0], [u0 + 1, v0], [u0 + 1, v0 + 1], [u0, v0 + 1]];
  for (let k = 0; k < 4; k++) { P[k][d] = i; P[k][u] = uv[k][0]; P[k][v] = uv[k][1]; }
  let UV;
  if (d === 0) { const s0 = front ? 1 : 0, s1 = front ? 0 : 1; UV = [s0, 0, s0, 1, s1, 1, s1, 0]; }
  else if (d === 1) UV = [0, 0, 0, 1, 1, 1, 1, 0];
  else if (front) UV = [0, 0, 1, 0, 1, 1, 0, 1];
  else UV = [1, 0, 0, 0, 0, 1, 1, 1];
  const n = buf.n, sg = front ? 1 : -1;
  for (const p of P) buf.pos.push(p[0] * S, p[1] * S, p[2] * S);
  for (let k = 0; k < 4; k++) buf.nor.push(d === 0 ? sg : 0, d === 1 ? sg : 0, d === 2 ? sg : 0);
  buf.uv.push(...UV); buf.tile.push(tile, tile, tile, tile);
  if (front) buf.idx.push(n, n + 1, n + 2, n, n + 2, n + 3); else buf.idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
  buf.n += 4;
}

/**
 * Malla un conjunto de bloques [{x,y,z,id}] (coords enteras de mundo) relativa al punto `pivot` ([x,y,z] en bloques). Posiciones en METROS.
 * Devuelve { opaque, cutout } con el formato de capa del mesher (sirve con createGeometry). Caras ocultas entre bloques del propio conjunto se descartan.
 */
export function meshBlockSet(blocks, pivot) {
  const at = new Map(), K = (x, y, z) => `${x},${y},${z}`;
  for (const b of blocks) at.set(K(b.x, b.y, b.z), b.id);
  const bufs = [null, new Buf(), new Buf()];
  for (const b of blocks) {
    const layer = LAYER_OF[b.id] === 2 ? 2 : 1;
    for (let f = 0; f < 6; f++) {
      const dd = FACE_DIR[f], nb = at.get(K(b.x + dd[0], b.y + dd[1], b.z + dd[2])) ?? 0;
      const visible = nb === 0 || (!IS_OPAQUE[nb] && nb !== b.id);
      if (visible) emitFace(bufs[layer], b.x - pivot[0], b.y - pivot[1], b.z - pivot[2], f, TILE_OF[b.id * 6 + f]);
    }
  }
  return { opaque: bufs[1].finish(), cutout: bufs[2].finish() };
}

export function createEntityView(THREE, scene, world, atlas, opts = {}) {
  const { map: tileMap, missing } = buildTileMap(opts.tileNames ?? TILE_NAMES);
  const grid = atlas.canvas ? { cols: Math.round(atlas.canvas.width / (opts.tilePx ?? 16)), rows: Math.round(atlas.canvas.height / (opts.tilePx ?? 16)) } : { cols: ATLAS_COLS, rows: ATLAS_ROWS };
  const matOpaque = createVoxelMaterial(THREE, atlas.texture, 'opaque', grid), matCutout = createVoxelMaterial(THREE, atlas.texture, 'cutout', grid);
  const group = new THREE.Group(); group.name = 'entities'; scene.add(group);
  const trees = new Map();          // treeId -> { group, geos }
    const axis = new THREE.Vector3();
  let triangles = 0, drawCalls = 0;

  function addTree(t) {
    const g = new THREE.Group(), geos = [];
    const mesh = meshBlockSet([...t.logs, ...t.leaves], t.pivot);
    for (const [layer, mat] of [[mesh.opaque, matOpaque], [mesh.cutout, matCutout]]) {
      if (layer.triangleCount === 0) continue;
      const geo = createGeometry(THREE, layer, { tileMap }); geos.push(geo);
      g.add(new THREE.Mesh(geo, mat)); triangles += layer.triangleCount;
    }
    g.position.set(t.pivotM[0], t.pivotM[1], t.pivotM[2]);
    group.add(g); trees.set(t.id, { group: g, geos, tris: mesh.opaque.triangleCount + mesh.cutout.triangleCount });
  }
  function dropTree(id) { const e = trees.get(id); group.remove(e.group); e.geos.forEach((x) => x.dispose()); triangles -= e.tris; trees.delete(id); }

  // items: UNA sola malla dinámica (el ShaderMaterial de voxel no soporta instancing): cubos de ITEM_SIZE_M con el tile lateral del bloque.
  // Plantilla de un cubo (24 vértices, ya en metros, centrado) y buffers preasignados para MAX_ITEMS cubos; por frame solo se reescriben posiciones/tiles.
  const tpl = new Buf(), isc = ITEM_SIZE_M / S;   // la cara base es 1 bloque: se centra y se escala a ITEM_SIZE_M
  for (let f = 0; f < 6; f++) emitFace(tpl, -0.5, -0.5, -0.5, f, 0);
  const CAP = MAX_ITEMS, VPI = 24, IPI = 36;
  const iPos = new Float32Array(CAP * VPI * 3), iNor = new Float32Array(CAP * VPI * 3), iUv = new Float32Array(CAP * VPI * 2), iTile = new Uint8Array(CAP * VPI), iIdx = new Uint16Array(CAP * IPI);
  for (let i = 0; i < CAP; i++) { iNor.set(tpl.nor, i * VPI * 3); iUv.set(tpl.uv, i * VPI * 2); for (let k = 0; k < IPI; k++) iIdx[i * IPI + k] = tpl.idx[k] + i * VPI; }
  const iGeo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(iPos, 3), aTile = new THREE.BufferAttribute(iTile, 1);
  aPos.setUsage?.(THREE.DynamicDrawUsage); aTile.setUsage?.(THREE.DynamicDrawUsage);
  iGeo.setAttribute('position', aPos); iGeo.setAttribute('normal', new THREE.BufferAttribute(iNor, 3)); iGeo.setAttribute('uv', new THREE.BufferAttribute(iUv, 2)); iGeo.setAttribute('tile', aTile);
  iGeo.setIndex(new THREE.BufferAttribute(iIdx, 1)); iGeo.setDrawRange(0, 0);
  const itemMesh = new THREE.Mesh(iGeo, matOpaque); itemMesh.frustumCulled = false; itemMesh.name = 'items'; group.add(itemMesh);
  let itemCount = 0;
  const tileOfItem = (id) => tileMap[id === ITEM_STICK ? TILE_OF[4 * 6 + 0] : TILE_OF[id * 6 + 0]];

  return {
    group, missingTiles: missing,
    /** Sincroniza con world.entities. Llamar cada frame tras world.updateEntities(dt). alpha (0..1) opcional: no interpola (paso fijo 1/120 ya es suave). */
    update() {
      const st = world.entities, live = new Set();
      for (const t of st.trees) {
        live.add(t.id);
        if (!trees.has(t.id)) addTree(t);
        axis.set(t.axis[0], 0, t.axis[2]);
        trees.get(t.id).group.quaternion.setFromAxisAngle(axis, t.theta);
      }
      for (const id of [...trees.keys()]) if (!live.has(id)) dropTree(id);
      let n = 0;
      for (const it of st.items) {
        if (n >= CAP) break;
        const ang = (it.rest >= 30 ? 0 : it.age * 2.0) + it.uid * 0.9, c = Math.cos(ang), sn = Math.sin(ang), tl = tileOfItem(it.id);
        const cx = it.x, cy = it.y + ITEM_SIZE_M / 2, cz = it.z, o = n * VPI * 3;
        for (let v = 0; v < VPI; v++) {
          const px = tpl.pos[v * 3] * isc, py = tpl.pos[v * 3 + 1] * isc, pz = tpl.pos[v * 3 + 2] * isc;
          iPos[o + v * 3] = cx + px * c + pz * sn; iPos[o + v * 3 + 1] = cy + py; iPos[o + v * 3 + 2] = cz - px * sn + pz * c;
          iTile[n * VPI + v] = tl;
        }
        n++;
      }
      itemCount = n; iGeo.setDrawRange(0, n * IPI); aPos.needsUpdate = true; aTile.needsUpdate = true;
      drawCalls = trees.size * 2 + (n ? 1 : 0);
    },
    stats() { return { trees: trees.size, items: itemCount, triangles: triangles + itemCount * 12, drawCalls }; },
    dispose() {
      for (const id of [...trees.keys()]) dropTree(id);
      group.remove(itemMesh); iGeo.dispose(); scene.remove(group); matOpaque.dispose?.(); matCutout.dispose?.();
    },
  };
}
