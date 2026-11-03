// Greedy meshing por chunk. Entrada: chunk + vecinos (px,nx,pz,nz). Salida: 3 capas { opaque, cutout, water }.
//
// FORMATO por capa. POSICIONES locales al chunk. Por defecto en METROS (bloque * BLOCK_SIZE_M: x,z en [0,16*S], y en [0,SY*S]) y `origin` =
// (cx*16*S, 0, cz*16*S) también en metros. Con meshChunk(chunk, nb, { units: 'blocks' }) salen en BLOQUES (S=1; entonces el adaptador 3D
// escala el mesh con BLOCK_SIZE_M). `mesh.units` dice cuál se usó. El meshing se hace en la grilla entera de bloques; solo se escala al emitir vértices.
// UVs en unidades de BLOQUE (no de metro): un tile por bloque pase lo que pase BLOCK_SIZE_M.
//   positions Float32Array (xyz), normals Float32Array (xyz), uvs Float32Array (st), tiles Uint8Array (1 por vértice), indices Uint16/32Array.
//   uvs están en UNIDADES DE BLOQUE (un quad fusionado de w x h bloques va de 0..w, 0..h): el shader hace fract(uv) para REPETIR el tile.
//   tiles = índice de tile en el atlas (ver tilemap.js). t crece hacia +Y en las caras laterales (la v del tile va hacia arriba).
// Caras ocultas: se descartan entre sólidos opacos, también contra chunks vecinos. Un vecino ausente (null) se trata como opaco
// (no emite cara de borde); World.meshChunk siempre pasa los 4 vecinos.
import { IS_OPAQUE, LAYER_OF } from './blocks.js';
import { CHUNK_Y } from './chunk.js';
import { TILE_OF } from './tilemap.js';
import { BLOCK_SIZE_M as S } from './units.js';

const PX = 18, PZ = 18; // pad: 16 + 1 a cada lado en X y Z
const SY = PX * PZ, SZ = PX, SX = 1;
const pad = new Uint8Array(PX * PZ * (CHUNK_Y + 2));
const mask = new Int32Array(CHUNK_Y * 16 + 16);
const AIR_VAL = 0, ABSENT = 255;
let K = S; // escala vértices: S (metros, por defecto) o 1 (opts.units='blocks')

/** Rellena `pad` (con borde de 1) a partir del chunk y sus vecinos. y=-1 -> 255 (oculto), y=SY -> aire. */
function fillPad(chunk, nb) {
  pad.fill(AIR_VAL);
  const b = chunk.blocks;
  // y = -1: suelo oculto
  pad.fill(ABSENT, 0, SY);
  for (let y = 0; y < CHUNK_Y; y++) {
    const poy = (y + 1) * SY;
    for (let z = 0; z < 16; z++) {
      const src = (y << 8) + (z << 4);
      pad.set(b.subarray(src, src + 16), poy + (z + 1) * SZ + 1);
    }
    // vecinos X (columnas x=-1 y x=16)
    const nxB = nb && nb.nx ? nb.nx.blocks : null, pxB = nb && nb.px ? nb.px.blocks : null;
    for (let z = 0; z < 16; z++) {
      const row = poy + (z + 1) * SZ;
      pad[row] = nxB ? nxB[15 + (z << 4) + (y << 8)] : ABSENT;
      pad[row + 17] = pxB ? pxB[0 + (z << 4) + (y << 8)] : ABSENT;
    }
    const nzB = nb && nb.nz ? nb.nz.blocks : null, pzB = nb && nb.pz ? nb.pz.blocks : null;
    for (let x = 0; x < 16; x++) {
      pad[poy + 0 * SZ + x + 1] = nzB ? nzB[x + (15 << 4) + (y << 8)] : ABSENT;
      pad[poy + 17 * SZ + x + 1] = pzB ? pzB[x + (0 << 4) + (y << 8)] : ABSENT;
    }
  }
}

/** ¿Se ve la cara del bloque `a` hacia el vecino `b`? */
export function faceVisible(a, b) {
  if (a === 0 || a === ABSENT) return false;
  if (IS_OPAQUE[b]) return false;
  if (b === 0) return true;
  return a !== b; // dos bloques transparentes iguales (agua-agua, hojas-hojas) no dibujan la cara entre ellos
}

class LayerBuf {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.tile = []; this.idx = []; this.n = 0; }
  quad(p0, p1, p2, p3, nx, ny, nz, uvs, tile, front) {
    const n = this.n;
    this.pos.push(p0[0] * K, p0[1] * K, p0[2] * K, p1[0] * K, p1[1] * K, p1[2] * K, p2[0] * K, p2[1] * K, p2[2] * K, p3[0] * K, p3[1] * K, p3[2] * K);
    for (let i = 0; i < 4; i++) this.nor.push(nx, ny, nz);
    this.uv.push(uvs[0], uvs[1], uvs[2], uvs[3], uvs[4], uvs[5], uvs[6], uvs[7]);
    this.tile.push(tile, tile, tile, tile);
    if (front) this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    else this.idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    this.n += 4;
  }
  finish() {
    const vc = this.n;
    const IdxArr = vc > 65535 ? Uint32Array : Uint16Array;
    return {
      positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), uvs: new Float32Array(this.uv),
      tiles: new Uint8Array(this.tile), indices: IdxArr.from(this.idx), vertexCount: vc, triangleCount: this.idx.length / 3,
    };
  }
}

const DIMS = [16, 0, 16]; // Y se ajusta por chunk
const P0 = [0, 0, 0], P1 = [0, 0, 0], P2 = [0, 0, 0], P3 = [0, 0, 0];

/**
 * @param {Chunk} chunk
 * @param {{px?:Chunk,nx?:Chunk,pz?:Chunk,nz?:Chunk}|null} neighbors
 * @returns {{cx,cz,origin:number[],opaque,cutout,water,triangles:number}}
 */
export function meshChunk(chunk, neighbors = null, opts = {}) {
  K = opts.units === 'blocks' ? 1 : S; // escala de salida de los vértices (único punto donde se aplica BLOCK_SIZE_M)
  fillPad(chunk, neighbors);
  const top = chunk.topY();
  const layers = [null, new LayerBuf(), new LayerBuf(), new LayerBuf()];
  if (top >= 0) {
    DIMS[1] = top + 1;
    for (let d = 0; d < 3; d++) {
      const u = (d + 1) % 3, v = (d + 2) % 3;
      const du = DIMS[u], dv = DIMS[v], dd = DIMS[d];
      const sD = d === 0 ? SX : d === 1 ? SY : SZ, sU = u === 0 ? SX : u === 1 ? SY : SZ, sV = v === 0 ? SX : v === 1 ? SY : SZ;
      const base = 1 + SZ + SY; // índice de pad del voxel (0,0,0)
      for (let i = 0; i <= dd; i++) {
        // máscara del plano entre voxel i-1 (a) y voxel i (b)
        let any = false;
        for (let vv = 0; vv < dv; vv++) for (let uu = 0; uu < du; uu++) {
          const ib = base + i * sD + uu * sU + vv * sV;
          const A = pad[ib - sD], Bk = pad[ib];
          let m = 0;
          if (i > 0 && faceVisible(A, Bk)) {
            // cara +d del voxel a (frontal)
            const face = d * 2;
            m = 1 + (TILE_OF[A * 6 + face] * 4 + LAYER_OF[A]);
          } else if (i < dd && faceVisible(Bk, A)) {
            const face = d * 2 + 1;
            m = -(1 + (TILE_OF[Bk * 6 + face] * 4 + LAYER_OF[Bk]));
          }
          mask[uu + vv * du] = m;
          if (m !== 0) any = true;
        }
        if (!any) continue;
        for (let vv = 0; vv < dv; vv++) {
          for (let uu = 0; uu < du;) {
            const m = mask[uu + vv * du];
            if (m === 0) { uu++; continue; }
            let w = 1;
            while (uu + w < du && mask[uu + w + vv * du] === m) w++;
            let h = 1;
            outer: for (; vv + h < dv; h++) {
              for (let k = 0; k < w; k++) if (mask[uu + k + (vv + h) * du] !== m) break outer;
            }
            for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[uu + k + (vv + hh) * du] = 0;
            emitQuad(layers, d, u, v, i, uu, vv, w, h, m);
            uu += w;
          }
        }
      }
    }
  }
  const opaque = layers[1].finish(), cutout = layers[2].finish(), water = layers[3].finish();
  return {
    cx: chunk.cx, cz: chunk.cz, origin: [chunk.cx * 16 * K, 0, chunk.cz * 16 * K], units: opts.units === 'blocks' ? 'blocks' : 'meters',
    opaque, cutout, water, triangles: opaque.triangleCount + cutout.triangleCount + water.triangleCount,
  };
}

const UV = [0, 0, 0, 0, 0, 0, 0, 0];
function emitQuad(layers, d, u, v, i, u0, v0, w, h, m) {
  const front = m > 0;
  const code = (front ? m : -m) - 1;
  const layer = code & 3, tile = code >> 2;
  const sign = front ? 1 : -1;
  P0[d] = P1[d] = P2[d] = P3[d] = i;
  P0[u] = u0; P0[v] = v0;
  P1[u] = u0 + w; P1[v] = v0;
  P2[u] = u0 + w; P2[v] = v0 + h;
  P3[u] = u0; P3[v] = v0 + h;
  // UVs en unidades de bloque. d=0 (X): u=Y,v=Z ; d=1 (Y): u=Z,v=X ; d=2 (Z): u=X,v=Y.
  if (d === 0) {
    const s0 = front ? h : 0, s1 = front ? 0 : h; // +x: s=-z ; -x: s=+z (sin espejo visto desde fuera)
    UV[0] = s0; UV[1] = 0; UV[2] = s0; UV[3] = w; UV[4] = s1; UV[5] = w; UV[6] = s1; UV[7] = 0;
  } else if (d === 1) {
    UV[0] = 0; UV[1] = 0; UV[2] = 0; UV[3] = w; UV[4] = h; UV[5] = w; UV[6] = h; UV[7] = 0;
  } else if (front) { // +z: s=+x
    UV[0] = 0; UV[1] = 0; UV[2] = w; UV[3] = 0; UV[4] = w; UV[5] = h; UV[6] = 0; UV[7] = h;
  } else {            // -z: s=-x
    UV[0] = w; UV[1] = 0; UV[2] = 0; UV[3] = 0; UV[4] = 0; UV[5] = h; UV[6] = w; UV[7] = h;
  }
  const nx = d === 0 ? sign : 0, ny = d === 1 ? sign : 0, nz = d === 2 ? sign : 0;
  layers[layer].quad(P0, P1, P2, P3, nx, ny, nz, UV, tile, front);
}

/** Cuenta caras visibles (malla ingenua con culling, 2 triángulos por cara, sin fusionar) y bloques sólidos. Para el bench. */
export function countNaive(chunk, neighbors = null) {
  fillPad(chunk, neighbors);
  let faces = 0, solids = 0;
  const top = chunk.topY();
  for (let y = 0; y <= top; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const i = (x + 1) * SX + (z + 1) * SZ + (y + 1) * SY;
    const a = pad[i];
    if (a === 0) continue;
    solids++;
    if (faceVisible(a, pad[i + SX])) faces++;
    if (faceVisible(a, pad[i - SX])) faces++;
    if (faceVisible(a, pad[i + SY])) faces++;
    if (faceVisible(a, pad[i - SY])) faces++;
    if (faceVisible(a, pad[i + SZ])) faces++;
    if (faceVisible(a, pad[i - SZ])) faces++;
  }
  return { visibleFaces: faces, naiveTriangles: faces * 2, noCullTriangles: solids * 12, blocks: solids };
}
