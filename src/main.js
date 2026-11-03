import * as THREE from 'three';
import { createLoop } from './engine/loop.js';
import { createFpsMeter } from './engine/fps.js';
import { createInput } from './engine/input.js';
import { createCameraRig } from './engine/camera.js';
import { applyLook } from './render/look.js';
import { createAtlas, TILES } from './render/atlas.js';
import { createWorld } from './world/index.js';
import { createWorldView } from './world/threeAdapter.js';

const params = new URLSearchParams(location.search);
export const SEED = Number(params.get('seed') ?? 1);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 400);
const look = applyLook(scene, renderer, { fogNear: 40, fogFar: 90 }); // luz + niebla + sRGB/tonemap de Arte (src/render/look.js)
// Mundo (Mundo, src/world): chunks por radio alrededor de la cámara, malla greedy, atlas de Arte. ?r=<chunks> (4.5 ≈ 8x8 chunks), ?wseed=<n>
const world = createWorld(Number(params.get('wseed') ?? SEED));
const atlas = createAtlas(SEED);
const view = createWorldView(THREE, scene, world, atlas, { tileNames: TILES, radius: Number(params.get('r') ?? 4.5) });

const input = createInput(renderer.domElement);
const rig = createCameraRig(camera, input);
const fps = createFpsMeter(document.getElementById('fps'));

addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const loop = createLoop({
  update(dt) { rig.update(dt); view.update(camera.position.x, camera.position.z); },
  render() { renderer.render(scene, camera); fps.frame(); },
});
loop.start();
window.__ORIGEN__ = { scene, camera, rig, loop, fps, SEED, world, view, look, renderer, ready: true };
