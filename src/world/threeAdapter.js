// Adaptador OPCIONAL a Three.js. No importa three: recibe el namespace THREE por parámetro.
//   const geo = createGeometry(THREE, mesh.opaque);  mesh3d.position.set(...mesh.origin)
// Los shaders de abajo son una BASE para el atlas de Arte (repetir tile con fract(uv); el muestreo usa textureGrad con dFdx(vUv) para que los mipmaps por tile no dejen costuras); Arte es dueño del look final.
// Soportan la niebla de THREE (scene.fog) y la salida sRGB/tone mapping del renderer (look.js de Arte).
// NOTA: sin GPU real en el box. Se validó solo con Chrome headless + SwiftShader (smoke:world); el test unitario usa un THREE falso.
import { ATLAS_COLS, ATLAS_ROWS, TILE_NAMES } from './tilemap.js';
import { BLOCK_SIZE_M } from './units.js';

/** Tabla tile-del-mundo -> tile-del-atlas. Los nombres que el atlas aún no tiene caen a un sustituto (FALLBACK) hasta que Arte los agregue. */
export const TILE_FALLBACK = Object.freeze({ sand: 'dirt', snow: 'stone', gravel: 'stone', coal_ore: 'stone', iron_ore: 'stone', water: 'dirt' });
export function buildTileMap(atlasNames) {
  const map = new Uint8Array(TILE_NAMES.length), missing = [];
  TILE_NAMES.forEach((n, i) => {
    let j = atlasNames.indexOf(n);
    if (j < 0) { missing.push(n); j = atlasNames.indexOf(TILE_FALLBACK[n] ?? 'stone'); if (j < 0) j = 0; }
    map[i] = j;
  });
  return { map, missing };
}

/** BufferGeometry desde una capa del mesher (mesh.opaque / mesh.cutout / mesh.water). Atributos: position, normal, uv, tile, index.
 *  opts.tileMap (Uint8Array de buildTileMap) remapea el atributo tile a los índices del atlas real. */
export function createGeometry(THREE, layer, opts = {}) {
  const g = new THREE.BufferGeometry();
  let tiles = layer.tiles;
  if (opts.tileMap) { tiles = new Uint8Array(layer.tiles.length); for (let i = 0; i < tiles.length; i++) tiles[i] = opts.tileMap[layer.tiles[i]]; }
  g.setAttribute('position', new THREE.BufferAttribute(layer.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(layer.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(layer.uvs, 2));
  g.setAttribute('tile', new THREE.BufferAttribute(tiles, 1));
  g.setIndex(new THREE.BufferAttribute(layer.indices, 1));
  return g;
}

export const VERTEX_SHADER = /* glsl */`
attribute float tile;
varying vec2 vUv;
varying float vTile;
varying vec3 vNormal;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vTile = tile; vNormal = normal;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

export const FRAGMENT_SHADER = /* glsl */`
uniform sampler2D uAtlas;
uniform vec2 uGrid;       // (columnas, filas) del atlas
uniform float uAlphaTest; // 0.5 para hojas; 0 para opaco/agua
uniform float uOpacity;   // agua < 1
varying vec2 vUv;
varying float vTile;
varying vec3 vNormal;
#include <fog_pars_fragment>
void main() {
  float t = floor(vTile + 0.5);
  float row = floor(t / uGrid.x);
  float col = t - row * uGrid.x;
  vec2 f = fract(vUv);
  vec2 inset = vec2(0.5 / (16.0 * uGrid.x), 0.5 / (16.0 * uGrid.y)); // medio texel: evita sangrado entre tiles
  vec2 tuv = vec2((col + f.x) / uGrid.x, 1.0 - (row + 1.0 - f.y) / uGrid.y);
  tuv = clamp(tuv, vec2(col / uGrid.x, 1.0 - (row + 1.0) / uGrid.y) + inset, vec2((col + 1.0) / uGrid.x, 1.0 - row / uGrid.y) - inset);
  // gradientes explícitos en unidades de atlas: fract(vUv) tiene saltos en los bordes de tile y el mip automático dejaba costuras.
  // dFdx(vUv) (sin fract) es continuo; /uGrid lo pasa de «tiles» a uv del atlas. Requiere WebGL2 (GLSL ES 3.00; three lo traduce solo).
  vec4 c = textureGrad(uAtlas, tuv, dFdx(vUv) / uGrid, dFdy(vUv) / uGrid);
  if (c.a < uAlphaTest) discard;
  float shade = vNormal.y > 0.5 ? 1.0 : vNormal.y < -0.5 ? 0.55 : abs(vNormal.x) > 0.5 ? 0.8 : 0.7;
  gl_FragColor = vec4(c.rgb * shade, c.a * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Material base. layerName: 'opaque' | 'cutout' | 'water'. grid = {cols, rows} del atlas REAL (por defecto el del tilemap). */
export function createVoxelMaterial(THREE, atlasTexture, layerName = 'opaque', grid = { cols: ATLAS_COLS, rows: ATLAS_ROWS }) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uAtlas: { value: atlasTexture }, uGrid: { value: new THREE.Vector2(grid.cols, grid.rows) },
    uAlphaTest: { value: layerName === 'cutout' ? 0.5 : 0 }, uOpacity: { value: layerName === 'water' ? 0.7 : 1 },
  }]);
  uniforms.uAtlas.value = atlasTexture; // merge clona; la textura se conserva por referencia
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER, fog: true,
    transparent: layerName === 'water', depthWrite: layerName !== 'water', side: 0, // FrontSide
  });
}

const LAYER_NAMES = ['opaque', 'cutout', 'water'];
const keyOf = (cx, cz) => cx + ',' + cz;

/**
 * Conecta un World con una escena Three y el atlas de Arte (src/render/atlas.js).
 *   const atlas = createAtlas(seed);                       // { texture, canvas }
 *   const view = createWorldView(THREE, scene, world, atlas, { tileNames: TILES, radius: 4.5 });
 *   // cada frame: view.update(camera.position.x, camera.position.z)   (metros)
 * - Carga/descarga chunks por radio (en chunks), malla los sucios con presupuesto por frame (maxMeshPerFrame) de cerca a lejos.
 * - Los tiles que el atlas aún no tiene usan sustitutos (view.missingTiles lista cuáles).
 * - view.stats() -> { chunks, meshes, triangles, pendingMesh }.
 */
export function createWorldView(THREE, scene, world, atlas, opts = {}) {
  const tileNames = opts.tileNames ?? TILE_NAMES;
  const { map: tileMap, missing } = buildTileMap(tileNames);
  const TILE_PX = opts.tilePx ?? 16;
  const grid = atlas.canvas ? { cols: Math.round(atlas.canvas.width / TILE_PX), rows: Math.round(atlas.canvas.height / TILE_PX) } : { cols: ATLAS_COLS, rows: Math.ceil(tileNames.length / ATLAS_COLS) };
  const radius = opts.radius ?? 4.5, maxNew = opts.maxNewChunks ?? 8, maxMesh = opts.maxMeshPerFrame ?? 4;
  const materials = LAYER_NAMES.map((n) => createVoxelMaterial(THREE, atlas.texture, n, grid));
  const group = new THREE.Group(); group.name = 'world'; scene.add(group);
  const live = new Map();           // key -> { cx, cz, meshes: [] }
  let todo = [];                    // [{cx,cz}] por mallar
  let triangles = 0;

  function drop(key) {
    const e = live.get(key); if (!e) return;
    for (const m of e.meshes) { group.remove(m); m.geometry.dispose(); }
    triangles -= e.tris; live.delete(key);
  }
  function build(cx, cz) {
    const key = keyOf(cx, cz), mesh = world.meshChunk(cx, cz, { units: 'meters' });
    drop(key);
    const meshes = [];
    LAYER_NAMES.forEach((n, i) => {
      const layer = mesh[n]; if (layer.triangleCount === 0) return;
      const m = new THREE.Mesh(createGeometry(THREE, layer, { tileMap }), materials[i]);
      m.position.set(mesh.origin[0], mesh.origin[1], mesh.origin[2]);
      if (i === 2) m.renderOrder = 1;
      m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m); meshes.push(m);
    });
    live.set(key, { cx, cz, meshes, tris: mesh.triangles }); triangles += mesh.triangles;
  }

  return {
    group, missingTiles: missing, grid,
    /** px,pz en METROS (posición de la cámara/jugador). Devuelve { added, removed, meshed } de este frame. */
    update(pxM, pzM) {
      const r = world.ensureChunks(pxM, pzM, radius, { maxNew, unloadMargin: 2 });
      for (const c of r.removed) drop(keyOf(c.cx, c.cz));
      const pcx = Math.floor(pxM / (16 * BLOCK_SIZE_M)), pcz = Math.floor(pzM / (16 * BLOCK_SIZE_M));
      const queued = new Set(todo.map((t) => keyOf(t.cx, t.cz)));
      const push = (cx, cz) => { const k = keyOf(cx, cz); if (!queued.has(k)) { queued.add(k); todo.push({ cx, cz }); } };
      for (const c of world.consumeDirty()) if (live.has(keyOf(c.cx, c.cz))) push(c.cx, c.cz);      // ediciones: re-mallar los ya visibles
      for (const c of world.chunks()) {                                                           // nuevos dentro del radio (los vecinos cargados solo para mallar no se dibujan)
        if (live.has(keyOf(c.cx, c.cz))) continue;
        if ((c.cx - pcx) ** 2 + (c.cz - pcz) ** 2 <= radius * radius) push(c.cx, c.cz);
      }
      todo = todo.filter((c) => world.peekChunk(c.cx, c.cz));
      todo.sort((a, b) => ((a.cx - pcx) ** 2 + (a.cz - pcz) ** 2) - ((b.cx - pcx) ** 2 + (b.cz - pcz) ** 2));
      let meshed = 0;
      while (todo.length && meshed < maxMesh) { const c = todo.shift(); build(c.cx, c.cz); meshed++; }
      return { added: r.added.length, removed: r.removed.length, meshed };
    },
    stats() { let meshes = 0; for (const e of live.values()) meshes += e.meshes.length; return { chunks: live.size, meshes, triangles, pendingMesh: todo.length }; },
    dispose() { for (const k of [...live.keys()]) drop(k); scene.remove(group); materials.forEach((m) => m.dispose?.()); },
  };
}
