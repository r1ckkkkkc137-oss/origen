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
import { createWorld, createPlayerBody, stepPlayer, playerEye, createEntityView, BLOCKS } from './world/index.js';
import { createInteraction } from './engine/interact.js';
import { createTouchUI } from './engine/touchUI.js';
import { createRegionView } from './engine/regionView.js';
import { createAdaptiveRadius } from './engine/adaptive.js';
import { createAnimator3D, pairedAnimatorFactory, bindCombatEvents, MOVE_CLIP } from './anim/index.js';
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
  view = createRegionView(THREE, scene, world, atlas, { tileNames: TILES, radius: RADIUS, region: 2 });
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
let fightSeed = Number(params.get('fseed') ?? SEED);                // ?fseed= elige la pelea sin cambiar el mundo
const live = createLiveFight({ seed: fightSeed, origin: spot.origin, ground: getBlock });
const la = createLiveAnimation(live, { createAnimator3D: pairedAnimatorFactory(createAnimator3D), getBlock, blockM: BLOCK_M, seed: SEED, clipMap: MOVE_CLIP });
bindCombatEvents(live, la.anims);                          // bloqueos (guard) -> animador
groundY = spot.origin[1] * BLOCK_M;
const fighters = [[0xd8d2c4, 'a'], [0x9a3b34, 'b']].map(([color, side]) => {
  const view = createHumanView(color); scene.add(view.group);
  return { root: live.frame.fighters[side], color, anim: la.anims[side], view };
});
const p0 = live.frame.fighters.a.pos;

const input = createInput(renderer.domElement);
// Cámara: C cicla pelea (3.ª persona sobre los peleadores) → jugador 1.ª → jugador 3.ª → libre.
// El modo del rig es first/third/free; `follow` dice a quién sigue la 3.ª persona.
const CAM = ['fight', 'p1', 'p3', 'free'];
let camMode = params.get('cam') ?? 'p3';                 // por defecto juegas tú; ?cam=fight para mirar la pelea
const rigMode = (m) => (m === 'p1' ? 'first' : m === 'free' ? 'free' : 'third');
const rig = createCameraRig(camera, input, { mode: rigMode(camMode), pos: [p0[0], groundY + 2.2, p0[2] + 5], speed: 5,
  cycle: [rigMode(camMode)],
  // 3.ª persona: la cámara no atraviesa bloques (se acerca al target si hay algo detrás)
  collide: (t, d, max) => { if (!world) return max; const h = world.raycastM([t.x, t.y, t.z], [d.x, d.y, d.z], max); return h ? Math.max(0.3, h.dist - 0.15) : max; } });
let cWas = false;
// Jugador: física de Mundo (AABB contra vóxeles, gravedad, escalón de 1 bloque), en metros; pies en (x,y,z).
// Spawn del jugador: columna despejada (3x3 con 5 bloques de aire encima: nada de nacer dentro de un árbol) cerca de la pelea.
let ps = [spawn[0] - 2, groundY + 1, spawn[1] + 2];
if (world) {
  const bx0 = Math.floor(ps[0] / BLOCK_M), bz0 = Math.floor(ps[2] / BLOCK_M);
  const clear = (x, z) => { const y = world.surfaceY(x, z); if (y < 0 || !world.solidAt(x, y, z)) return -1;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 1; dy <= 5; dy++) if (world.getBlock(x + dx, y + dy, z + dz) !== 0) return -1;
    return y; };
  find: for (let r = 0; r < 24; r++) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
    const y = clear(bx0 + x, bz0 + z); if (y >= 0) { ps = [(bx0 + x + 0.5) * BLOCK_M, (y + 1) * BLOCK_M, (bz0 + z + 0.5) * BLOCK_M]; break find; }
  }
}
const player = createPlayerBody({ x: ps[0], y: ps[1], z: ps[2] });
// mirar hacia la pelea al nacer
rig.setLook(Math.atan2(-(p0[0] - ps[0]), -(p0[2] - ps[2])), -0.25);
const playerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), new THREE.MeshLambertMaterial({ color: 0x5c6b4a })); // placeholder hasta el avatar
playerMesh.geometry.translate(0, 0.9, 0); scene.add(playerMesh);
const eye = new THREE.Vector3();
// Cavar / talar / poner (solo con mundo real) + vista de árboles que caen e items + controles táctiles.
const act = world ? createInteraction(world, player) : null;
const ents = world ? createEntityView(THREE, scene, world, atlas, { tileNames: TILES }) : null;
const touch = createTouchUI(input, { force: params.get('touch') === '1' || params.has('android') });
const hl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BLOCK_M * 1.004, BLOCK_M * 1.004, BLOCK_M * 1.004)),
  new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8 }));
hl.visible = false; scene.add(hl);
const hud = document.getElementById('hud'), cross = document.getElementById('cross');
const camDir = new THREE.Vector3();
let hudTxt = '';
const fps = createFpsMeter(document.getElementById('fps'));
const mid = new THREE.Vector3();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// Radio adaptativo: baja si el frame pasa de 33 ms, sube si sobra; la niebla sigue al radio.
const adapt = view && params.get('adapt') !== '0' ? createAdaptiveRadius({ max: RADIUS, min: 2.5,
  onChange(r) { view.setRadius(r); const f = fogForRadius(r); scene.fog.near = f.fogNear; scene.fog.far = f.fogFar; } }) : null;
const loop = createLoop({
  update(dt, tick) {
    const { frame } = la.update(dt);
    fighters.forEach((f, i) => { f.root = frame.list[i]; });
    if (live.done) live.restart(++fightSeed);                 // pelea siguiente, determinista
    mid.set((fighters[0].root.pos[0] + fighters[1].root.pos[0]) / 2, (fighters[0].root.pos[1] + fighters[1].root.pos[1]) / 2 + 1.0, (fighters[0].root.pos[2] + fighters[1].root.pos[2]) / 2);
    const c = input.down('KeyC'); if (c && !cWas) { camMode = CAM[(CAM.indexOf(camMode) + 1) % CAM.length]; rig.setMode(rigMode(camMode)); } cWas = c;
    if (camMode === 'p1' || camMode === 'p3') {
      const [mx, mz] = input.moveAxis();
      stepPlayer(world ?? { getBlock: (x, y, z) => (getBlock(x, y, z) ? 3 : 0) }, player, { moveX: mx, moveZ: mz, jump: input.down('Space'), sprint: input.down('ShiftLeft'), yaw: rig.yaw }, dt);
    }
    playerMesh.position.set(player.x, player.y, player.z); playerMesh.rotation.y = rig.yaw; playerMesh.visible = camMode === 'p3' || camMode === 'free';
    if (camMode === 'fight') rig.setTarget(mid);
    else { const [ex, ey, ez] = playerEye(player); rig.setTarget(eye.set(ex, camMode === 'p1' ? ey : ey - 0.3, ez)); }
    rig.update(dt);
    if (world) world.updateEntities(dt);
    const playing = camMode === 'p1' || camMode === 'p3';
    if (act) {
      camera.getWorldDirection(camDir);
      const [ex, ey, ez] = playerEye(player);
      act.update(dt, [ex, ey, ez], [camDir.x, camDir.y, camDir.z], playing
        ? { dig: input.down('Dig') || input.mouseDown(0), place: input.down('Place') || input.mouseDown(2), next: input.down('Next') || input.down('KeyE') }
        : { dig: false, place: false, next: false });
      const a = playing ? act.aim : null;
      hl.visible = !!a; if (a) hl.position.set((a.pos[0] + 0.5) * BLOCK_M, (a.pos[1] + 0.5) * BLOCK_M, (a.pos[2] + 0.5) * BLOCK_M);
    }
    if (view) view.update(camMode === 'free' ? camera.position.x : (camMode === 'fight' ? mid.x : player.x), camMode === 'free' ? camera.position.z : (camMode === 'fight' ? mid.z : player.z));
  },
  render(now) {
    ents?.update(); touch?.update();
    const playing = camMode === 'p1' || camMode === 'p3';
    cross.style.display = playing ? 'block' : 'none';
    const sel = act?.selected, d = act?.dig;
    const t = !act ? '' : `${camMode}  ·  bloque: ${sel ? BLOCKS[sel].name : '-'} x${sel ? act.inv.get(sel) : 0}` + (d ? `  ·  cavando ${Math.round(100 * d.t / d.need)}%` : '');
    if (t !== hudTxt) { hud.textContent = hudTxt = t; }
    for (const f of fighters) f.view.update(f.anim.skeleton); renderer.render(scene, camera); fps.frame(); adapt?.frame(); },
});
loop.start();
window.__ORIGEN__ = { scene, camera, rig, loop, player, act, ents, input, get camMode() { return camMode; }, fps, fighters, live, adapt, SEED, world, view, look, renderer, ready: true };
