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
  const cSky = new THREE.Color(PALETTE.sky), cNight = new THREE.Color(PALETTE.skyNight);
  const fDay = new THREE.Color(PALETTE.fog), fNight = new THREE.Color(PALETTE.fogNight);
  /** t en [0,1): 0 = mediodía, 0.5 = medianoche. */
  function setTime(t) {
    const a = t * Math.PI * 2, day = Math.max(0, Math.cos(a));
    sun.position.set(Math.sin(a) * 50, Math.cos(a) * 50, 20); sun.intensity = 2.2 * day;
    hemi.intensity = 0.25 + 0.65 * day;
    scene.background.copy(cNight).lerp(cSky, day); scene.fog.color.copy(fNight).lerp(fDay, day);
  }
  return { sun, hemi, setTime };
}
