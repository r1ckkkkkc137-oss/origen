// footplacement.js — suelo de vóxeles (celdas de BLOCK_M metros), raycast vertical por pie y controlador de pasos.
// getBlock(ix,iy,iz) -> truthy si la celda es sólida. La celda iy ocupa [iy*blockM, (iy+1)*blockM] => su tope es (iy+1)*blockM.
import { DIM } from './skeleton3d.js';
import { clamp, smoothstep, smin, lerp } from './math3.js';

// Muestreador de suelo sobre vóxeles. getBlock(ix,iy,iz) en coordenadas de celda MUNDO (x adelante, y arriba, z derecha),
// celdas de `blockM` metros (BLOCK_M del contrato; 0.5 m por defecto). El motor de animación trabaja en un marco interno
// (+Z adelante, +X izquierda), así que aquí se convierte: x_mundo = z_int, z_mundo = -x_int.
// top(xi, zi, yHint) -> altura (m) del tope del primer bloque bajo yHint+maxUp.
export function makeTopSampler(getBlock, blockM = 0.5) {
  const maxUp = blockM * 1.2 + 0.1, maxDown = 6;
  return (xi, zi, yHint) => {
    const bx = Math.floor(zi / blockM), bz = Math.floor(-xi / blockM);
    const yTop = Math.floor((yHint + maxUp) / blockM), yMin = Math.floor((yHint - maxDown) / blockM);
    for (let y = yTop; y >= yMin; y--) if (getBlock(bx, y, bz)) return (y + 1) * blockM;
    return yMin * blockM;
  };
}

// Suelo bajo un pie: máximo de 3 muestras (talón, centro, punta) => el pie nunca se hunde en un borde de bloque.
export function footGround(top, x, z, yaw, yHint) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let g = top(x, z, yHint);
  const gt = top(x + fx * DIM.foot, z + fz * DIM.foot, yHint); if (gt > g) g = gt;
  const gh = top(x - fx * 0.06, z - fz * 0.06, yHint); if (gh > g) g = gh;
  return g;
}

// Si los 3 puntos de apoyo (talón, centro, punta) no están al mismo nivel (el pie caería a caballo sobre un borde),
// desliza el pie a lo largo de su dirección hasta apoyarse completo en el nivel más alto (máx. 0.30 m).
export function relaxFoot(top, x, z, yaw, yHint, out = { x: 0, z: 0, y: 0 }) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const levels = (cx, cz) => [top(cx - fx * 0.06, cz - fz * 0.06, yHint), top(cx, cz, yHint), top(cx + fx * DIM.foot, cz + fz * DIM.foot, yHint)];
  const hi = (l) => Math.max(l[0], l[1], l[2]), flat = (l) => l[0] === l[1] && l[1] === l[2];
  let l = levels(x, z), cx = x, cz = z;
  if (!flat(l)) {
    const dir = l[2] > l[0] ? 1 : -1;      // hacia el lado más alto
    for (let d = 0.02; d <= 0.30; d += 0.02) { const m = levels(x + fx * d * dir, z + fz * d * dir); if (flat(m)) { cx = x + fx * d * dir; cz = z + fz * d * dir; l = m; break; } }
  }
  out.x = cx; out.z = cz; out.y = hi(l); return out;
}

// Pose de pie "home" (relativa al root, mirando +Z): estancia de guardia ortodoxa (izquierda adelante) y la de marcha natural.
export const FEET_HOME = Object.freeze({
  guard: { L: { x: 0.17, z: 0.26, yaw: -0.25 }, R: { x: -0.15, z: -0.20, yaw: -0.70 } },
  walk:  { L: { x: 0.12, z: 0.0, yaw: -0.15 }, R: { x: -0.12, z: 0.0, yaw: -0.25 } },
});
export function homeLocal(side, walkAmt, out = { x: 0, z: 0, yaw: 0 }) {
  const g = FEET_HOME.guard[side], w = FEET_HOME.walk[side];
  out.x = lerp(g.x, w.x, walkAmt); out.z = lerp(g.z, w.z, walkAmt); out.yaw = lerp(g.yaw, w.yaw, walkAmt); return out;
}

export const STEP = Object.freeze({
  dur: 0.34,          // duración del paso (s)
  lookahead: 0.18,    // el pie aterriza adelantado v*lookahead respecto del home (equilibrio de alternancia)
  minThr: 0.06,       // umbral mínimo de retraso para disparar paso en movimiento
  settleThr: 0.025,   // pasos de asentamiento con el cuerpo quieto
  turnThr: 0.14,      // desvío de posición que dispara pivote al girar
  yawThr: 0.55,       // desvío de ángulo del pie que dispara pivote
  maxFootSpeed: 1.55,  // m/s medios del pie en el aire (pico ~1.33x ≈ 2.05 m/s ≈ 3.4 cm/frame)
  lift: 0.05, liftMax: 0.11,
  force: 0.55,        // retraso que fuerza paso aunque el otro pie esté en el aire
});

const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export { wrapPi };

export function createFoot(side) {
  return { side, planted: true, pos: [0, 0, 0], yaw: 0, sole: 0, pitch: 0, swing: null, lastStepT: -9, stepCount: 0 };
}

// Coloca los pies en su home (sin pasos), sobre el suelo.
export function initFeet(feet, top, root, yaw, walkAmt = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw), h = { x: 0, z: 0, yaw: 0 };
  for (const f of feet) {
    homeLocal(f.side, walkAmt, h);
    f.pos[0] = root[0] + h.x * c + h.z * s; f.pos[2] = root[2] - h.x * s + h.z * c;   // Ry(yaw): x'=x c + z s, z'=-x s + z c
    f.yaw = yaw + h.yaw; f.planted = true; f.swing = null;
    f.sole = footGround(top, f.pos[0], f.pos[2], f.yaw, root[1]);
    f.pos[1] = f.sole;
  }
}

// Mundo del home de un pie
export function homeWorld(side, walkAmt, root, yaw, out) {
  const h = homeLocal(side, walkAmt, { x: 0, z: 0, yaw: 0 }); const c = Math.cos(yaw), s = Math.sin(yaw);
  out.x = root[0] + h.x * c + h.z * s; out.z = root[2] - h.x * s + h.z * c; out.yaw = yaw + h.yaw; return out;
}

// Un tick del controlador de pasos. st = { t, vel:[vx,vz] mundo, speed, walkAmt, idleT }. Devuelve eventos.
export function updateFeet(feet, top, root, yaw, st, dt, events) {
  const hw = [{ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0, yaw: 0 }];
  feet.forEach((f, i) => homeWorld(f.side, st.walkAmt, root, yaw, hw[i]));
  // 1) avanzar pies en el aire
  for (const f of feet) {
    if (f.planted) continue;
    const w = f.swing; w.s += dt / w.dur;
    // re-muestrear el suelo del destino (bloques pueden cambiar) y orientación
    w.y1 = footGround(top, w.to[0], w.to[2], w.yaw1, w.y1);
    if (w.s >= 1) {
      f.planted = true; f.pos[0] = w.to[0]; f.pos[2] = w.to[2]; f.yaw = w.yaw1; f.sole = w.y1; f.pos[1] = f.sole; f.pitch = 0; f.swing = null;
      events.push({ type: 'plant', foot: f.side, pos: f.pos.slice() });
    } else {
      const s = w.s, rise = w.y1 - w.y0;
      const eV = rise > 0 ? 1 - Math.pow(1 - s, 2) : s;                          // sube rápido si el destino es más alto
      const hDelay = clamp(rise / 1.0, 0, 1) * 0.30;                                // y retrasa el avance horizontal
      const sh = clamp((s - hDelay) / (1 - hDelay), 0, 1);
      const eH = 0.35 * sh + 0.65 * smoothstep(sh);                                // mezcla lineal/smoothstep: pico de velocidad ~1.3x
      f.pos[0] = w.from[0] + (w.to[0] - w.from[0]) * eH; f.pos[2] = w.from[2] + (w.to[2] - w.from[2]) * eH;
      const clearance = w.lift + 0.25 * Math.abs(rise);
      f.sole = w.y0 + rise * (rise > 0 ? eV : smoothstep(s)) + clearance * Math.sin(Math.PI * s);
      f.pos[1] = f.sole;
      f.yaw = w.yaw0 + wrapPi(w.yaw1 - w.yaw0) * smoothstep(s);
      f.pitch = -0.5 * Math.sin(Math.PI * clamp(s * 4, 0, 1)) + 0.3 * Math.sin(Math.PI * clamp((s - 0.4) / 0.6, 0, 1));
    }
  }
  // 2) ¿disparar un paso?
  const anySwing = feet.some((f) => !f.planted);
  const moving = st.speed > 0.08;
  let best = -1, bestU = 0, bestTarget = null;
  for (let i = 0; i < 2; i++) {
    const f = feet[i]; if (!f.planted) continue;
    const dx = hw[i].x - f.pos[0], dz = hw[i].z - f.pos[2], dd = Math.hypot(dx, dz);
    const yawErr = Math.abs(wrapPi(hw[i].yaw - f.yaw));
    let u = 0;
    if (moving) {
      const mx = st.vel[0] / st.speed, mz = st.vel[1] / st.speed;
      const behind = dx * mx + dz * mz;
      const thr = Math.max(STEP.minThr, st.speed * STEP.lookahead);
      u = Math.max(behind / thr, dd / (thr + 0.30));
    } else {
      if (dd > STEP.turnThr || yawErr > STEP.yawThr) u = Math.max(dd / STEP.turnThr, yawErr / STEP.yawThr);
      else if (st.idleT > 0.25 && (dd > STEP.settleThr || yawErr > 0.12)) u = 1;
    }
    if (u >= 1 && !(f.lastStepT > st.t - 0.06)) {
      if (anySwing && dd < STEP.force) continue;
      // preferir alternar: el pie que no dio el último paso gana a igual urgencia
      let ue = u; if (feet[1 - i].lastStepT > f.lastStepT) ue *= 1.15;
      if (ue > bestU) { bestU = ue; best = i; }
    }
  }
  if (best >= 0) {
    const f = feet[best];
    const h = hw[best];
    // aterriza donde estará su "home" al final del paso (home actual + movimiento del cuerpo durante el vuelo)
    const lead = moving ? Math.min(st.speed * STEP.dur * 1.5, 0.8) : 0;   // movimiento del cuerpo durante el vuelo + media zancada por delante
    let tx = h.x + (moving ? st.vel[0] / st.speed : 0) * lead;
    let tz = h.z + (moving ? st.vel[1] / st.speed : 0) * lead;
    const yaw1 = h.yaw;
    const rf = relaxFoot(top, tx, tz, yaw1, f.sole); tx = rf.x; tz = rf.z; const y1 = rf.y;
    const dist = Math.hypot(tx - f.pos[0], tz - f.pos[2]);
    f.planted = false; f.lastStepT = st.t; f.stepCount++;
    const travel = Math.hypot(dist, 2 * Math.abs(y1 - f.sole));
    f.swing = { s: 0, dur: clamp(travel / STEP.maxFootSpeed, STEP.dur, 0.6), from: f.pos.slice(), to: [tx, y1, tz], y0: f.sole, y1, yaw0: f.yaw, yaw1,
      lift: clamp(STEP.lift + 0.06 * dist, STEP.lift, STEP.liftMax) };
    events.push({ type: 'liftoff', foot: f.side, from: f.pos.slice(), to: [tx, y1, tz] });
  }
}

// Altura de pelvis: cae al pie plantado MÁS BAJO (con resorte), con tope por alcance de piernas (smin) para no hiperextender.
export const LEG = DIM.thigh + DIM.shin;
export const LEG_EFF = LEG * 0.965;
export const HIP_ABOVE_ANKLE = 0.755;      // altura cadera-tobillo en guardia (rodillas ~40° flexionadas)
export function capHeightForFoot(hipXZ, ankle) {
  const hz = Math.hypot(hipXZ[0] - ankle[0], hipXZ[1] - ankle[2]);
  const v = Math.sqrt(Math.max(0.45 * 0.45, LEG_EFF * LEG_EFF - hz * hz));
  return ankle[1] + v;
}
export { smin };
