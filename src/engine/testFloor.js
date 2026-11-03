import * as THREE from 'three';
import { BLOCK_M } from '../shared/contracts.js';
// Piso plano de prueba (hasta que entre el mundo de Mundo): N×N bloques, tope en y=0 m. Solo caras visibles.
export function createTestFloor(atlas, n = 32, depth = 2) {
  const pos = [], uv = [], nor = [], idx = [];
  const s = BLOCK_M, h = n / 2;
  const quad = (p, nrm, tile) => {
    const [u0, v0, u1, v1] = atlas.uv(tile), b = pos.length / 3;
    pos.push(...p[0], ...p[1], ...p[2], ...p[3]);
    for (let i = 0; i < 4; i++) nor.push(...nrm);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  for (let i = -h; i < h; i++) for (let k = -h; k < h; k++) {
    const x0 = i * s, x1 = x0 + s, z0 = k * s, z1 = z0 + s;
    quad([[x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]], [0, 1, 0], 'grass_top');
  }
  for (let d = 0; d < depth; d++) {
    const y1 = -d * s, y0 = y1 - s, tile = d === 0 ? 'grass_side' : 'dirt';
    for (let i = -h; i < h; i++) {
      const a = i * s, b = a + s, e = h * s;
      quad([[a, y0, e], [b, y0, e], [b, y1, e], [a, y1, e]], [0, 0, 1], tile);
      quad([[b, y0, -e], [a, y0, -e], [a, y1, -e], [b, y1, -e]], [0, 0, -1], tile);
      quad([[e, y0, b], [e, y0, a], [e, y1, a], [e, y1, b]], [1, 0, 0], tile);
      quad([[-e, y0, a], [-e, y0, b], [-e, y1, b], [-e, y1, a]], [-1, 0, 0], tile);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: atlas.texture }));
  return { mesh, getBlock: (x, y, z) => y < 0 && y >= -depth && x >= -h && x < h && z >= -h && z < h };
}
