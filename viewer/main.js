// Viewer de desarrollo: cápsulas + líneas sobre cubos de vóxel. Modo live (animación continua) y modo captura (window.CAP).
import * as THREE from 'three';
import { SCENARIOS, simulate, snapshot, simulateDuel } from '../src/anim/scenarios.js';
import { buildColliders } from '../src/anim/contact.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x232834);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3f4a, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 8, 5); scene.add(sun);
const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 100);

const charGroup = new THREE.Group(), terrainGroup = new THREE.Group(), markGroup = new THREE.Group();
scene.add(terrainGroup, charGroup, markGroup);
const COL = { L: 0xe8554e, R: 0x4e8de8, C: 0xc9ced8, N: 0xffe14d };
const SEG = [  // [a, b, color, radius]
  ['pelvis', 'spine', 'C', 0.075], ['spine', 'chest', 'C', 0.08], ['chest', 'neck', 'C', 0.085], ['neck', 'head', 'C', 0.04],
  ['head', 'tips.headTop', 'C', 0.095], ['tips.headTop', 'tips.face', 'N', 0.03],
  ['neck', 'shoulderL', 'L', 0.04], ['shoulderL', 'elbowL', 'L', 0.045], ['elbowL', 'handL', 'L', 0.038], ['handL', 'tips.handL', 'L', 0.05],
  ['neck', 'shoulderR', 'R', 0.04], ['shoulderR', 'elbowR', 'R', 0.045], ['elbowR', 'handR', 'R', 0.038], ['handR', 'tips.handR', 'R', 0.05],
  ['pelvis', 'hipL', 'L', 0.06], ['hipL', 'kneeL', 'L', 0.065], ['kneeL', 'footL', 'L', 0.05], ['footL', 'tips.toeL', 'L', 0.04],
  ['pelvis', 'hipR', 'R', 0.06], ['hipR', 'kneeR', 'R', 0.065], ['kneeR', 'footR', 'R', 0.05], ['footR', 'tips.toeR', 'R', 0.04],
];
const capGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1), sphGeo = new THREE.SphereGeometry(1, 12, 8);
const makeChar = (group, col) => SEG.map(([a, b, c, r]) => {
  const m = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: col[c], roughness: 0.6 }));
  const s0 = new THREE.Mesh(sphGeo, m.material), s1 = new THREE.Mesh(sphGeo, m.material);
  group.add(m, s0, s1); return { m, s0, s1, a, b, r };
});
const meshes = makeChar(charGroup, COL);
// ronda 6: rival (duelo) en tonos apagados + marcas de contacto y colisor de cabeza
const rivalGroup = new THREE.Group(); scene.add(rivalGroup); rivalGroup.visible = false;
const rivalMeshes = makeChar(rivalGroup, { L: 0x9a6a68, R: 0x6a7f9a, C: 0x8b8f98, N: 0xcfc27a });
const headCol = new THREE.Mesh(sphGeo, new THREE.MeshBasicMaterial({ color: 0x66ffcc, wireframe: true, transparent: true, opacity: 0.35 })); rivalGroup.add(headCol);
const contactMark = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0x33ff66 })); scene.add(contactMark); contactMark.visible = false;
function drawRival(snap) {
  for (const o of rivalMeshes) {
    const pa = P(snap, o.a), pb = P(snap, o.b);
    _a.set(...pa); _b.set(...pb); _d.subVectors(_b, _a); const L = Math.max(_d.length(), 1e-4);
    o.m.position.copy(_a).addScaledVector(_d, 0.5); o.m.scale.set(o.r, L, o.r); o.m.quaternion.setFromUnitVectors(UP, _d.normalize());
    o.s0.position.copy(_a); o.s1.position.copy(_b); o.s0.scale.setScalar(o.r); o.s1.scale.setScalar(o.r);
  }
  const c = buildColliders(snap)[0]; headCol.position.set(c.a[2], c.a[1], -c.a[0]); headCol.scale.setScalar(c.r);
}
const joints = SEG.length;
const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
charGroup.add(lines);
const plantMarks = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.01, 16), new THREE.MeshBasicMaterial({ color: 0x44ff66 })); markGroup.add(m); return m; });
const fistMark = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe14d })); markGroup.add(fistMark);
const rootMark = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 12), new THREE.MeshBasicMaterial({ color: 0xffffff })); markGroup.add(rootMark);
const headingArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.5, 0xffffff, 0.1, 0.06); markGroup.add(headingArrow);

const P = (snap, k) => (k.startsWith('tips.') ? snap.tips[k.slice(5)] : snap.pose[k]);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function drawSnap(snap) {
  for (const o of meshes) {
    const pa = P(snap, o.a), pb = P(snap, o.b);
    _a.set(...pa); _b.set(...pb); _d.subVectors(_b, _a); const L = Math.max(_d.length(), 1e-4);
    o.m.position.copy(_a).addScaledVector(_d, 0.5); o.m.scale.set(o.r, L, o.r); o.m.quaternion.setFromUnitVectors(UP, _d.normalize());
    o.s0.position.copy(_a); o.s1.position.copy(_b); o.s0.scale.setScalar(o.r); o.s1.scale.setScalar(o.r);
  }
  // líneas de esqueleto (huesos del contrato por jerarquía)
  const pts = [];
  for (const [a, b] of [['pelvis', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['chest', 'shoulderL'], ['shoulderL', 'elbowL'], ['elbowL', 'handL'], ['chest', 'shoulderR'], ['shoulderR', 'elbowR'], ['elbowR', 'handR'], ['pelvis', 'hipL'], ['hipL', 'kneeL'], ['kneeL', 'footL'], ['pelvis', 'hipR'], ['hipR', 'kneeR'], ['kneeR', 'footR']]) pts.push(...snap.pose[a], ...snap.pose[b]);
  lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); lines.geometry.computeBoundingSphere();
  snap.feet.forEach((f, i) => { plantMarks[i].position.set(f.pos[0], f.pos[1] + 0.006, f.pos[2]); plantMarks[i].material.color.set(f.planted ? 0x44ff66 : 0xff9a3c); plantMarks[i].rotation.y = f.yaw; });
  fistMark.visible = snap.strike.phase !== 'none'; fistMark.position.set(...snap.strike.fist);
  rootMark.position.set(snap.root.pos[0], snap.root.pos[1] + 0.008, snap.root.pos[2]);
  headingArrow.position.set(snap.root.pos[0], snap.root.pos[1] + 0.02, snap.root.pos[2]); headingArrow.setDirection(new THREE.Vector3(Math.cos(snap.root.yaw), 0, -Math.sin(snap.root.yaw)));
}

function buildTerrain(sc, x0 = -2, x1 = 8) {
  terrainGroup.clear();
  const bm = sc.blockM, gb = sc.terrain;
  const boxG = new THREE.BoxGeometry(bm, bm, bm), eG = new THREE.EdgesGeometry(boxG);
  const mats = [new THREE.MeshStandardMaterial({ color: 0x5f7d4f }), new THREE.MeshStandardMaterial({ color: 0x6f8f5c })];
  const lm = new THREE.LineBasicMaterial({ color: 0x2c3a26 });
  const bx0 = Math.floor(x0 / bm), bx1 = Math.ceil(x1 / bm), bz0 = Math.floor(-2.2 / bm), bz1 = Math.ceil(2.2 / bm);
  for (let bx = bx0; bx < bx1; bx++) for (let bz = bz0; bz < bz1; bz++) {
    let top = -99; for (let y = 6; y >= -3; y--) if (gb(bx, y, bz)) { top = y; break; }
    if (top === -99) continue;
    const m = new THREE.Mesh(boxG, mats[(bx + bz) & 1]); m.position.set((bx + 0.5) * bm, (top + 0.5) * bm, (bz + 0.5) * bm);
    const l = new THREE.LineSegments(eG, lm); l.position.copy(m.position); terrainGroup.add(m, l);
    if (top > 0) { for (let y = top - 1; y >= 0; y--) { const m2 = new THREE.Mesh(boxG, mats[(bx + bz + 1) & 1]); m2.position.set(m.position.x, (y + 0.5) * bm, m.position.z); terrainGroup.add(m2); } }
  }
}

const CAMS = {
  front: (t) => ({ pos: [t[0] + 3.5, t[1] + 1.0, t[2]], look: [t[0], t[1] + 0.9, t[2]], fov: 28 }),
  side: (t) => ({ pos: [t[0], t[1] + 1.0, t[2] - 3.5], look: [t[0], t[1] + 0.9, t[2]], fov: 28 }),     // cámara en -Z (lado IZQUIERDO del personaje, el del pie/mano rojos de guardia): el personaje (+X adelante) mira a la IZQUIERDA de la pantalla
  top34: (t) => ({ pos: [t[0] + 1.9, t[1] + 2.2, t[2] + 2.4], look: [t[0], t[1] + 0.75, t[2]], fov: 28 }),
};
function setCam(name, target) { const c = CAMS[name](target); cam.fov = c.fov; cam.position.set(...c.pos); cam.lookAt(...c.look); cam.aspect = canvas.width / canvas.height; cam.updateProjectionMatrix(); }
function size(w, h) { renderer.setSize(w, h, false); canvas.width = w; canvas.height = h; }

// ---- API de captura
window.CAP = {
  run(scName, times, camNames, w = 480, h = 420, followRoot = true) {
    const sc = SCENARIOS[scName]; size(w, h);
    const want = times.map((t) => Math.round(t * 60)); const snaps = {};
    simulate(scName, { duration: Math.max(...times) + 0.02, onFrame: (t, sk, A, i) => { if (want.includes(i)) snaps[i] = snapshot(sk, A); } });
    buildTerrain(sc, -2, 8);
    const out = {};
    for (const cn of camNames) {
      out[cn] = [];
      for (const i of want) {
        const s = snaps[i]; drawSnap(s);
        const tgt = followRoot ? [s.pose.pelvis[0], Math.max(s.root.pos[1], Math.min(s.feet[0].pos[1], s.feet[1].pos[1])), 0] : [0, 0, 0];
        setCam(cn, tgt); renderer.render(scene, cam);
        out[cn].push(canvas.toDataURL('image/png'));
      }
    }
    return out;
  },
};

// ronda 6: duelo atacante (colores) vs rival (apagado) a la distancia de conexión; cámaras de duelo (ninguna tapa a un luchador con el otro)
const DCAMS = {
  side: (t) => ({ pos: [t[0], t[1] + 1.05, t[2] - 3.6], look: [t[0], t[1] + 1.0, t[2]], fov: 30 }),
  top34: (t) => ({ pos: [t[0] - 1.4, t[1] + 2.4, t[2] + 2.6], look: [t[0], t[1] + 0.95, t[2]], fov: 30 }),
  front34: (t) => ({ pos: [t[0] + 2.4, t[1] + 1.45, t[2] - 2.4], look: [t[0], t[1] + 1.0, t[2]], fov: 30 }),
};
window.CAP.runDuel = (name, times, camNames, w = 480, h = 420, opts = {}) => {
  size(w, h); const want = times.map((t) => Math.round(t * 60)); const snaps = {};
  simulateDuel(name, { ...opts, tail: Math.max(...times) + 0.05, onFrame: (t, sa, sb, a, b, i) => { if (want.includes(i)) snaps[i] = { a: snapshot(sa, a), b: snapshot(sb, b), pin: a.contact.pin ? a.contact.pin.p.slice() : null }; } });
  buildTerrain(SCENARIOS.guard, -2, 4); rivalGroup.visible = true;
  const out = {};
  for (const cn of camNames) {
    out[cn] = [];
    for (const i of want) {
      const s = snaps[i]; drawSnap(s.a); drawRival(s.b);
      contactMark.visible = !!s.pin; if (s.pin) contactMark.position.set(s.pin[2], s.pin[1], -s.pin[0]);
      const tgt = [(s.a.pose.pelvis[0] + s.b.pose.pelvis[0]) / 2, 0, 0], c = DCAMS[cn](tgt);
      cam.fov = c.fov; cam.position.set(...c.pos); cam.lookAt(...c.look); cam.aspect = canvas.width / canvas.height; cam.updateProjectionMatrix();
      renderer.render(scene, cam); out[cn].push(canvas.toDataURL('image/png'));
    }
  }
  rivalGroup.visible = false; contactMark.visible = false;
  return out;
};

// ---- modo live
const hud = document.getElementById('hud');
if (!location.search.includes('capture')) {
  let scName = new URLSearchParams(location.search).get('s') || 'walk', camName = 'side', frames = [], idx = 0, acc = 0, last = performance.now(), fpsN = 0, fpsT = 0, fps = 0;
  const load = () => { const sc = SCENARIOS[scName]; frames = []; simulate(scName, { duration: sc.duration, onFrame: (t, sk, A) => frames.push(snapshot(sk, A)) }); buildTerrain(sc); idx = 0; };
  addEventListener('keydown', (e) => { const k = e.key; if ('123456789'.includes(k)) { scName = Object.keys(SCENARIOS)[+k - 1]; load(); } if (k === 'c') camName = camName === 'side' ? 'front' : camName === 'front' ? 'top34' : 'side'; });
  const resize = () => size(innerWidth, innerHeight); addEventListener('resize', resize); resize(); load();
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt; while (acc >= 1 / 60) { acc -= 1 / 60; idx = (idx + 1) % frames.length; }
    const s = frames[idx]; drawSnap(s); setCam(camName, [s.pose.pelvis[0], Math.min(s.feet[0].pos[1], s.feet[1].pos[1]), 0]); renderer.render(scene, cam);
    fpsN++; fpsT += dt; if (fpsT > 0.5) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
    hud.textContent = `escenario ${scName} (teclas 1-9) cámara ${camName} (c)  t=${(idx / 60).toFixed(2)}s  fps=${fps.toFixed(0)}`; window.__fps = fps;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
