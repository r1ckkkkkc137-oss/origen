import * as THREE from 'three';
import { createLoop } from './engine/loop.js';
import { createFpsMeter } from './engine/fps.js';
import { createInput } from './engine/input.js';
import { createCameraRig } from './engine/camera.js';
import { createTestFloor } from './engine/testFloor.js';
import { createHumanView } from './engine/humanView.js';
import { createAtlas } from './render/atlas.js';
import { applyLook, fogForRadius } from './render/look.js';
import { TILES } from './render/atlas.js';
import { createWorld } from './world/index.js';
import { createWorldView } from './world/threeAdapter.js';
import { createAnimator3D } from './anim/index.js';
import { BLOCK_M } from './shared/contracts.js';
import { createLiveFight, createLiveAnimation, findFightSpot } from './combat/index.js';

const params = new URLSearchParams(location.search);
export const SEED = Number(params.get('seed') ?? 1);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 200);
const RADIUS = Number(params.get('r') ?? 4.5);              // radio de carga en chunks
const look = applyLook(scene, renderer, fogForRadius(RADIUS)); // niebla tapa el borde del mundo
look.setTime(0.08);
const atlas = createAtlas(SEED);

// Mundo real (src/world) por defecto; ?floor=flat usa el piso plano de prueba (depuración de animación).
let getBlock, world = null, view = null, groundY = 0;
const spawn = [0, 0];
if (params.get('floor') === 'flat') {
  const floor = createTestFloor(atlas, 32); scene.add(floor.mesh); getBlock = floor.getBlock;
} else {
  world = createWorld(Number(params.get('wseed') ?? SEED));
  view = createWorldView(THREE, scene, world, atlas, { tileNames: TILES, radius: RADIUS });
  world.ensureChunks(0, 0, 2);                                // carga síncrona cerca del origen para ubicar el spawn
  // spawn determinista: primera columna (espiral cuadrada) con 4 bloques planos en X, sin agua encima
  const flatAt = (x, z) => { const y = world.surfaceY(x, z); if (y < 0 || world.getBlock(x, y + 1, z) !== 0) return -1;
    for (let dx = -2; dx <= 2; dx++) if (world.surfaceY(x + dx, z) !== y || world.getBlock(x + dx, y + 1, z) !== 0) return -1; return y; };
  search: for (let r = 0; r < 24; r++) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
    const y = flatAt(x, z); if (y >= 0) { spawn[0] = (x + 0.5) * BLOCK_M; spawn[1] = (z + 0.5) * BLOCK_M; groundY = (y + 1) * BLOCK_M; break search; }
  }
  getBlock = (x, y, z) => world.solidAt(x, y, z);               // agua no es sólida para los pies
}

// Pelea en vivo: la sim de Combate (KAGE a 60 Hz fijos) es dueña de root.pos/yaw; Animador solo viste el esqueleto.
const spot = world ? findFightSpot(world, Math.floor(spawn[0] / BLOCK_M), Math.floor(spawn[1] / BLOCK_M), 6) : { origin: [0, 0, 0] };
let fightSeed = SEED;
const live = createLiveFight({ seed: fightSeed, origin: spot.origin, ground: getBlock });
const la = createLiveAnimation(live, { createAnimator3D, getBlock, blockM: BLOCK_M, seed: SEED });
groundY = spot.origin[1] * BLOCK_M;
const fighters = [[0xd8d2c4, 'a'], [0x9a3b34, 'b']].map(([color, side]) => {
  const view = createHumanView(color); scene.add(view.group);
  return { root: live.frame.fighters[side], color, anim: la.anims[side], view };
});
const p0 = live.frame.fighters.a.pos;

const input = createInput(renderer.domElement);
const rig = createCameraRig(camera, input, { mode: 'third', pos: [p0[0], groundY + 2.2, p0[2] + 5], speed: 5 });
const fps = createFpsMeter(document.getElementById('fps'));
const mid = new THREE.Vector3();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const loop = createLoop({
  update(dt, tick) {
    const { frame } = la.update(dt);
    fighters.forEach((f, i) => { f.root = frame.list[i]; });
    if (live.done) live.restart(++fightSeed);                 // pelea siguiente, determinista
    mid.set((fighters[0].root.pos[0] + fighters[1].root.pos[0]) / 2, (fighters[0].root.pos[1] + fighters[1].root.pos[1]) / 2 + 1.0, (fighters[0].root.pos[2] + fighters[1].root.pos[2]) / 2);
    rig.setTarget(mid);
    rig.update(dt);
    if (view) view.update(camera.position.x, camera.position.z);
  },
  render() { for (const f of fighters) f.view.update(f.anim.skeleton); renderer.render(scene, camera); fps.frame(); },
});
loop.start();
window.__ORIGEN__ = { scene, camera, rig, loop, fps, fighters, live, SEED, world, view, look, renderer, ready: true };
