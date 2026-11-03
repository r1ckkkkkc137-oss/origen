import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld } from '../src/world/index.js';
import { createRegionView } from '../src/engine/regionView.js';
import { createAdaptiveRadius } from '../src/engine/adaptive.js';
import { TILES } from '../src/render/atlas.js';

test('regionView: solo chunks enteros dentro del radio, una malla por región y capa', () => {
  const w = createWorld(1), scene = new THREE.Scene();
  const v = createRegionView(THREE, scene, w, { canvas: { width: 64, height: 64 }, texture: null }, { tileNames: TILES, radius: 4.5 });
  for (let i = 0; i < 60; i++) v.update(0, 0);
  const s = v.stats();
  assert.equal(s.pendingMesh, 0);
  assert.ok(s.chunks <= 69, `chunks ${s.chunks}`);
  assert.ok(s.meshes <= s.regions * 3);
  assert.ok(s.meshes < s.chunks, 'fusiona chunks ' + JSON.stringify(s));
  v.setRadius(2.5); for (let i = 0; i < 5; i++) v.update(0, 0);
  assert.ok(v.stats().chunks <= 21);
});

test('adaptive: baja con frames lentos y sube con rápidos', () => {
  let t = 0, last = null; const a = createAdaptiveRadius({ max: 4.5, min: 2.5, now: () => t, onChange: (r) => { last = r; } });
  for (let i = 0; i < 200; i++) { t += 50; a.frame(); }
  assert.ok(a.radius < 4.5 && last === a.radius);
  for (let i = 0; i < 2000; i++) { t += 10; a.frame(); }
  assert.equal(a.radius, 4.5);
});
