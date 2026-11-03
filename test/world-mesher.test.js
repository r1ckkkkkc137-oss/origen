import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { Chunk, CHUNK_Y } from '../src/world/chunk.js';
import { B, IS_SOLID, LAYER_OF } from '../src/world/blocks.js';
import { meshChunk, faceVisible, countNaive } from '../src/world/mesher.js';
import { TILE_OF } from '../src/world/tilemap.js';
import { BLOCK_SIZE_M as S } from '../src/world/units.js';
import { filledChunk } from './helpers/support.js';

const LAYERS = ['opaque', 'cutout', 'water'];
const NORMAL = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]; // índice de cara del tilemap
const faceOfNormal = (n) => NORMAL.findIndex((m) => m[0] === n[0] && m[1] === n[1] && m[2] === n[2]);

/** Desarma una capa en celdas-cara: Map "x,y,z,face" -> { tile, quad }, validando cada quad. */
function decode(layer) {
  const cells = new Map();
  const { positions: P, normals: N, uvs: UV, tiles: T, indices: I } = layer;
  assert.equal(layer.vertexCount % 4, 0);
  assert.equal(I.length, layer.triangleCount * 3);
  for (let q = 0; q < layer.vertexCount / 4; q++) {
    const v = [0, 1, 2, 3].map((k) => q * 4 + k);
    const n = [N[v[0] * 3], N[v[0] * 3 + 1], N[v[0] * 3 + 2]];
    const face = faceOfNormal(n);
    assert.ok(face >= 0, 'normal no axial');
    const pts = v.map((i) => [P[i * 3] / S, P[i * 3 + 1] / S, P[i * 3 + 2] / S]);
    for (const p of pts) for (const c of p) assert.ok(Math.abs(c - Math.round(c)) < 1e-4, 'vértice fuera de la grilla de bloques');
    for (const i of v) { assert.deepEqual([N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], n); assert.equal(T[i], T[v[0]]); }
    const mn = [0, 1, 2].map((a) => Math.round(Math.min(...pts.map((p) => p[a])))), mx = [0, 1, 2].map((a) => Math.round(Math.max(...pts.map((p) => p[a]))));
    const d = Math.abs(n[0]) ? 0 : Math.abs(n[1]) ? 1 : 2;
    assert.equal(mn[d], mx[d], 'quad no plano');
    // winding: los 2 triángulos del quad apuntan a la normal
    for (let t = 0; t < 2; t++) {
      const a = I[(q * 2 + t) * 3] - q * 4, b = I[(q * 2 + t) * 3 + 1] - q * 4, c = I[(q * 2 + t) * 3 + 2] - q * 4;
      assert.ok(a >= 0 && a < 4 && b >= 0 && b < 4 && c >= 0 && c < 4, 'índices del quad');
      const u = pts[b].map((x, k) => x - pts[a][k]), w = pts[c].map((x, k) => x - pts[a][k]);
      const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      assert.ok(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0, 'winding contrario a la normal');
    }
    // uv en unidades de bloque, sin espejo: s crece hacia la "derecha" de la cara vista desde afuera, t hacia +Y (laterales)
    if (d !== 1) {
      const right = [n[1] * 0 - 0 * n[2], 0, 0]; // cross(up, n) con up=(0,1,0): (n.z, 0, -n.x)
      right[0] = n[2]; right[1] = 0; right[2] = -n[0];
      for (let k = 1; k < 4; k++) {
        const dp = pts[k].map((x, a) => x - pts[0][a]);
        assert.ok(Math.abs((UV[v[k] * 2] - UV[v[0] * 2]) - (dp[0] * right[0] + dp[2] * right[2])) < 1e-4, 'uv.s espejado/estirado');
        assert.ok(Math.abs((UV[v[k] * 2 + 1] - UV[v[0] * 2 + 1]) - dp[1]) < 1e-4, 'uv.t');
      }
    } else {
      const ext = [0, 1].map((k) => Math.max(...v.map((i) => UV[i * 2 + k])) - Math.min(...v.map((i) => UV[i * 2 + k])));
      const dims = [mx[0] - mn[0], mx[2] - mn[2]].sort(), e = [...ext].sort();
      assert.ok(Math.abs(e[0] - dims[0]) < 1e-4 && Math.abs(e[1] - dims[1]) < 1e-4, 'uv de tapas no coincide con el tamaño del quad');
    }
    // celdas cubiertas: el voxel dueño está "detrás" de la cara
    const [u1, v1] = [(d + 1) % 3, (d + 2) % 3];
    for (let a = mn[u1]; a < mx[u1]; a++) for (let b = mn[v1]; b < mx[v1]; b++) {
      const pos = [0, 0, 0]; pos[d] = n[d] > 0 ? mn[d] - 1 : mn[d]; pos[u1] = a; pos[v1] = b;
      const key = `${pos[0]},${pos[1]},${pos[2]},${face}`;
      assert.ok(!cells.has(key), `cara duplicada ${key}`);
      cells.set(key, T[v[0]]);
    }
  }
  return cells;
}

/** Caras esperadas por fuerza bruta (independiente del greedy), con la regla: dentro del chunk, entre dos transparentes distintos solo la del dueño frontal. */
function expected(world, cx, cz) {
  const out = [new Map(), new Map(), new Map()];
  const get = (x, y, z) => (y < 0 ? 255 : world.getBlock(x, y, z));
  for (let y = 0; y < CHUNK_Y; y++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const x = cx * 16 + lx, z = cz * 16 + lz, a = get(x, y, z);
    if (a === 0) continue;
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = NORMAL[f];
      const nx = x + dx, ny = y + dy, nz = z + dz, b = get(nx, ny, nz);
      if (!faceVisible(a, b)) continue;
      const inside = (nx >> 4) === cx && (nz >> 4) === cz && ny >= 0 && ny < CHUNK_Y;
      if (inside && f % 2 === 1 && faceVisible(b, a)) continue; // empate: solo la cara frontal (+eje) del bloque de índice menor
      const layer = LAYER_OF[a] - 1;
      out[layer].set(`${x - cx * 16},${y},${z - cz * 16},${f}`, TILE_OF[a * 6 + f]);
    }
  }
  return out;
}

test('mesher: caras emitidas == caras visibles por fuerza bruta (por capa, sin duplicados), tile, winding y uv correctos', () => {
  let totalQuads = 0, cases = 0;
  for (const [seed, coords] of [[1234, [[0, 0], [3, -2], [-5, 4]]], [7, [[1, 1], [-2, -2]]], [42, [[10, 0], [0, -9]]], [99, [[2, 5]]]]) {
    const w = new World(seed);
    for (const [cx, cz] of coords) {
      const m = w.meshChunk(cx, cz);
      const exp = expected(w, cx, cz);
      assert.deepEqual(m.origin, [cx * 16 * S, 0, cz * 16 * S]);
      LAYERS.forEach((name, li) => {
        const got = decode(m[name]);
        assert.equal(got.size, exp[li].size, `${seed} ${cx},${cz} capa ${name}: caras ${got.size} vs esperadas ${exp[li].size}`);
        for (const [k, tile] of exp[li]) assert.equal(got.get(k), tile, `${seed} ${cx},${cz} ${name} cara ${k}`);
        totalQuads += m[name].vertexCount / 4;
      });
      assert.equal(m.triangles, m.opaque.triangleCount + m.cutout.triangleCount + m.water.triangleCount);
      cases++;
    }
  }
  assert.ok(cases === 8 && totalQuads > 200);
});

test('mesher: greedy emite menos triángulos que la malla ingenua con culling (y nunca más)', () => {
  const w = new World(1234);
  let greedy = 0, naive = 0, nocull = 0;
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) {
    const c = w.getChunk(cx, cz), nb = { px: w.getChunk(cx + 1, cz), nx: w.getChunk(cx - 1, cz), pz: w.getChunk(cx, cz + 1), nz: w.getChunk(cx, cz - 1) };
    const g = meshChunk(c, nb).triangles, n = countNaive(c, nb);
    assert.ok(g <= n.naiveTriangles, `chunk ${cx},${cz}: ${g} > ${n.naiveTriangles}`);
    greedy += g; naive += n.naiveTriangles; nocull += n.noCullTriangles;
  }
  assert.ok(greedy < naive * 0.6, `greedy ${greedy} vs ingenua ${naive}`);
  assert.ok(naive < nocull * 0.2);
});

test('mesher: chunk sólido sin vecinos (null) solo emite la tapa; con vecinos de aire emite tapa + 4 laterales; el fondo nunca', () => {
  const c = filledChunk(0, 0, B.STONE, 9);
  const m0 = meshChunk(c, null);
  assert.equal(m0.opaque.triangleCount, 2); assert.equal(m0.cutout.triangleCount + m0.water.triangleCount, 0);
  const air = (cx, cz) => new Chunk(cx, cz);
  const m1 = meshChunk(c, { px: air(1, 0), nx: air(-1, 0), pz: air(0, 1), nz: air(0, -1) });
  assert.equal(m1.opaque.triangleCount, 10); // 1 tapa + 4 laterales (cada uno 1 quad greedy de 16x10)
  assert.equal(countNaive(c, { px: air(1, 0), nx: air(-1, 0), pz: air(0, 1), nz: air(0, -1) }).visibleFaces, 256 + 4 * 160);
  // vecino sólido: no hay cara de borde
  const m2 = meshChunk(c, { px: filledChunk(1, 0, B.STONE, 9), nx: air(-1, 0), pz: air(0, 1), nz: air(0, -1) });
  assert.equal(m2.opaque.triangleCount, 8);
});

test('mesher: tiles distintos / capas no se fusionan; transparentes iguales no dibujan la cara entre sí; agua contra piedra solo muestra la piedra', () => {
  const c = new Chunk(0, 0);
  const set = (x, y, z, id) => c.set(x, y, z, id);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) { set(x, 0, z, B.STONE); set(x, 1, z, x < 8 ? B.GRASS : B.SAND); }
  const m = meshChunk(c, null);
  assert.equal(m.opaque.triangleCount, 4);                        // dos tapas (pasto y arena) en vez de una
  assert.deepEqual([...new Set(m.opaque.tiles)].sort(), [0, 8]);  // grass_top, sand
  // 2 de agua contiguos sobre piedra
  const d = new Chunk(0, 0);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) d.set(x, 0, z, B.STONE);
  d.set(5, 1, 5, B.WATER); d.set(6, 1, 5, B.WATER);
  const md = meshChunk(d, null);
  assert.equal(md.water.triangleCount, 10);                       // 2x1 fusionado: tapa + 4 laterales (2x1 en +z/-z, 1x1 en +x/-x); sin cara interna ni fondo (piedra)
  assert.equal(md.opaque.triangleCount, 2);                       // el tope de piedra bajo el agua SÍ se ve (agua no es opaca): 1 quad 16x16
  const mdn = meshChunk(d, { px: new Chunk(1, 0), nx: new Chunk(-1, 0), pz: new Chunk(0, 1), nz: new Chunk(0, -1) });
  assert.equal(mdn.water.triangleCount, 10);                      // los vecinos no cambian el agua interior
});

test('mesher: hojas van a la capa cutout, tronco con tile de corte arriba/abajo y de corteza a los lados', () => {
  const c = new Chunk(0, 0);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) c.set(x, 0, z, B.GRASS);
  c.set(3, 1, 3, B.LOG); c.set(3, 2, 3, B.LOG); c.set(3, 3, 3, B.LEAVES);
  const m = meshChunk(c, null);
  const logTiles = new Set(m.opaque.tiles);
  assert.ok(logTiles.has(TILE_OF[B.LOG * 6 + 0]) && logTiles.has(TILE_OF[B.LOG * 6 + 2]));
  assert.notEqual(TILE_OF[B.LOG * 6 + 0], TILE_OF[B.LOG * 6 + 2]);
  assert.equal(m.cutout.vertexCount / 4, 5); // hoja sobre tronco: 5 caras (la de abajo la oculta... el tronco es opaco)
  assert.equal(m.water.triangleCount, 0);
});

test('mesher: Uint16 hasta 65535 vértices, Uint32 si se supera (tablero de ajedrez)', () => {
  const c = new Chunk(0, 0);
  for (let y = 0; y < CHUNK_Y; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if ((x + y + z) % 2 === 0) c.blocks[x + (z << 4) + (y << 8)] = B.STONE;
  const m = meshChunk(c, { px: new Chunk(1, 0), nx: new Chunk(-1, 0), pz: new Chunk(0, 1), nz: new Chunk(0, -1) });
  assert.ok(m.opaque.vertexCount > 65535);
  assert.ok(m.opaque.indices instanceof Uint32Array);
  assert.ok(Math.max(...m.opaque.indices.subarray(0, 5000)) < m.opaque.vertexCount);
  const small = meshChunk(filledChunk(0, 0, B.STONE, 3), null);
  assert.ok(small.opaque.indices instanceof Uint16Array);
});
