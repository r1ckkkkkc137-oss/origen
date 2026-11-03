// Adaptador OPCIONAL a Three.js. No importa three: recibe el namespace THREE por parámetro.
//   const geo = createGeometry(THREE, mesh.opaque);  mesh3d.position.set(...mesh.origin)
// Los shaders de abajo son una BASE para el atlas de Arte (repetir tile con fract(uv)); Arte es dueño del look final.
// NOTA: sin probar en GPU (el box no tiene). El test usa un THREE falso solo para verificar los atributos.
import { ATLAS_COLS, ATLAS_ROWS } from './tilemap.js';

/** BufferGeometry desde una capa del mesher (mesh.opaque / mesh.cutout / mesh.water). Atributos: position, normal, uv, tile, index. */
export function createGeometry(THREE, layer) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(layer.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(layer.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(layer.uvs, 2));
  g.setAttribute('tile', new THREE.BufferAttribute(layer.tiles, 1));
  g.setIndex(new THREE.BufferAttribute(layer.indices, 1));
  return g;
}

export const VERTEX_SHADER = /* glsl */`
attribute float tile;
varying vec2 vUv;
varying float vTile;
varying vec3 vNormal;
void main() {
  vUv = uv; vTile = tile; vNormal = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const FRAGMENT_SHADER = /* glsl */`
uniform sampler2D uAtlas;
uniform vec2 uGrid;       // (columnas, filas) del atlas
uniform float uAlphaTest; // 0.5 para hojas; 0 para opaco/agua
varying vec2 vUv;
varying float vTile;
varying vec3 vNormal;
void main() {
  float t = floor(vTile + 0.5);
  float row = floor(t / uGrid.x);
  float col = t - row * uGrid.x;
  vec2 f = fract(vUv);
  vec2 inset = vec2(0.5 / (16.0 * uGrid.x), 0.5 / (16.0 * uGrid.y)); // medio texel: evita sangrado entre tiles
  vec2 tuv = vec2((col + f.x) / uGrid.x, 1.0 - (row + 1.0 - f.y) / uGrid.y);
  tuv = clamp(tuv, vec2(col / uGrid.x, 1.0 - (row + 1.0) / uGrid.y) + inset, vec2((col + 1.0) / uGrid.x, 1.0 - row / uGrid.y) - inset);
  vec4 c = texture2D(uAtlas, tuv);
  if (c.a < uAlphaTest) discard;
  float shade = vNormal.y > 0.5 ? 1.0 : vNormal.y < -0.5 ? 0.55 : abs(vNormal.x) > 0.5 ? 0.8 : 0.7;
  gl_FragColor = vec4(c.rgb * shade, c.a);
}`;

/** Material base. layerName: 'opaque' | 'cutout' | 'water'. */
export function createVoxelMaterial(THREE, atlasTexture, layerName = 'opaque') {
  return new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: atlasTexture }, uGrid: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) }, uAlphaTest: { value: layerName === 'cutout' ? 0.5 : 0 } },
    vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
    transparent: layerName === 'water', depthWrite: layerName !== 'water', side: 0, // FrontSide
  });
}
