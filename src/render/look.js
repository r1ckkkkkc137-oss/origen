// Luz, niebla y ciclo día/noche. Distancias en metros (contrato v0.2). Un sol + hemisférica; sin sombras en tiempo real, para celular.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function applyLook(scene, renderer, { fogNear = 18, fogFar = 60 } = {}) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, fogNear, fogFar);
  const hemi = new THREE.HemisphereLight(PALETTE.ambient, PALETTE.ground, 0.9);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.2); sun.position.set(30, 50, 20);
  scene.add(hemi, sun);
  const sky = makeSky(); scene.add(sky);
  const cSky = new THREE.Color(PALETTE.sky), cNight = new THREE.Color(PALETTE.skyNight);
  const fDay = new THREE.Color(PALETTE.fog), fNight = new THREE.Color(PALETTE.fogNight);
  const cTop = new THREE.Color(PALETTE.skyTop), cTopN = new THREE.Color(PALETTE.skyTopNight);
  /** t en [0,1): 0 = mediodía, 0.5 = medianoche. */
  function setTime(t) {
    const a = t * Math.PI * 2, day = Math.max(0, Math.cos(a));
    sun.position.set(Math.sin(a) * 50, Math.cos(a) * 50, 20); sun.intensity = 2.2 * day;
    hemi.intensity = 0.25 + 0.65 * day;
    scene.background.copy(cNight).lerp(cSky, day); scene.fog.color.copy(fNight).lerp(fDay, day);
    const u = sky.material.uniforms; u.uTop.value.copy(cTopN).lerp(cTop, day); u.uHorizon.value.copy(scene.fog.color);
  }
  return { sun, hemi, sky, setTime };
}

/** Niebla que tapa el borde del mundo cargado. radiusChunks en chunks; chunk de 16 bloques de BLOCK_M m. */
export function fogForRadius(radiusChunks, blockM = 0.5, chunk = 16) {
  const edge = radiusChunks * chunk * blockM; // metros hasta el borde
  return { fogNear: edge * 0.35, fogFar: edge * 0.92 };
}

// Cúpula de cielo: degradado horizonte (= color de niebla, sin costura) -> cenit. Sigue a la cámara; 1 draw call, sin texturas.
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color(PALETTE.skyTop) }, uHorizon: { value: new THREE.Color(PALETTE.fog) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: 'uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir; void main(){ float h = clamp(normalize(vDir).y, 0.0, 1.0); gl_FragColor = vec4(mix(uHorizon, uTop, pow(h, 0.6)), 1.0);\n#include <colorspace_fragment>\n}',
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), mat);
  m.frustumCulled = false; m.renderOrder = -1000;
  m.onBeforeRender = (r, s, cam) => { m.position.copy(cam.position); m.scale.setScalar(cam.far * 0.5); m.updateMatrixWorld(); };
  return m;
}
