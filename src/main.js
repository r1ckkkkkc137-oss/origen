import * as THREE from 'three';
import { createLoop } from './engine/loop.js';
import { createFpsMeter } from './engine/fps.js';
import { createInput } from './engine/input.js';
import { createCameraRig } from './engine/camera.js';

const params = new URLSearchParams(location.search);
export const SEED = Number(params.get('seed') ?? 1);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.Fog(0x0b0d12, 60, 180);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 400);
scene.add(new THREE.HemisphereLight(0x8899aa, 0x221a14, 0.9));
const sun = new THREE.DirectionalLight(0xffeedd, 1.2); sun.position.set(30, 60, 20); scene.add(sun);
// Placeholder hasta que Mundo entregue chunks: piso 8x8 chunks (128x128) con grilla.
scene.add(new THREE.GridHelper(128, 8, 0x445566, 0x223038));

const input = createInput(renderer.domElement);
const rig = createCameraRig(camera, input);
const fps = createFpsMeter(document.getElementById('fps'));

addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const loop = createLoop({
  update(dt) { rig.update(dt); },
  render() { renderer.render(scene, camera); fps.frame(); },
});
loop.start();
window.__ORIGEN__ = { scene, camera, rig, loop, fps, SEED, ready: true };
