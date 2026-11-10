// footplacement.js — suelo de vóxeles (celdas de BLOCK_M metros), raycast vertical por pie y controlador de pasos.
// getBlock(ix,iy,iz) -> truthy si la celda es sólida. La celda iy ocupa [iy*blockM, (iy+1)*blockM] => su tope es (iy+1)*blockM.
import { DIM } from './skeleton3d.js';
import { clamp, smoothstep, smin, lerp } from './math3.js';

// Muestreador de suelo sobre vóxeles. getBlock(ix,iy,iz) en coordenadas de celda MUNDO (x adelante, y arriba, z derecha),
// celdas de `blockM` metros (BLOCK_M del contrato; 0.5 m por defecto). El motor de animación trabaja en un marco interno
// (+Z adelante, +X izquierda), así que aquí se convierte: x_mundo = z_int, z_mundo = -x_int.
// top(xi, zi, yHint) -> altura (m) del tope del primer bloque bajo yHint+maxUp.
const CEIL_EPS = 0.05;
export function makeTopSampler(getBlock, blockM = 0.5) {
  const maxUp = blockM * 1.2 + 0.1, maxDown = 6;
  return (xi, zi, yHint) => {
    const bx = Math.floor(zi / blockM), bz = Math.floor(-xi / blockM);
    const yTop = Math.floor((yHint + maxUp) / blockM), yMin = Math.floor((yHint - maxDown) / blockM);
    for (let y = yTop; y >= yMin; y--) {
      if (!getBlock(bx, y, bz)) continue;
      // Un bloque con aire debajo y cuya base queda sobre el pie es techo/voladizo, no suelo: se ignora.
      if (y * blockM > yHint + CEIL_EPS && !getBlock(bx, y - 1, bz)) continue;
      return (y + 1) * blockM;
    }
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
  guard: { L: { x: 0.21, z: 0.30, yaw: -0.20 }, R: { x: -0.19, z: -0.22, yaw: -0.78 } },   // ancho de hombros (0.40 m), escalonada 0.52 m, pie trasero ~45°
  walk:  { L: { x: 0.12, z: 0.0, yaw: -0.15 }, R: { x: -0.12, z: 0.0, yaw: -0.25 } },
});
export function homeLocal(side, walkAmt, out = { x: 0, z: 0, yaw: 0 }) {
  const g = FEET_HOME.guard[side], w = FEET_HOME.walk[side];
  out.x = lerp(g.x, w.x, walkAmt); out.z = lerp(g.z, w.z, walkAmt); out.yaw = lerp(g.yaw, w.yaw, walkAmt); return out;
}

export const STEP = Object.freeze({
  dur: 0.34,          // duración del paso (s)
  fightDur: 0.22,     // ronda 4: paso de pelea (st.fight): mínimo 0.22 s, pie a fightFootSpeed
  lookahead: 0.18,    // el pie aterriza adelantado v*lookahead respecto del home (equilibrio de alternancia)
  minThr: 0.06,       // umbral mínimo de retraso para disparar paso en movimiento
  settleThr: 0.025,   // pasos de asentamiento con el cuerpo quieto
  turnThr: 0.14,      // desvío de posición que dispara pivote al girar
  yawThr: 0.55,       // desvío de ángulo del pie que dispara pivote
  maxFootSpeed: 1.55,  // m/s medios del pie en el aire (pico ~1.33x ≈ 2.05 m/s ≈ 3.4 cm/frame)
  fightFootSpeed: 2.0, // ronda 4: de pelea (pico ~2.7 m/s ≈ 4.4 cm/frame; el stepIn de la sim va a ~2.7 m/s)
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


// ---------------------------------------------------------------- vuelo del pie con colisión contra caras laterales de bloques
// Huella inflada del pie (talón..punta+margen, ±8 cm): el pie en el aire nunca atraviesa la cara lateral de un bloque.
export const FOOT_CLEAR = 0.03;
// infl in [0,1]: 1 = huella con margen (camino), 0 = huella exacta (el aterrizaje).
export function footprintTop(top, x, z, yaw, hint, infl = 1) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw); let m = -1e9;
  const L = [-0.06 - 0.02 * infl, 0.05, 0.14, 0.22 + 0.04 * infl], W = [-0.05 - 0.03 * infl, 0, 0.05 + 0.03 * infl];
  for (const l of L) for (const w of W) { const v = top(x + fx * l + fz * w, z + fz * l - fx * w, hint); if (v > m) m = v; }
  return m;
}
const NPROF = 24, WU = 0.22;
// Planea un vuelo: si algo en el camino (huella inflada) es más alto que el pie, el vuelo es "vertical primero":
// sube recto hasta hTop (> tope más alto + holgura), avanza a esa altura y baja al final sin cortar el borde.
export function startSwing(f, top, to, yaw1, o = {}) {
  const from = f.pos.slice(), y0 = f.sole, y1 = to[1];
  const dist = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const hint = Math.max(y0, y1), prof = new Array(NPROF + 1);
  let hMax = -1e9;
  for (let i = 0; i <= NPROF; i++) {
    const u = i / NPROF, yw = f.yaw + wrapPi(yaw1 - f.yaw) * u;
    const r = footprintTop(top, from[0] + (to[0] - from[0]) * u, from[2] + (to[2] - from[2]) * u, yw, hint, 1 - smoothstep(clamp((u - 0.75) / 0.25, 0, 1)));
    prof[i] = r; if (r > hMax) hMax = r;
  }
  const wall = hMax > Math.max(y0, y1) + 0.02 || (y1 > y0 + 0.02) || o.hTop != null;
  const sw = { s: 0, dur: STEP.dur, from, to: [to[0], y1, to[2]], y0, y1, yaw0: f.yaw, yaw1, lift: 0, hTop: 0, sv: 0, tail: 0.3, prof, vertT: 0 };
  if (wall) {
    sw.hTop = o.hTop != null ? o.hTop : hMax + FOOT_CLEAR;
    const vertT = o.vertT ?? clamp((sw.hTop - y0) / 1.4, 0.16, 1.0);
    const horT = o.horT ?? clamp(dist / 1.3, 0.2, 0.5);
    sw.vertT = vertT; sw.dur = vertT + horT; sw.sv = vertT / sw.dur; sw.tail = o.tail ?? 0.35;
    sw.lift = 0;
  } else {
    const travel = Math.hypot(dist, 2 * Math.abs(y1 - y0));
    sw.dur = o.fight ? clamp(travel / STEP.fightFootSpeed, STEP.fightDur, 0.45) : clamp(travel / STEP.maxFootSpeed, STEP.dur, 0.6);
    sw.lift = clamp(STEP.lift + 0.06 * dist, STEP.lift, STEP.liftMax);
  }
  if (o.dur) sw.dur = o.dur;
  f.planted = false; f.stepCount++; f.swing = sw;
  return sw;
}
// Evalúa el vuelo en w.s: escribe f.pos (x,z), f.sole (altura), f.yaw, f.pitch.
export function swingPose(f, w, top) {
  const s = w.s, rise = w.y1 - w.y0;
  let eH, h;
  if (w.hTop > 0) {
    const sh = clamp((s - w.sv) / (1 - w.sv), 0, 1);
    eH = 0.35 * sh + 0.65 * smoothstep(sh);
    if (s < w.sv) h = w.y0 + (w.hTop - w.y0) * smoothstep(s / w.sv);
    else {
      const sd = 1 - w.tail;
      h = s <= sd ? w.hTop : w.hTop + (w.y1 - w.hTop) * smoothstep((s - sd) / w.tail);
      // envolvente: nunca por debajo del tope bajo la huella (con holgura y suavizado horizontal), salvo el tope de aterrizaje
      let env = -1e9;
      for (let i = 0; i <= NPROF; i++) {
        const r = w.prof[i]; if (r <= w.y1 + 0.01) continue;
        const d = Math.abs(eH - i / NPROF) / WU; if (d >= 1) continue;
        const k = 0.5 + 0.5 * Math.cos(Math.PI * d); const v = (r + FOOT_CLEAR) * k + w.y1 * (1 - k); if (v > env) env = v;
      }
      if (env > h) h = env;
    }
  } else {
    const eV = rise > 0 ? 1 - Math.pow(1 - s, 2) : s;
    const hDelay = clamp(rise / 1.0, 0, 1) * 0.30, sh = clamp((s - hDelay) / (1 - hDelay), 0, 1);
    eH = 0.35 * sh + 0.65 * smoothstep(sh);
    h = w.y0 + rise * (rise > 0 ? eV : smoothstep(s)) + (w.lift + 0.25 * Math.abs(rise)) * Math.sin(Math.PI * s);
  }
  f.pos[0] = w.from[0] + (w.to[0] - w.from[0]) * eH; f.pos[2] = w.from[2] + (w.to[2] - w.from[2]) * eH;
  f.sole = h; f.pos[1] = h;
  f.yaw = w.yaw0 + wrapPi(w.yaw1 - w.yaw0) * smoothstep(s);
  f.pitch = -0.5 * Math.sin(Math.PI * clamp(s * 4, 0, 1)) + 0.3 * Math.sin(Math.PI * clamp((s - 0.4) / 0.6, 0, 1));
}

// Un tick del controlador de pasos. st = { t, vel:[vx,vz] mundo, speed, walkAmt, idleT }. Devuelve eventos.
export function updateFeet(feet, top, root, yaw, st, dt, events) {
  const hw = [{ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0, yaw: 0 }];
  feet.forEach((f, i) => homeWorld(f.side, st.walkAmt, root, yaw, hw[i]));
  // 1) avanzar pies en el aire
  for (let fi = 0; fi < feet.length; fi++) {
    const f = feet[fi];
    if (f.planted) continue;
    const w = f.swing; w.s += dt / w.dur;
    // ronda 4, de pelea: el destino persigue al home mientras el cuerpo sigue en la ráfaga (stepIn/stepOut duran ~0.1 s y el pie sale antes de que termine)
    if (st.fight && !w.hTop && w.s < 0.7) { const h = hw[fi], kk = 1 - Math.exp(-dt * 30); w.to[0] += (h.x - w.to[0]) * kk; w.to[2] += (h.z - w.to[2]) * kk; }
    // re-muestrear el suelo del destino (bloques pueden cambiar) y orientación
    w.y1 = footGround(top, w.to[0], w.to[2], w.yaw1, w.y1);
    if (w.s >= 1) {
      f.planted = true; f.pos[0] = w.to[0]; f.pos[2] = w.to[2]; f.yaw = w.yaw1; f.sole = w.y1; f.pos[1] = f.sole; f.pitch = 0; f.swing = null;
      events.push({ type: 'plant', foot: f.side, pos: f.pos.slice() });
    } else swingPose(f, w, top);
  }
  // 2) ¿disparar un paso?
  if (st.freeze) return;
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
      const thr = st.fight ? STEP.minThr + 0.02 : Math.max(STEP.minThr, st.speed * STEP.lookahead);   // de pelea el pie arranca enseguida
      u = Math.max(behind / thr, dd / (thr + 0.30));
    } else {
      if (dd > STEP.turnThr || yawErr > STEP.yawThr) u = Math.max(dd / STEP.turnThr, yawErr / STEP.yawThr);
      else if (st.idleT > 0.25 && (dd > STEP.settleThr || yawErr > 0.12)) u = 1;
    }
    if (u >= 1 && !(f.lastStepT > st.t - 0.06)) {
      // ronda 4, juego de pies de pelea (st.fight): el segundo pie sigue al primero apenas éste pasó la mitad del vuelo (paso-arrastre de boxeo)
      if (anySwing && dd < STEP.force && !(st.fight && feet[1 - i].swing && feet[1 - i].swing.s > 0.3)) continue;
      // preferir alternar: el pie que no dio el último paso gana a igual urgencia
      let ue = u; if (feet[1 - i].lastStepT > f.lastStepT) ue *= 1.15;
      // de pelea: sale primero el pie del lado hacia donde se mueve (adelante => el de adelante; atrás => el de atrás; lateral => el de ese lado)
      if (st.fight && moving && !anySwing) { const ox = hw[i].x - root[0], oz = hw[i].z - root[2]; if (ox * st.vel[0] + oz * st.vel[1] > 0) ue *= 1.6; }
      if (ue > bestU) { bestU = ue; best = i; }
    }
  }
  if (best >= 0) {
    const f = feet[best];
    const h = hw[best];
    // aterriza donde estará su "home" al final del paso (home actual + movimiento del cuerpo durante el vuelo)
    // de pelea los desplazamientos son ráfagas de ~0.1 s (stepIn/stepOut): el pie cae casi en su home (shuffle) en vez de una zancada adelantada
    const lead = !moving ? 0 : st.fight ? Math.min(st.speed * 0.03, 0.06) : Math.min(st.speed * STEP.dur * 1.5, 0.8);   // movimiento del cuerpo durante el vuelo + media zancada por delante
    let tx = h.x + (moving ? st.vel[0] / st.speed : 0) * lead;
    let tz = h.z + (moving ? st.vel[1] / st.speed : 0) * lead;
    const yaw1 = h.yaw;
    const rf = relaxFoot(top, tx, tz, yaw1, f.sole); tx = rf.x; tz = rf.z; const y1 = rf.y;
    f.lastStepT = st.t;
    startSwing(f, top, [tx, y1, tz], yaw1, st.fight ? { fight: true } : undefined);
    events.push({ type: 'liftoff', foot: f.side, from: f.swing.from.slice(), to: [tx, y1, tz] });
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
