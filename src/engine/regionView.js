import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildTileMap, createGeometry, createVoxelMaterial } from '../world/threeAdapter.js';
// Vista del mundo por REGIONES de R×R chunks: una malla por región y capa (menos draw calls que una por chunk).
// Usa la API pública de World (ensureChunks, chunks, peekChunk, consumeDirty, meshChunk). Three hace el frustum culling
// por región con la boundingSphere de la geometría fusionada. Radio de carga ajustable en vivo (setRadius).
const LAYERS = ['opaque', 'cutout', 'water'];
const key = (x, z) => x + ',' + z;

export function createRegionView(THREE, scene, world, atlas, opts = {}) {
  const R = opts.region ?? 2, TILE_PX = 16;
  const { map: tileMap, missing } = buildTileMap(opts.tileNames);
  const grid = { cols: Math.round(atlas.canvas.width / TILE_PX), rows: Math.round(atlas.canvas.height / TILE_PX) };
  const materials = LAYERS.map((n) => createVoxelMaterial(THREE, atlas.texture, n, grid));
  const group = new THREE.Group(); group.name = 'world'; scene.add(group);
  let radius = opts.radius ?? 4.5;
  const maxNew = opts.maxNewChunks ?? 6, maxMesh = opts.maxMeshPerFrame ?? 4;
  const chunkGeo = new Map();   // key chunk -> { rk, geos:[g|null x3], tris }
  const regions = new Map();    // key región -> { meshes:[], dirty }
  let todo = [], triangles = 0;
  const rkOf = (cx, cz) => key(Math.floor(cx / R), Math.floor(cz / R));

  function dropChunk(k) {
    const e = chunkGeo.get(k); if (!e) return;
    e.geos.forEach((g) => g?.dispose()); triangles -= e.tris; chunkGeo.delete(k); markRegion(e.rk);
  }
  function markRegion(rk) { let r = regions.get(rk); if (!r) regions.set(rk, (r = { meshes: [], dirty: true })); r.dirty = true; }
  function buildChunk(cx, cz) {
    const k = key(cx, cz), m = world.meshChunk(cx, cz, { units: 'meters' });
    dropChunk(k);
    const geos = LAYERS.map((n) => {
      const layer = m[n]; if (!layer.triangleCount) return null;
      const g = createGeometry(THREE, layer, { tileMap }); g.translate(m.origin[0], m.origin[1], m.origin[2]); return g;
    });
    const rk = rkOf(cx, cz); chunkGeo.set(k, { rk, geos, tris: m.triangles }); triangles += m.triangles; markRegion(rk);
  }
  function rebuildRegion(rk, r) {
    for (const mesh of r.meshes) { group.remove(mesh); mesh.geometry.dispose(); }
    r.meshes = []; r.dirty = false;
    const parts = LAYERS.map(() => []);
    for (const e of chunkGeo.values()) if (e.rk === rk) e.geos.forEach((g, i) => g && parts[i].push(g));
    parts.forEach((list, i) => {
      if (!list.length) return;
      const g = list.length === 1 ? list[0].clone() : mergeGeometries(list, false);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, materials[i]); mesh.matrixAutoUpdate = false; if (i === 2) mesh.renderOrder = 1;
      group.add(mesh); r.meshes.push(mesh);
    });
    if (!r.meshes.length) regions.delete(rk);
  }

  return {
    group, missingTiles: missing,
    get radius() { return radius; },
    setRadius(r) { radius = r; },
    update(pxM, pzM) {
      const res = world.ensureChunks(pxM, pzM, radius, { maxNew, unloadMargin: 1 });
      for (const c of res.removed) dropChunk(key(c.cx, c.cz));
      const pcx = Math.floor(pxM / 8), pcz = Math.floor(pzM / 8); // 16 bloques × 0.5 m
      const inR = (cx, cz) => (cx - pcx) ** 2 + (cz - pcz) ** 2 <= radius * radius;
      const queued = new Set(todo.map((t) => key(t.cx, t.cz)));
      const push = (cx, cz) => { const k = key(cx, cz); if (!queued.has(k)) { queued.add(k); todo.push({ cx, cz }); } };
      for (const c of world.consumeDirty()) if (chunkGeo.has(key(c.cx, c.cz))) push(c.cx, c.cz);
      for (const [k, e] of chunkGeo) { const [cx, cz] = k.split(',').map(Number); if (!inR(cx, cz)) dropChunk(k); } // radio bajó
      for (const c of world.chunks()) if (!chunkGeo.has(key(c.cx, c.cz)) && inR(c.cx, c.cz)) push(c.cx, c.cz);
      todo = todo.filter((c) => world.peekChunk(c.cx, c.cz) && inR(c.cx, c.cz));
      todo.sort((a, b) => ((a.cx - pcx) ** 2 + (a.cz - pcz) ** 2) - ((b.cx - pcx) ** 2 + (b.cz - pcz) ** 2));
      let meshed = 0;
      while (todo.length && meshed < maxMesh) { const c = todo.shift(); buildChunk(c.cx, c.cz); meshed++; }
      // fusionar regiones sucias cuando su vecindario terminó de mallar (evita re-fusionar 4 veces)
      for (const [rk, r] of regions) if (r.dirty && (!todo.length || meshed === 0 || !todo.some((t) => rkOf(t.cx, t.cz) === rk))) rebuildRegion(rk, r);
      return { meshed, pending: todo.length };
    },
    stats() { let meshes = 0; for (const r of regions.values()) meshes += r.meshes.length; return { chunks: chunkGeo.size, regions: regions.size, meshes, triangles, pendingMesh: todo.length, radius }; },
  };
}
