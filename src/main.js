import * as THREE from 'three';
import { createLoop } from './engine/loop.js';
import { createFpsMeter } from './engine/fps.js';
import { createInput } from './engine/input.js';
import { createCameraRig } from './engine/camera.js';
import { createTestFloor } from './engine/testFloor.js';
import { createHumanView } from './engine/humanView.js';
import { createAtlas } from './render/atlas.js';
import { applyLook } from './render/look.js';
import { createAnimator3D } from './anim/index.js';
import { BLOCK_M } from './shared/contracts.js';

const params = new URLSearchParams(location.search);
export const SEED = Number(params.get('seed') ?? 1);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 200);
const look = applyLook(scene, renderer, { fogNear: 10, fogFar: 40 });
look.setTime(0.08);

const atlas = createAtlas(SEED);
const floor = createTestFloor(atlas, 32); // TODO: reemplazar por el mundo de Mundo
scene.add(floor.mesh);

// Dos humanos de prueba: la "sim" (aquí un guion determinista por tick) es dueña de root.pos/yaw.
const fighters = [
  { root: { pos: [-0.7, 0, 0], yaw: 0 }, base: -0.7, color: 0xd8d2c4 },
  { root: { pos: [0.7, 0, 0], yaw: Math.PI }, base: 0.7, color: 0x9a3b34 },
].map((f, i) => {
  const anim = createAnimator3D({ seed: SEED * 31 + i, getBlock: floor.getBlock, blockM: BLOCK_M });
  const view = createHumanView(f.color); scene.add(view.group);
  return { ...f, anim, view };
});

const input = createInput(renderer.domElement);
const rig = createCameraRig(camera, input, { mode: 'third', pos: [0, 2.2, 5], speed: 5 });
const fps = createFpsMeter(document.getElementById('fps'));
const mid = new THREE.Vector3();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

function simStep(tick) {
  fighters.forEach((f, i) => {
    const t = tick / 60, dir = i === 0 ? 1 : -1;
    f.root.pos[0] = f.base + dir * 0.18 * Math.sin(t * 1.3 + i * 1.7); // entran y salen de distancia
    f.root.pos[2] = 0.25 * Math.sin(t * 0.7 + i);                      // y circulan
    if ((tick + i * 45) % 90 === 0) f.anim.play('jab');
  });
  const [a, b] = fighters; // se miran
  a.root.yaw = Math.atan2(-(b.root.pos[2] - a.root.pos[2]), b.root.pos[0] - a.root.pos[0]);
  b.root.yaw = Math.atan2(-(a.root.pos[2] - b.root.pos[2]), a.root.pos[0] - b.root.pos[0]);
}

const loop = createLoop({
  update(dt, tick) {
    simStep(tick);
    for (const f of fighters) f.anim.update(dt, f.root);
    mid.set((fighters[0].root.pos[0] + fighters[1].root.pos[0]) / 2, 1.0, (fighters[0].root.pos[2] + fighters[1].root.pos[2]) / 2);
    rig.setTarget(mid);
    rig.update(dt);
  },
  render() { for (const f of fighters) f.view.update(f.anim.skeleton); renderer.render(scene, camera); fps.frame(); },
});
loop.start();
window.__ORIGEN__ = { scene, camera, rig, loop, fps, fighters, SEED, ready: true };
