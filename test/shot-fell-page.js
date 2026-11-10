// Módulo de PÁGINA para capturas (lo inyecta test/shot-fell-caves.mjs en el dev server de vite; comparte la instancia de three con main.js).
import * as THREE from 'three';
import { createEntityView } from '../src/world/entityView.js';
import { createAtlas, TILES } from '../src/render/atlas.js';
const O = window.__ORIGEN__;
const atlas = createAtlas(O.SEED);
const ev = createEntityView(THREE, O.scene, O.world, atlas, { tileNames: TILES });
window.__FELL__ = {
  ev,
  /** posiciona la cámara (metros), carga/mallea el mundo alrededor y renderiza un frame */
  async frame({ eye, at, fov }) {
    O.loop.stop();
    for (const f of O.fighters) f.view.group.visible = false;
    if (fov) { O.camera.fov = fov; O.camera.updateProjectionMatrix(); }
    O.camera.position.set(eye[0], eye[1], eye[2]); O.camera.lookAt(at[0], at[1], at[2]); O.camera.updateMatrixWorld();
    for (let i = 0; i < 600; i++) { O.view.update(eye[0], eye[2]); const s = O.view.stats(); if (s.chunks > 20 && s.pendingMesh === 0 && i > 5) break; await new Promise((r) => setTimeout(r, 5)); }
    ev.update();
    O.renderer.render(O.scene, O.camera);
    return { view: O.view.stats(), ev: ev.stats(), calls: O.renderer.info.render.calls, tris: O.renderer.info.render.triangles };
  },
  world: O.world, seed: O.SEED, worldSeed: O.world.seed,
};
window.__FELL_READY__ = true;
