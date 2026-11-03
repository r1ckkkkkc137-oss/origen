// Colisión AABB contra vóxeles + raycast DDA.
// API en METROS y segundos (espacio mundo). Cuerpo: { x, y, z (pies, centro XZ), vx, vy, vz (m/s), halfW (0.3 m), height (1.8 m),
// onGround, inWater }. Internamente se convierte a bloques (units.js) y se resuelve en la grilla entera; al terminar se devuelve a metros.
// Con BLOCK_SIZE_M=1 (contracts v0.2) la conversión es la identidad, pero el código no lo asume.
import { B, IS_SOLID, IS_LIQUID } from './blocks.js';
import { CHUNK_Y } from './chunk.js';
import { BLOCK_SIZE_M as S } from './units.js';

const SKIN = 1e-4;
const EPS = 1e-6;
// gravity (m/s²), terminalVelocity (m/s), stepHeight (m: 0 = sin auto-escalón), waterDrag (1/s)
export const DEFAULTS = Object.freeze({ gravity: -9.81, terminalVelocity: -50, stepHeight: 0, waterGravityScale: 0.15, waterDrag: 3 });

export function createBody(x, y, z, opts = {}) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, halfW: opts.halfW ?? 0.3, height: opts.height ?? 1.8, onGround: false, inWater: false };
}

// y<0: suelo del mundo (sólido) para que nada caiga al vacío; y>=SY: aire (getBlock ya lo devuelve así).
const solidAt = (world, x, y, z) => y < 0 || IS_SOLID[world.getBlock(x, y, z)] === 1;

/** Mueve el cuerpo `delta` sobre el eje (0=x,1=y,2=z) frenándolo contra bloques sólidos. Devuelve lo que realmente avanzó. */
function moveAxis(world, body, axis, delta) {
  if (delta === 0) return 0;
  const hw = body.halfW;
  const minX = body.x - hw, maxX = body.x + hw, minY = body.y, maxY = body.y + body.height, minZ = body.z - hw, maxZ = body.z + hw;
  let allowed = delta;
  // rango de celdas en los ejes no movidos (encogido por EPS para ignorar caras que solo tocan)
  const x0 = Math.floor(minX + EPS), x1 = Math.floor(maxX - EPS);
  const y0 = Math.floor(minY + EPS), y1 = Math.floor(maxY - EPS);
  const z0 = Math.floor(minZ + EPS), z1 = Math.floor(maxZ - EPS);
  if (axis === 0) {
    const a = delta > 0 ? Math.floor(maxX - EPS) : Math.floor(minX + EPS + delta), b = delta > 0 ? Math.floor(maxX + delta) : Math.floor(minX + EPS);
    for (let x = a; x <= b; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      if (!solidAt(world, x, y, z)) continue;
      if (delta > 0) { const m = x - maxX - SKIN; if (m < allowed) allowed = m; }
      else { const m = x + 1 - minX + SKIN; if (m > allowed) allowed = m; }
    }
  } else if (axis === 1) {
    const a = delta > 0 ? Math.floor(maxY - EPS) : Math.floor(minY + EPS + delta), b = delta > 0 ? Math.floor(maxY + delta) : Math.floor(minY + EPS);
    for (let y = a; y <= b; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (!solidAt(world, x, y, z)) continue;
      if (delta > 0) { const m = y - maxY - SKIN; if (m < allowed) allowed = m; }
      else { const m = y + 1 - minY + SKIN; if (m > allowed) allowed = m; }
    }
  } else {
    const a = delta > 0 ? Math.floor(maxZ - EPS) : Math.floor(minZ + EPS + delta), b = delta > 0 ? Math.floor(maxZ + delta) : Math.floor(minZ + EPS);
    for (let z = a; z <= b; z++) for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (!solidAt(world, x, y, z)) continue;
      if (delta > 0) { const m = z - maxZ - SKIN; if (m < allowed) allowed = m; }
      else { const m = z + 1 - minZ + SKIN; if (m > allowed) allowed = m; }
    }
  }
  // no retroceder por penetraciones iniciales: el avance real nunca va en sentido contrario a delta
  if (delta > 0 ? allowed < 0 : allowed > 0) allowed = 0;
  if (axis === 0) body.x += allowed; else if (axis === 1) body.y += allowed; else body.z += allowed;
  return allowed;
}

/** ¿El cuerpo (en metros) toca algún sólido? (para tests/anti-atasco) */
export function collides(world, bodyM) {
  return collidesB(world, toBlockBody(bodyM));
}
function toBlockBody(m) {
  return { x: m.x / S, y: m.y / S, z: m.z / S, vx: m.vx / S, vy: m.vy / S, vz: m.vz / S, halfW: m.halfW / S, height: m.height / S, onGround: m.onGround, inWater: m.inWater };
}
function collidesB(world, body) {
  const hw = body.halfW;
  for (let x = Math.floor(body.x - hw + EPS); x <= Math.floor(body.x + hw - EPS); x++)
    for (let y = Math.floor(body.y + EPS); y <= Math.floor(body.y + body.height - EPS); y++)
      for (let z = Math.floor(body.z - hw + EPS); z <= Math.floor(body.z + hw - EPS); z++)
        if (solidAt(world, x, y, z)) return true;
  return false;
}

/**
 * Avanza el cuerpo dt segundos: gravedad, integración por eje (Y, X, Z) con barrido exacto (sin atravesar bloques a alta velocidad),
 * y paso automático de escalones de hasta opts.stepHeight bloques (0 = desactivado, 1 = subir 1 bloque).
 * Modifica el cuerpo (x,y,z,vx,vy,vz,onGround,inWater) y lo devuelve. Las velocidades horizontales las pone el controlador/IA.
 */
export function moveAndCollide(world, bodyM, dt, opts = {}) {
  const o0 = { ...DEFAULTS, ...opts };
  const body = toBlockBody(bodyM);
  const o = { ...o0, gravity: o0.gravity / S, terminalVelocity: o0.terminalVelocity / S, stepHeight: o0.stepHeight / S };
  stepBlocks(world, body, dt, o);
  bodyM.x = body.x * S; bodyM.y = body.y * S; bodyM.z = body.z * S;
  bodyM.vx = body.vx * S; bodyM.vy = body.vy * S; bodyM.vz = body.vz * S;
  bodyM.onGround = body.onGround; bodyM.inWater = body.inWater;
  return bodyM;
}

/** Núcleo en espacio de bloques (todo en bloques, bloques/s, bloques/s²). */
function stepBlocks(world, body, dt, o) {
  const wasGround = body.onGround;
  // agua: el cuerpo está "en agua" si el bloque a media altura es líquido
  body.inWater = IS_LIQUID[world.getBlock(Math.floor(body.x), Math.floor(body.y + body.height * 0.5), Math.floor(body.z))] === 1;
  let g = o.gravity;
  if (body.inWater) { g *= o.waterGravityScale; const k = Math.max(0, 1 - o.waterDrag * dt); body.vx *= k; body.vz *= k; body.vy *= k; }
  body.vy = Math.max(o.terminalVelocity, body.vy + g * dt);

  // Y
  body.onGround = false;
  const dy = body.vy * dt;
  const movedY = moveAxis(world, body, 1, dy);
  if (movedY !== dy) { if (dy < 0) body.onGround = true; body.vy = 0; }

  // XZ
  const dx = body.vx * dt, dz = body.vz * dt;
  const sx = body.x, sy = body.y, sz = body.z;
  const mx = moveAxis(world, body, 0, dx);
  const mz = moveAxis(world, body, 2, dz);
  const blocked = mx !== dx || mz !== dz;
  if (blocked && o.stepHeight > 0 && (wasGround || body.onGround)) {
    const fx = body.x, fy = body.y, fz = body.z;
    body.x = sx; body.y = sy; body.z = sz;
    const up = moveAxis(world, body, 1, o.stepHeight);
    const sx2 = moveAxis(world, body, 0, dx);
    const sz2 = moveAxis(world, body, 2, dz);
    moveAxis(world, body, 1, -up - SKIN * 2);
    const progressed = Math.abs(sx2) + Math.abs(sz2) > Math.abs(mx) + Math.abs(mz) + 1e-9;
    if (progressed && body.y >= sy - 1e-9) { body.onGround = true; }
    else { body.x = fx; body.y = fy; body.z = fz; }
  }
  if (body.x !== sx && Math.abs(body.x - sx) < Math.abs(dx) - 1e-9) body.vx = 0;
  if (body.z !== sz && Math.abs(body.z - sz) < Math.abs(dz) - 1e-9) body.vz = 0;
}

/**
 * Raycast de bloques (Amanatides-Woo). origin y dir son [x,y,z]; origen y maxDist en METROS (dir no hace falta normalizarla).
 * Devuelve { pos:[bx,by,bz] (bloque golpeado), normal:[nx,ny,nz] (cara golpeada, apunta hacia el rayo), block:id, dist (m),
 * place:[bx,by,bz] (celda previa, para colocar) } o null. Mismo formato que RaycastHit del contrato (+ place).
 * Por defecto atraviesa aire y agua; opts.hitLiquid=true para golpear agua. Si el origen está dentro de un bloque golpeable devuelve ese
 * bloque con normal [0,0,0] y dist 0. Acepta también origin/dir como {x,y,z}.
 */
export function raycast(world, origin, dir, maxDist = 6, opts = {}) {
  const O = Array.isArray(origin) ? origin : [origin.x, origin.y, origin.z];
  const D = Array.isArray(dir) ? dir : [dir.x, dir.y, dir.z];
  const len = Math.hypot(D[0], D[1], D[2]);
  if (len === 0) return null;
  const dx = D[0] / len, dy = D[1] / len, dz = D[2] / len;
  const ox = O[0] / S, oy = O[1] / S, oz = O[2] / S, maxB = maxDist / S; // a espacio de bloques
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity, tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity, tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) * tDeltaX) : Infinity;
  let tMaxY = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) * tDeltaY) : Infinity;
  let tMaxZ = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ) : Infinity;
  const hittable = (id) => id !== B.AIR && (opts.hitLiquid || !IS_LIQUID[id]);
  let id = world.getBlock(x, y, z);
  if (hittable(id)) return { pos: [x, y, z], normal: [0, 0, 0], block: id, dist: 0, place: [x, y, z] };
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (;;) {
    const px = x, py = y, pz = z;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    if (t > maxB) return null;
    if (y < 0 || y >= CHUNK_Y) { if ((y < 0 && stepY < 0) || (y >= CHUNK_Y && stepY > 0)) return null; continue; }
    id = world.getBlock(x, y, z);
    if (hittable(id)) return { pos: [x, y, z], normal: [nx, ny, nz], block: id, dist: t * S, place: [px, py, pz] };
  }
}
