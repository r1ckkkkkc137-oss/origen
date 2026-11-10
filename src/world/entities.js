// ENTIDADES DEL MUNDO: árbol que cae (FallingTree) y objetos sueltos (ItemDrop). Todo determinista: paso fijo, sin relojes ni Math.random;
// el azar sale de hash3(seed del mundo, coords de bloque). Misma seed + mismos golpes + misma secuencia de dt = mismo resultado bit a bit.
//
// UNIDADES: el grid (bloques de la entidad, pivote) va en BLOQUES; posiciones/velocidades de entidades y de items en METROS (como physics.js).
//
// FallingTree: al talar, los troncos y la copa salen del grid (setBlock AIR, como siempre) y pasan a esta entidad como lista de bloques con
// coordenadas ENTERAS de mundo + un pivote (bisagra) en la base: el borde inferior del lado hacia donde cae. Rota alrededor del eje horizontal
// a = up x d (d = dirección de caída, unitaria) con un péndulo invertido de varilla uniforme: θ'' = k·sinθ, k = 1.5·g/L (L = alto del árbol en m).
// Impacto: (1) el CENTRO de un bloque de TRONCO cae dentro de una celda sólida que no sea hoja (suelo en pendiente, roca, otro tronco, pared) →
// se vuelve al ángulo anterior y se detiene; (2) θ llega a 90°. Las HOJAS son pasables: la copa atraviesa follaje (decisión: así un árbol
// junto a otro no queda colgado de las hojas) pero no suelo/rocas. Al impactar la entidad desaparece y suelta un ItemDrop por tronco en la
// pose final (con jitter determinista por hash3), que luego cae con gravedad y colisiona contra vóxeles (physics.moveAndCollide).
//
// ItemDrop: cubito de 0.2 m. id = id de bloque (el CUT_LOG de la especie: lo que hoy devuelve fellTree en drops) o ITEM_STICK (256, ver README).
// Hojas: por defecto NO sueltan nada (leafDrops:false); con leafDrops:true cada hoja da 1 palo con prob. 1/24 (hash3), máx. 6 por árbol.
import { hash3 } from '../shared/rng.js';
import { BLOCKS, IS_SOLID, IS_LEAF } from './blocks.js';
import { moveAndCollide, collides } from './physics.js';
import { BLOCK_SIZE_M as S } from './units.js';

export const STEP = 1 / 120;           // paso fijo de simulación (s)
export const MAX_FRAME_DT = 0.25;      // tope de dt por llamada a updateEntities (anti espiral)
export const FALL_MAX_TIME = 8;        // s: seguro; un árbol que no impacta antes se detiene
export const ITEM_TTL = 300;           // s de simulación hasta que un item desaparece
export const MAX_ITEMS = 512;          // tope de items vivos (los más viejos se descartan)
export const ITEM_STICK = 256;         // id de item "palo" (fuera del rango de ids de bloque 0..255)
export const ITEM_SIZE_M = 0.2;
const G = 9.81, THETA0 = 0.04, OMEGA0 = 0.12, THETA_MAX = Math.PI / 2;
const SALT_DIR = 0xfa11, SALT_ITEM = 0x1de7, SALT_STICK = 0x57c4;

const solidNonLeaf = (world, x, y, z) => y < 0 || (IS_SOLID[world.getBlock(x, y, z)] === 1 && IS_LEAF[world.getBlock(x, y, z)] !== 1);

/** Estado inicial del mundo para entidades (lo crea World). */
export function createEntityState() { return { trees: [], items: [], acc: 0, time: 0, nextId: 1, events: [], steps: 0 }; }

/** Dirección de caída (unitaria, [dx,dz]) a partir de opciones y del centro de la base (bloques). Sin dirección: hash determinista de la base. */
export function fallDirection(seed, cx, cz, baseKey, opts = {}) {
  let dx = 0, dz = 0;
  if (Number.isFinite(opts.dirX) && Number.isFinite(opts.dirZ) && (opts.dirX !== 0 || opts.dirZ !== 0)) { dx = opts.dirX; dz = opts.dirZ; }
  else if (Number.isFinite(opts.fromX) && Number.isFinite(opts.fromZ)) { dx = cx - opts.fromX; dz = cz - opts.fromZ; }
  const l = Math.hypot(dx, dz);
  if (l > 1e-9) return [dx / l, dz / l];
  const a = hash3((seed ^ SALT_DIR) | 0, baseKey[0], baseKey[1], baseKey[2]) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

/**
 * Crea la entidad. logs/leaves: [[x,y,z,id]] ya quitados del grid. d=[dx,dz] unitario. Devuelve el objeto FallingTree (no lo registra).
 */
export function createFallingTree(world, id, logs, leaves, d) {
  let yMin = Infinity, yMax = -Infinity, cx = 0, cz = 0, nb = 0;
  for (const [, y] of logs) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
  for (const [x, y, z] of logs) if (y === yMin) { cx += x + 0.5; cz += z + 0.5; nb++; }
  cx /= nb; cz /= nb;
  // bisagra: borde del lado de caída de los troncos bajos (raíces incluidas), para que ninguna raíz entre en el suelo al girar
  let ext = -Infinity;
  for (const [x, y, z] of logs) if (y - yMin <= 3) ext = Math.max(ext, (x + 0.5 - cx) * d[0] + (z + 0.5 - cz) * d[1]);
  ext += 0.5 * (Math.abs(d[0]) + Math.abs(d[1]));
  const px = cx + d[0] * ext, py = yMin, pz = cz + d[1] * ext;       // pivote (bloques)
  const L = (yMax - yMin + 1) * S;                                    // alto del tronco (m)
  const mk = (arr) => arr.map(([x, y, z, b]) => ({ x, y, z, id: b, rx: x + 0.5 - px, ry: y + 0.5 - py, rz: z + 0.5 - pz }));
  return {
    id, kind: 'tree', dir: d, axis: [d[1], 0, -d[0]],                // a = up x d = (dz, 0, -dx)
    pivot: [px, py, pz], pivotM: [px * S, py * S, pz * S], heightM: L, k: 1.5 * G / L,
    theta: THETA0, omega: OMEGA0, t: 0, status: 'falling',            // 'falling' | 'impact'
    logs: mk(logs), leaves: mk(leaves), opts: null,
  };
}

/** Posición rotada (bloques, relativa al pivote) de un bloque con offset (rx,ry,rz) para el ángulo theta (Rodrigues sobre el eje horizontal a). */
export function rotatedOffset(tree, rx, ry, rz, theta, out = [0, 0, 0]) {
  const [ax, , az] = tree.axis, c = Math.cos(theta), s = Math.sin(theta);
  const dot = ax * rx + az * rz, k = dot * (1 - c);
  // a x v con a=(ax,0,az): (0*rz - az*ry, az*rx - ax*rz, ax*ry - 0*rx)
  out[0] = rx * c + (-az * ry) * s + ax * k;
  out[1] = ry * c + (az * rx - ax * rz) * s;
  out[2] = rz * c + (ax * ry) * s + az * k;
  return out;
}

function treeHits(world, tree, theta) {
  const o = [0, 0, 0], [px, py, pz] = tree.pivot;
  for (const b of tree.logs) {
    rotatedOffset(tree, b.rx, b.ry, b.rz, theta, o);
    if (solidNonLeaf(world, Math.floor(px + o[0]), Math.floor(py + o[1]), Math.floor(pz + o[2]))) return true;
  }
  return false;
}

function stepTree(world, tree, dt) {
  tree.t += dt;
  const w0 = tree.omega, th0 = tree.theta;
  const omega = w0 + tree.k * Math.sin(th0) * dt;                   // semi-implícito
  let th = th0 + omega * dt;
  let impact = false;
  if (th >= THETA_MAX) { th = THETA_MAX; impact = true; }
  if (!impact && treeHits(world, tree, th)) { th = th0; impact = true; }
  if (!impact && tree.t >= FALL_MAX_TIME) impact = true;
  tree.theta = th; tree.omega = impact ? 0 : omega;
  if (impact) tree.status = 'impact';
}

/** Genera los ItemDrop de un árbol que impactó y los agrega al estado. Devuelve cuántos. */
function spawnTreeItems(world, st, tree, opts) {
  const o = [0, 0, 0], [px, py, pz] = tree.pivot, seed = world.seed;
  let n = 0;
  const make = (b, id, salt) => {
    rotatedOffset(tree, b.rx, b.ry, b.rz, tree.theta, o);
    const cxB = px + o[0], cyB = py + o[1], czB = pz + o[2];             // centro del bloque (bloques)
    const j = (k) => (hash3((seed ^ salt) | 0, b.x + k * 131, b.y, b.z) - 0.5);
    let x = (cxB + j(1) * 0.6) * S, y = (cyB + j(2) * 0.2) * S, z = (czB + j(3) * 0.6) * S;
    const it = makeItem(id, x, y - ITEM_SIZE_M / 2, z);
    if (collides(world, it)) { it.x = cxB * S; it.z = czB * S; it.y = cyB * S - ITEM_SIZE_M / 2; }   // sin jitter si el jitter cae dentro de un sólido
    for (let i = 0; i < 12 && collides(world, it); i++) it.y += 0.1;     // si el bloque estaba contra un muro, sube hasta quedar libre
    it.vx = j(4) * 1.2; it.vz = j(5) * 1.2; it.vy = 0.8 + (j(6) + 0.5) * 1.2;
    addItem(st, it); n++;
  };
  for (const b of tree.logs) make(b, BLOCKS[b.id].drop, SALT_ITEM);
  if (opts && opts.leafDrops) {
    let sticks = 0;
    for (const b of tree.leaves) {
      if (sticks >= 6) break;
      if (hash3((seed ^ SALT_STICK) | 0, b.x, b.y, b.z) < 1 / 24) { make(b, ITEM_STICK, SALT_STICK); sticks++; }
    }
  }
  return n;
}

export function makeItem(id, x, y, z) {
  return { id, count: 1, x, y, z, vx: 0, vy: 0, vz: 0, halfW: ITEM_SIZE_M / 2, height: ITEM_SIZE_M, onGround: false, inWater: false, age: 0, rest: 0, uid: 0 };
}
function addItem(st, it) {
  it.uid = st.nextId++;
  st.items.push(it);
  if (st.items.length > MAX_ITEMS) st.items.splice(0, st.items.length - MAX_ITEMS);
}

function stepItem(world, it, dt) {
  it.age += dt;
  if (it.rest >= 30) {                                               // dormido: solo comprobar de vez en cuando que sigue habiendo suelo debajo
    it.rest++;
    if (it.rest % 30 !== 0) return;
    const bx = Math.floor(it.x / S), bz = Math.floor(it.z / S), by = Math.floor((it.y - 0.01) / S);
    if (solidNonLeafOrAnySolid(world, bx, by, bz) && !collides(world, it)) return;
    it.rest = 0;
  }
  if (collides(world, it)) it.y += 0.05;                             // bloque puesto encima: sube
  moveAndCollide(world, it, dt);
  if (it.onGround) { const f = Math.exp(-10 * dt); it.vx *= f; it.vz *= f; }
  if (it.onGround && it.vx * it.vx + it.vz * it.vz < 0.0025 && Math.abs(it.vy) < 0.05) { it.rest++; if (it.rest >= 30) { it.vx = it.vy = it.vz = 0; } }
  else it.rest = 0;
}
const solidNonLeafOrAnySolid = (world, x, y, z) => y < 0 || IS_SOLID[world.getBlock(x, y, z)] === 1;

/** Un paso fijo (STEP) para todas las entidades. */
export function stepEntities(world, st) {
  st.time += STEP; st.steps++;
  if (st.trees.length) {
    let landed = false;
    for (const t of st.trees) { stepTree(world, t, STEP); if (t.status === 'impact') landed = true; }
    if (landed) {
      const keep = [];
      for (const t of st.trees) {
        if (t.status !== 'impact') { keep.push(t); continue; }
        const n = spawnTreeItems(world, st, t, t.opts);
        const o = rotatedOffset(t, 0, t.heightM / S * 0.5, 0, t.theta);
        st.events.push({ type: 'impact', treeId: t.id, x: (t.pivot[0] + o[0]) * S, y: (t.pivot[1] + o[1]) * S, z: (t.pivot[2] + o[2]) * S, theta: t.theta, items: n, time: st.time });
      }
      st.trees = keep;
    }
  }
  if (st.items.length) {
    let w = 0;
    for (const it of st.items) {
      stepItem(world, it, STEP);
      if (it.age < ITEM_TTL) st.items[w++] = it;
    }
    st.items.length = w;
  }
}

/** Avanza dt segundos con subpasos fijos (acumulador). Devuelve el número de pasos. */
export function updateEntities(world, st, dt) {
  st.acc += Math.min(Math.max(dt, 0), MAX_FRAME_DT);
  let n = 0;
  while (st.acc >= STEP) { st.acc -= STEP; stepEntities(world, st); n++; }
  return n;
}

/** Quita y devuelve los items cuyo centro está a <= radiusM (3D, metros) de pos ([x,y,z] o {x,y,z}). Orden de creación (determinista). */
export function pickupItems(st, pos, radiusM) {
  const px = Array.isArray(pos) ? pos[0] : pos.x, py = Array.isArray(pos) ? pos[1] : pos.y, pz = Array.isArray(pos) ? pos[2] : pos.z;
  const r2 = radiusM * radiusM, got = [], keep = [];
  for (const it of st.items) {
    const dx = it.x - px, dy = it.y + it.height / 2 - py, dz = it.z - pz;
    if (dx * dx + dy * dy + dz * dz <= r2) got.push({ id: it.id, count: it.count, x: it.x, y: it.y, z: it.z });
    else keep.push(it);
  }
  st.items = keep;
  return got;
}
