// animator3d.js — animador 3D de un humanoide: lee SOLO la raíz del sim (pos + yaw) y produce un Skeleton3D del contrato.
//
// CONTRATO (alineado con src/shared/contracts.js, v0.2 acordado): METROS, Y arriba, adelante local = +X, derecha = +Z.
//   skeleton = { bones: HUMAN_BONES (17), parent: {hueso:padre|null}, root:{pos,yaw}, pose:{hueso:[x,y,z] MUNDO},
//                tips:{headTop,handL,handR,toeL,toeR}  (extra: puntas para dibujar/golpear) }
//   - skeleton.root es EXACTAMENTE la raíz que entrega el sim (se copia, nunca se modifica por la animación: sin root motion).
//   - yaw con la convención de three.js (rotation.y): dir adelante = (cos yaw, 0, -sin yaw); yaw 0 mira +X.
//   - El rumbo VISUAL (el que orienta el cuerpo) sigue al yaw del sim con un resorte críticamente amortiguado; si el salto es
//     grande, los pies dan pasos de pivote. El sim puede saltar de rumbo sin que el cuerpo "pope".
// Internamente se trabaja en un marco (+Z adelante, +X izquierda) y se convierte al exportar: mundo = (z_i, y, -x_i).
import { HUMAN_BONES_LOCAL, HUMAN_PARENT } from './bones.js';
import { createHumanoid3D, solveRig, DIM, STAND_PELVIS_Y } from './skeleton3d.js';
import { makeTopSampler, createFoot, initFeet, updateFeet, capHeightForFoot, wrapPi, footprintTop } from './footplacement.js';
import { GUARD, CHANNELS, makeChannels, makeIdleParams, idleLayer, walkLayer, addClip, phaseAt, CLIPS, BLOCK_POSE } from './clips.js';
import { ZONE_CLIP } from './reactions.js';
import { planClimb, buildClimb, sampleClimb, wallToXZ, xzToWall, climbPathAt, CLIMB_T } from './climb.js';
import { createRng } from '../shared/rng.js';
import { clamp, smoothstep, smin, spring, springCritical, lerp, qRot, qFromYPR } from './math3.js';

export const BLOCK_M_DEFAULT = 0.5;
export const yawToDir = (yaw, out = [0, 0, 0]) => { out[0] = Math.cos(yaw); out[1] = 0; out[2] = -Math.sin(yaw); return out; };
export const dirToYaw = (x, z) => Math.atan2(-z, x);
const toW = (p, o) => { o[0] = p[2]; o[1] = p[1]; o[2] = -p[0]; return o; };           // interno -> mundo
const rootYawW = (y) => y;
const smooth01 = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const BALL = 0.16;                                                                         // bola del pie respecto del tobillo (m)
const HIP_GUARD = 0.72, HIP_WALK = 0.79;                                                  // altura cadera sobre tobillo

// ---- piernas por FK (ronda 4, KO "peso muerto"): ángulos de cadera/rodilla en el marco de la PELVIS en vez de IK a los pies plantados.
// Se mezcla con kw: tobillo = lerp(tobillo IK, tobillo FK), polo = dirección FK de la rodilla (la IK reproduce la rodilla FK exacta con kw = 1).
const _fq = [0, 0, 0, 1];
function fkLegs(r, c, yaw, kw, ground) {
  const qPel = qFromYPR(yaw + c.hipYaw, c.hipPitch, c.hipRoll, _fq), P = r.pelvisPos;
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    const L = r.legs[s], kH = c['kH' + s], kK = c['kK' + s], kA = c['kA' + s];
    const hip = qRot(qPel, [sx * DIM.hipHalf, 0, 0]); hip[0] += P[0]; hip[1] += P[1]; hip[2] += P[2];
    const ca = Math.cos(kA), sa = sx * Math.sin(kA);
    const th = qRot(qPel, [sa, -ca * Math.cos(kH), ca * Math.sin(kH)]), sh = qRot(qPel, [sa, -ca * Math.cos(kH - kK), ca * Math.sin(kH - kK)]);
    const knee = [hip[0] + th[0] * DIM.thigh, hip[1] + th[1] * DIM.thigh, hip[2] + th[2] * DIM.thigh];
    const ank = [knee[0] + sh[0] * DIM.shin, knee[1] + sh[1] * DIM.shin, knee[2] + sh[2] * DIM.shin];
    for (let k = 0; k < 3; k++) { L.ankle[k] += (ank[k] - L.ankle[k]) * kw; L.pole[k] += (th[k] * 1.5 - L.pole[k]) * kw; }
    // pie: kF = 0 plano en el suelo (como plantado), kF = 1 apuntando atrás a lo largo de la tibia, apoyado sobre el empeine (+0.35 rad hacia arriba).
    // Se gira por ARRIBA (punta hacia arriba, cabeceo 0 -> +π): la punta nunca entra en el suelo al pasar; y se limita a no bajar del suelo.
    const fw = Math.sin(yaw + c.hipYaw) * sh[0] + Math.cos(yaw + c.hipYaw) * sh[2];
    let a = Math.atan2(sh[1], fw); if (a > Math.PI / 2) a -= 2 * Math.PI;
    let pf = (a - 0.35 + 2 * Math.PI) * c['kF' + s];
    const room = (L.ankle[1] - ground - 0.01) / DIM.foot;                  // cabeceo mínimo para que la punta quede sobre el suelo
    if (room < 1 && Math.sin(pf) < -room) pf = Math.cos(pf) >= 0 ? -Math.asin(Math.max(-1, room)) : Math.PI + Math.asin(Math.max(-1, room));
    L.footPitch += (pf - L.footPitch) * kw; L.footYaw += wrapPi(yaw + c.hipYaw - L.footYaw) * kw;
  }
}

export function createAnimator3D(opts = {}) {
  const blockM = opts.blockM || BLOCK_M_DEFAULT;
  const getBlock = opts.getBlock || (() => false);
  const rng = createRng(opts.seed ?? 1);
  const top = makeTopSampler(opts.getBlock ? getBlock : (x, y, z) => y < 0, blockM);   // sin getBlock: suelo plano y=0
  const rig = createHumanoid3D();
  const idleP = makeIdleParams(rng.next);
  const turnOmega = opts.turnOmega ?? 7;

  const skeleton = {
    bones: HUMAN_BONES_LOCAL.slice(), parent: { ...HUMAN_PARENT },
    root: { pos: [0, 0, 0], yaw: 0 },
    pose: {}, tips: { headTop: [0, 0, 0], face: [0, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], toeL: [0, 0, 0], toeR: [0, 0, 0] },
  };
  for (const b of skeleton.bones) skeleton.pose[b] = [0, 0, 0];

  const A = {
    skeleton, rig, t: 0, inited: false, events: [],
    feet: [createFoot('L'), createFoot('R')],
    eff: [0, 1].map(() => ({ pos: [0, 0, 0], sole: 0, yaw: 0, pitch: 0, planted: true, ball: false, contact: [0, 0, 0] })),   // pies efectivos = plantados + override del clip
    ch: makeChannels(GUARD),
    visYaw: 0, yawSp: spring(0), vel: [0, 0], lastRoot: [0, 0], walkAmt: 0, idleT: 0, pelvisY: 0, lastPelvis: [0, 0.8, 0], climbC: null, climbInfo: null, pelvisSp: spring(0), gate: spring(0),
    clip: null, clipT: 0, strike: { active: false, phase: 'none', t: 0, impactT: 0, fist: [0, 0, 0], name: '', phase01: 0, tip: 'L' },
    diag: { maxFootErr: 0, clamped: 0 },
  };
  const _root = [0, 0, 0];
  const swingEnv = (f) => (f.planted ? 0 : Math.sin(Math.PI * clamp(f.swing.s, 0, 1)));

  // ---- reloj de clips (sincronía con la sim).  A.clip = clip activo; A.clipT = tiempo DEL CLIP (s de clip, no de pared).
  //   play(name)                           tiempo real, 1x (compatible).  Devuelve false si ya hay un clip activo (salvo opts.force).
  //   play(name,{speed})                   speed>1 = más rápido.
  //   play(name,{duration})                el clip entero dura `duration` s (velocidad uniforme).
  //   play(name,{impactIn, duration})      deformación del tiempo: el IMPACTO del clip cae a `impactIn` s y el clip termina a `duration` s
  //                                        (típico: impactIn = windupSeconds de la sim, duration = windup+active+recovery).
  //   play(name,{phase:0..1})              arranca desde esa fase del clip.
  //   playAt(name, phase01 [, simImpact01]) modo CONDUCIDO: la sim da la fase cada frame (0..1 del movimiento de la sim);
  //                                        con simImpact01 (fracción de la sim donde cae el impacto) la fase se deforma para que el
  //                                        impacto del clip coincida. Al llegar a 1 el clip termina solo. Si la sim interrumpe: cancel().
  //   cancel(fade=0.12)                    corta el clip con fundido (reacciones/stun).   clipInfo(name?) -> duración, impacto, fases.
  A.fade = null;
  A.clipMode = { name: '', speed: 1, map: null, driven: false, cutAt: 0 };
  const startClip = (name, o) => {
    const clip = CLIPS[name]; if (!clip) return false;
    if (A.clip && !o.force) return false;
    if (A.clip && o.force && clip.from !== A.clipMode.name) A.fade = { clip: A.clip, t: A.clipT, w: 1, rate: 1 / 0.08, h: A.clipMode.holding ? A.clipMode.holdT : -1 };
    A.clip = clip; A.clipT = clamp(o.phase ?? 0, 0, 1) * clip.duration;
    const m = A.clipMode; m.name = name; m.driven = !!o.driven; m.map = null; m.speed = o.speed > 0 ? o.speed : 1;
    if (o.duration > 0) {
      if (o.impactIn > 0 && o.impactIn < o.duration) m.map = { ti: o.impactIn, tt: o.duration };
      else m.speed *= clip.duration / o.duration;
    }
    m.stale = 0; m.prev = A.clipT; m.holding = false; m.holdT = 0; m.amp = o.amp > 0 ? o.amp : 1;
    A.climbC = null;
    if (clip.climb) {                                                  // trepar: detectar saliente y anclar manos/pies/pelvis en el mundo
      const O = [_root[0], _root[2]], y0 = _root[1], yw = A.visYaw;
      const info = planClimb(top, _root, yw, o.ledge || {});
      const loc = (i) => { const e = A.eff[i], uv = xzToWall(O, yw, e.pos[0], e.pos[2]); return [uv[0], e.sole - y0, uv[1], e.yaw - yw]; };
      const pu = xzToWall(O, yw, A.lastPelvis[0], A.lastPelvis[2]);
      A.climbC = buildClimb(info, { pelvis: [pu[0], A.lastPelvis[1] - y0, pu[1]], footL: loc(0), footR: loc(1) });
      A.climbC.O = O; A.climbC.y0 = y0; A.climbC.yaw = yw;
      A.climbInfo = { dist: info.dist, height: info.height, duration: CLIMB_T, startRoot: toW(_root, [0, 0, 0]), yaw: rootYawW(yw), endFwd: info.dist + 0.35 };
    }
    return true;
  };
  A.play = (name, opts = {}) => startClip(name, opts);
  A.playAt = (name, phase01, simImpact01) => {
    const clip = CLIPS[name]; if (!clip) return false;
    const m = A.clipMode;
    if (!A.clip || m.name !== name || !m.driven) { if (!startClip(name, { driven: true, force: true })) return false; }
    let p = clamp(phase01, 0, 1);
    if (simImpact01 > 0 && simImpact01 < 1) {
      const pi = clip.impactT / clip.duration;
      p = p <= simImpact01 ? (p / simImpact01) * pi : pi + ((p - simImpact01) / (1 - simImpact01)) * (1 - pi);
    }
    A.clipT = p * clip.duration; m.cutAt = p >= 1 ? 1 : 0; m.stale = 0;
    return true;
  };
  // nivel de guardia 0..1 (1 = bloqueo alto): sostenido mientras la sim lo pida, con resorte (≈0.08 s). Se suma bajo los clips.
  A.guard = { target: 0, sp: { x: 0, v: 0 } };
  A.setGuardLevel = (l) => { A.guard.target = clamp(+l || 0, 0, 1); };
  A.cancel = (fade = 0.15) => { if (!A.clip) return false; A.fade = { clip: A.clip, t: A.clipT, w: 1, rate: 1 / Math.max(fade, 1e-3), h: A.clipMode.holding ? A.clipMode.holdT : -1 }; A.clip = null; return true; };

  // ---- reacciones y estados (zona del golpe, aturdido, KO, levantarse)
  //   react(zone,{power})   zone = 'head'|'body'|'legs'  (state.hurt.zone de la sim). Corta lo que haya con fundido de 80 ms. power ∈ (0..1.5] escala la pose.
  //   setState(state)       lee el state del peleador de la sim (state.hurt, rocked, stance down|ko, guard) y dispara/sostiene el clip correcto cada frame:
  //                         hurt nuevo -> hurt_<zona>; rocked -> 'rocked' sostenido; down/ko -> 'ko' (cae y queda); al salir de down/ko -> 'getUp'; guard -> setGuardLevel.
  A.react = (zone, o = {}) => { const n = ZONE_CLIP[zone] || 'hurt_body'; return startClip(n, { force: true, amp: clamp(o.power ?? 1, 0.2, 1.5) }); };
  A.lying = false; A.hurtSeen = null;
  A.setState = (st) => {
    if (!st) return;
    if (st.guard !== undefined) A.setGuardLevel(st.guard);
    const wantLying = st.ko === true || st.down === true || st.stance === 'ko' || st.stance === 'down';
    const name = A.clip ? A.clipMode.name : '';
    if (wantLying) {
      if (!A.lying) { A.lying = true; startClip('ko', { force: true }); }
      return;
    }
    if (A.lying) { A.lying = false; startClip('getUp', { force: true }); return; }
    if (st.hurt && (A.hurtSeen === null || st.hurt.age < A.hurtSeen - 1e-6)) A.react(st.hurt.zone, { power: st.hurt.power });
    A.hurtSeen = st.hurt ? st.hurt.age : null;
    if (st.rocked) { if (!A.clip) startClip('rocked', { force: true }); }
    else if (name === 'rocked') A.cancel(0.3);
  };
  A.clipInfo = (name) => {
    const clip = CLIPS[name ?? A.clipMode.name]; if (!clip) return null;
    const d = clip.duration, a = clip.phases.find((q) => q.name === 'strike') || clip.phases[1];
    return { name: clip.name, duration: d, impactT: clip.impactT, impact01: clip.impactT / d, active01: [a.t0 / d, a.t1 / d], tip: clip.tip || 'L' };
  };

  function reset(rootW) {
    _root[0] = -rootW.pos[2]; _root[1] = rootW.pos[1]; _root[2] = rootW.pos[0];
    A.visYaw = rootW.yaw; A.yawSp.x = 0; A.yawSp.v = 0; A.lastRoot[0] = _root[0]; A.lastRoot[1] = _root[2];
    A.vel[0] = A.vel[1] = 0; A.walkAmt = 0;
    initFeet(A.feet, top, _root, A.visYaw, 0);
    const y = Math.min(A.feet[0].sole, A.feet[1].sole) + DIM.ankleH + HIP_GUARD;
    A.pelvisY = y; A.pelvisSp.x = y; A.pelvisSp.v = 0; A.inited = true;
  }

  // dt en segundos; rootW = {pos:[x,y,z], yaw} del sim (solo lectura).
  A.update = (dt, rootW) => {
    const ev = A.events; ev.length = 0;
    if (!A.inited || Math.hypot(rootW.pos[0] - A.lastRoot[1], rootW.pos[2] + A.lastRoot[0]) > 3) reset(rootW);
    A.t += dt;
    // ---- entrada: raíz interna (marco +Z adelante, +X izquierda)
    _root[0] = -rootW.pos[2]; _root[1] = rootW.pos[1]; _root[2] = rootW.pos[0];
    // velocidad (suavizada) por diferencia de raíz
    const k = 1 - Math.exp(-dt * 12);
    A.vel[0] += ((_root[0] - A.lastRoot[0]) / dt - A.vel[0]) * k; A.vel[1] += ((_root[2] - A.lastRoot[1]) / dt - A.vel[1]) * k;
    A.lastRoot[0] = _root[0]; A.lastRoot[1] = _root[2];
    const speed = Math.hypot(A.vel[0], A.vel[1]);
    // rumbo visual: resorte crítico sobre el error angular (el sim puede saltar)
    A.yawSp.x = wrapPi(A.visYaw - rootW.yaw);
    springCritical(A.yawSp, 0, turnOmega, dt);
    A.visYaw = rootW.yaw + A.yawSp.x;
    const yaw = A.visYaw;
    // modo de locomoción
    const wTarget = clamp(speed / 0.5, 0, 1);
    A.walkAmt += (wTarget - A.walkAmt) * (1 - Math.exp(-dt * 8));
    const turning = Math.abs(A.yawSp.x) > 0.08 || Math.abs(A.yawSp.v) > 0.3;
    A.idleT = (speed > 0.08 || turning) ? 0 : A.idleT + dt;
    // ---- pies
    const CLm = A.clip && A.clip.climb && A.climbC ? A.climbC : null;
    if (CLm) { A.walkAmt = 0; A.vel[0] = A.vel[1] = 0; }
    if (CLm && A.clipT > 1.40) initFeet(A.feet, top, _root, yaw, 0);   // salida: pies de reposo sobre la raíz (el sim ya la subió al saliente)
    if (!CLm) updateFeet(A.feet, top, _root, yaw, { t: A.t, vel: A.vel, speed, walkAmt: A.walkAmt, idleT: A.idleT, freeze: !!(A.clip && A.clip.feet && A.walkAmt < 0.3) }, dt, ev);
    const [fL, fR] = A.feet;
    // ---- canales: guardia + idle + caminar + clips
    const c = A.ch; for (const n of CHANNELS) c[n] = GUARD[n];
    idleLayer(A.t, idleP, 1 - 0.7 * A.walkAmt, c);
    springCritical(A.gate, swingEnv(fL) - swingEnv(fR), 16, dt);
    const fwdSpeed = A.vel[0] * Math.sin(yaw) + A.vel[1] * Math.cos(yaw);
    walkLayer(A.gate.x, A.walkAmt, fwdSpeed, c);
    springCritical(A.guard.sp, A.guard.target, 22, dt);
    if (A.guard.sp.x > 1e-4) { const g = clamp(A.guard.sp.x, 0, 1.05); for (const n in BLOCK_POSE) c[n] += BLOCK_POSE[n] * g; }
    const S = A.strike; S.active = false; S.phase = 'none';
    if (A.fade) {
      A.fade.w -= dt * A.fade.rate; if (A.fade.w <= 0) A.fade = null; else { const fw = A.fade.w * A.fade.w * (3 - 2 * A.fade.w); addClip(A.fade.clip, A.fade.t, fw, c); if (A.fade.h >= 0 && A.fade.clip.holdLayer) { A.fade.h += dt; const tmp = makeChannels(); A.fade.clip.holdLayer(A.fade.h, tmp); for (const n of CHANNELS) c[n] += fw * tmp[n]; } }
    }
    if (A.clip) {
      const m = A.clipMode, clip = A.clip, tPrev = m.prev;
      if (m.driven) { if ((m.stale += dt) > 0.25) { A.cancel(0.12); ev.push({ type: 'clipEnd', name: m.name, stale: true }); } }   // la sim dejó de conducirlo
      else {
        let rate = m.speed;
        if (m.map) rate = m.speed * (A.clipT < clip.impactT ? clip.impactT / m.map.ti : (clip.duration - clip.impactT) / (m.map.tt - m.map.ti));
        A.clipT += dt * rate;
      }
      m.prev = A.clipT;
      if (tPrev < clip.impactT && A.clipT >= clip.impactT) ev.push({ type: 'impact', name: m.name, tip: clip.tip || 'L' });
      if (clip.hold && A.clipT >= clip.duration) {                    // clip SOSTENIDO (rocked, ko): se queda en la última pose hasta otro play/cancel
        if (!m.holding) { m.holding = true; m.holdT = 0; ev.push({ type: 'clipHold', name: m.name }); }
        A.clipT = clip.duration; m.holdT += dt; addClip(clip, clip.duration, 1, c); if (clip.holdLayer) clip.holdLayer(m.holdT, c);
        S.phase = 'hold'; S.t = clip.duration; S.impactT = clip.impactT; S.name = m.name; S.phase01 = 1; S.tip = clip.tip || 'L';
      } else if (A.clipT >= clip.duration || (m.driven && m.cutAt)) { addClip(clip, clip.duration, 1, c); A.clip = null; ev.push({ type: 'clipEnd', name: m.name }); }
      else {
        addClip(clip, A.clipT, m.amp ?? 1, c);
        S.phase = phaseAt(clip, A.clipT); S.t = A.clipT; S.impactT = clip.impactT; S.name = m.name; S.phase01 = A.clipT / clip.duration; S.tip = clip.tip || 'L';
        S.active = A.clipT >= clip.phases[1].t0 && A.clipT <= clip.phases[1].t1;
      }
    }
    // ---- altura de pelvis
    const sf = Math.sin(yaw), cf = Math.cos(yaw);                       // adelante visual (marco interno)
    const px = _root[0] + c.px * cf + c.pz * sf, pz = _root[2] - c.px * sf + c.pz * cf;
    const wf = clamp(1 - A.walkAmt * 1.5, 0, 1);                        // los clips de pies solo mandan con el cuerpo quieto
    const eff = A.eff;
    for (let i = 0; i < 2; i++) {
      const f = A.feet[i], s = i ? 'R' : 'L', e = eff[i];
      const ox = c['f' + s + 'x'] * wf, oy = c['f' + s + 'y'] * wf, oz = c['f' + s + 'z'] * wf, dyaw = c['f' + s + 'yaw'] * wf, dp = c['f' + s + 'pitch'] * wf;
      e.yaw = f.yaw + dyaw; e.pitch = f.pitch + dp; e.ball = !!(A.clip?.ball?.[s] || A.fade?.clip?.ball?.[s]);
      const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
      if (e.ball && (Math.abs(dyaw) > 1e-4 || dp < -1e-4)) {                       // pivote sobre la bola del pie: la bola queda clavada, el talón gira/sube
        const gx = f.pos[0] + ox * cf + oz * sf, gz = f.pos[2] - ox * sf + oz * cf;
        const bx = gx + fx * BALL, bz = gz + fz * BALL, heel = Math.max(0, -dp);
        e.pos[0] = bx - Math.sin(e.yaw) * BALL * Math.cos(heel); e.pos[2] = bz - Math.cos(e.yaw) * BALL * Math.cos(heel);
        e.sole = f.sole + BALL * Math.sin(heel) + oy; e.contact[0] = bx; e.contact[1] = f.sole; e.contact[2] = bz;
        e.planted = f.planted && oy < 0.006;
      } else {
        e.pos[0] = f.pos[0] + ox * cf + oz * sf; e.pos[2] = f.pos[2] - ox * sf + oz * cf; e.sole = f.sole + oy;
        if (Math.abs(ox) + Math.abs(oz) > 1e-5) e.sole = Math.max(e.sole, footprintTop(top, e.pos[0], e.pos[2], e.yaw, f.sole + 0.3, 0));
        e.contact[0] = e.pos[0] + Math.sin(e.yaw) * BALL; e.contact[1] = e.sole; e.contact[2] = e.pos[2] + Math.cos(e.yaw) * BALL;   // punto de la bola del pie
        e.planted = f.planted && e.sole - f.sole < 0.006 && Math.abs(dp) < 0.02;
      }
    }
    // ---- trepar: pies anclados al saliente (mezcla con los pies normales al entrar/salir)
    let CS = null;
    if (CLm) {
      CS = sampleClimb(CLm, A.clipT); const Oc = CLm.O, yc = CLm.yaw, y0c = CLm.y0;
      for (let i = 0; i < 2; i++) {
        const e = eff[i], row = i ? CS.fR : CS.fL, xz = wallToXZ(Oc, yc, row[0], row[2]), w = CS.wF;
        e.pos[0] += (xz[0] - e.pos[0]) * w; e.pos[2] += (xz[1] - e.pos[2]) * w; e.sole += (y0c + row[1] - DIM.ankleH - e.sole) * w;
        e.pitch += (row[3] - e.pitch) * w; e.yaw += wrapPi((yc + (i ? CLm.yawR : CLm.yawL)) - e.yaw) * w;
        e.planted = w < 0.01; e.ball = false;
        e.contact[0] = e.pos[0] + Math.sin(e.yaw) * BALL; e.contact[1] = e.sole; e.contact[2] = e.pos[2] + Math.cos(e.yaw) * BALL;
      }
    }
    const ankles = eff.map((e) => [e.pos[0], e.sole + DIM.ankleH, e.pos[2]]);
    const lowest = Math.min(ankles[0][1], ankles[1][1]);
    const hipAbove = lerp(HIP_GUARD, HIP_WALK, A.walkAmt);
    if (CS) { A.pelvisSp.x = lowest + hipAbove; A.pelvisSp.v = 0; } else springCritical(A.pelvisSp, lowest + hipAbove, 10, dt);
    let py = A.pelvisSp.x + c.dy, qx = px, qz = pz;
    if (CS) {                                                          // pelvis anclada a la pared (mezcla con la pelvis normal)
      const xz = wallToXZ(CLm.O, CLm.yaw, CS.pel[0], CS.pel[2]), w = CS.wP;
      qx = px + (xz[0] - px) * w; qz = pz + (xz[1] - pz) * w; py += (CLm.y0 + CS.pel[1] - py) * w;
    }
    const hips = [[qx + DIM.hipHalf * cf, qz - DIM.hipHalf * sf], [qx - DIM.hipHalf * cf, qz + DIM.hipHalf * sf]];
    const pyFree = py, kw = clamp(c.kw, 0, 1);
    for (let i = 0; i < 2; i++) py = smin(py, capHeightForFoot(hips[i], ankles[i]), 0.06);
    if (kw > 1e-4) py += (pyFree - py) * kw;                           // piernas por FK (KO): los pies ya no sostienen la pelvis
    A.lastPelvis[0] = qx; A.lastPelvis[1] = py; A.lastPelvis[2] = qz;
    A.pelvisY = py;
    // ---- rig
    const armPole = (sx, elb, elv) => [sx * (0.45 + 2.5 * elb), -1 + 2 * elv, -0.15];
    // polo de rodilla: hacia adelante (dirección del pie); si el tobillo queda a la altura de la cadera o por encima, la rodilla sube.
    // La mezcla es continua en la elevación del eje cadera->tobillo, así que la rodilla no puede invertirse ni saltar.
    const legPole = (f, i) => {
      const hx = hips[i][0], hz = hips[i][1], ax = f.pos[0] - hx, ay = f.sole + DIM.ankleH - py, az = f.pos[2] - hz;
      const e = ay / (Math.hypot(ax, ay, az) || 1);                    // -1 abajo ... +1 arriba
      const s = smoothstep(clamp((e + 0.35) / 0.9, 0, 1));
      return [Math.sin(f.yaw) * (1 - s), s * 1.0 + 0.05, Math.cos(f.yaw) * (1 - s)];
    };
    const r = {
      root: { pos: [_root[0], _root[1], _root[2]], yaw },
      pelvisPos: [qx, py, qz],
      hipYaw: c.hipYaw, hipPitch: c.hipPitch, hipRoll: c.hipRoll, spYaw: c.spYaw, spPitch: c.spPitch, spRoll: c.spRoll,
      hdYaw: c.hdYaw, hdPitch: c.hdPitch, hdRoll: c.hdRoll,
      arms: {
        L: { rel: [c.hLx, c.hLy, c.hLz], pole: armPole(1, c.elbL, c.elvL), shrug: c.shrugL, prot: c.protL, poleFace: [c.pLx, c.pLy, c.pLz], poleW: c.pLw },
        R: { rel: [c.hRx, c.hRy, c.hRz], pole: armPole(-1, c.elbR, c.elvR), shrug: c.shrugR, prot: c.protR, poleFace: [c.pRx, c.pRy, c.pRz], poleW: c.pRw },
      },
      legs: {
        L: { ankle: ankles[0], pole: legPole(eff[0], 0), footYaw: eff[0].yaw, footPitch: eff[0].pitch },
        R: { ankle: ankles[1], pole: legPole(eff[1], 1), footYaw: eff[1].yaw, footPitch: eff[1].pitch },
      },
    };
    if (kw > 1e-4) fkLegs(r, c, yaw, kw, Math.min(eff[0].sole, eff[1].sole));
    solveRig(rig, r);
    if (CS && CS.wH > 1e-3) {                                          // manos ancladas al borde (2.ª pasada: el blend parte de la muñeca normal)
      for (const [s, row] of [['L', CS.hL], ['R', CS.hR]]) {
        const nw = rig.pose['forearm' + s].t, xz = wallToXZ(CLm.O, CLm.yaw, row[0], row[2]), w = CS.wH;
        r.arms[s].rel = null; const wr = [nw[0] + (xz[0] - nw[0]) * w, nw[1] + (CLm.y0 + row[1] - nw[1]) * w, nw[2] + (xz[1] - nw[2]) * w];
        r.arms[s].wrist = wr;
        // codo: abierto hacia fuera mientras el brazo cuelga/apunta abajo (polo normal = abajo → degenerado), vuelve al polo de guardia al subir la mano
        const sh = rig.pose['shoulder' + s].t, ay = (wr[1] - sh[1]) / (Math.hypot(wr[0] - sh[0], wr[1] - sh[1], wr[2] - sh[2]) || 1);
        const kp = 1 - w * (1 - smooth01((ay + 1.3) / 2.6)), np = r.arms[s].pole, sx = s === 'L' ? 1 : -1, fl = [sx * 0.6, -0.5, -0.9];
        r.arms[s].pole = [fl[0] + (np[0] - fl[0]) * kp, fl[1] + (np[1] - fl[1]) * kp, fl[2] + (np[2] - fl[2]) * kp];
      }
      solveRig(rig, r);
    }
    // ---- exportar (marco mundo del contrato)
    skeleton.root.pos[0] = rootW.pos[0]; skeleton.root.pos[1] = rootW.pos[1]; skeleton.root.pos[2] = rootW.pos[2]; skeleton.root.yaw = rootW.yaw;
    skeleton.visualYaw = yaw;
    const P = rig.pose, O = skeleton.pose;
    toW(P.pelvis.p, O.pelvis); toW(P.spine.p, O.spine); toW(P.chest.p, O.chest); toW(P.neck.p, O.neck); toW(P.head.p, O.head);
    for (const s of ['L', 'R']) {
      toW(P['shoulder' + s].t, O['shoulder' + s]); toW(P['upperArm' + s].t, O['elbow' + s]); toW(P['forearm' + s].t, O['hand' + s]);
      toW(P['thigh' + s].p, O['hip' + s]); toW(P['thigh' + s].t, O['knee' + s]); toW(P['shin' + s].t, O['foot' + s]);
      toW(P['hand' + s].t, skeleton.tips['hand' + s]); toW(P['foot' + s].t, skeleton.tips['toe' + s]);
    }
    toW(P.head.t, skeleton.tips.headTop);
    { const hc = qRot(P.head.q, [0, DIM.head * 0.55, 0.11]); toW([P.head.p[0] + hc[0], P.head.p[1] + hc[1], P.head.p[2] + hc[2]], skeleton.tips.face); }
    if (S.tip === 'kickR') { const k = P.shinR, a = P.shinR.t; toW([a[0] + (k.p[0] - a[0]) * 0.3, a[1] + (k.p[1] - a[1]) * 0.3, a[2] + (k.p[2] - a[2]) * 0.3], S.fist); }
    else toW(P['hand' + (S.tip || 'L')].t, S.fist);
    A.diag.clamped = (rig.diag.legReachedL && rig.diag.legReachedR) ? 0 : 1;
    return skeleton;
  };
  // Posiciones MUNDO de las plantas de pie (para tests/visores): { L:{planted,pos:[x,y,z]}, R:{...} }
  A.feetWorld = () => A.eff.map((e, i) => ({ side: A.feet[i].side, planted: e.planted, pos: toW([e.pos[0], e.sole, e.pos[2]], [0, 0, 0]), contact: toW(e.contact, [0, 0, 0]), yaw: e.yaw, pitch: e.pitch, ball: e.ball }));
  return A;
}
