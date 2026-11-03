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
import { makeTopSampler, createFoot, initFeet, updateFeet, capHeightForFoot, wrapPi } from './footplacement.js';
import { GUARD, CHANNELS, makeChannels, makeIdleParams, idleLayer, walkLayer, addClip, phaseAt, CLIPS } from './clips.js';
import { createRng } from '../shared/rng.js';
import { clamp, smoothstep, smin, spring, springCritical, lerp, qRot } from './math3.js';

export const BLOCK_M_DEFAULT = 0.5;
export const yawToDir = (yaw, out = [0, 0, 0]) => { out[0] = Math.cos(yaw); out[1] = 0; out[2] = -Math.sin(yaw); return out; };
export const dirToYaw = (x, z) => Math.atan2(-z, x);
const toW = (p, o) => { o[0] = p[2]; o[1] = p[1]; o[2] = -p[0]; return o; };           // interno -> mundo
const HIP_GUARD = 0.77, HIP_WALK = 0.80;                                                  // altura cadera sobre tobillo

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
    ch: makeChannels(GUARD),
    visYaw: 0, yawSp: spring(0), vel: [0, 0], lastRoot: [0, 0], walkAmt: 0, idleT: 0, pelvisY: 0, pelvisSp: spring(0), gate: spring(0),
    clip: null, clipT: 0, strike: { active: false, phase: 'none', t: 0, impactT: 0, fist: [0, 0, 0] },
    diag: { maxFootErr: 0, clamped: 0 },
  };
  const _root = [0, 0, 0];
  const swingEnv = (f) => (f.planted ? 0 : Math.sin(Math.PI * clamp(f.swing.s, 0, 1)));

  A.play = (name) => { if (A.clip) return false; A.clip = CLIPS[name]; A.clipT = 0; return !!A.clip; };

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
    updateFeet(A.feet, top, _root, yaw, { t: A.t, vel: A.vel, speed, walkAmt: A.walkAmt, idleT: A.idleT }, dt, ev);
    const [fL, fR] = A.feet;
    // ---- canales: guardia + idle + caminar + clips
    const c = A.ch; for (const n of CHANNELS) c[n] = GUARD[n];
    idleLayer(A.t, idleP, 1 - 0.7 * A.walkAmt, c);
    springCritical(A.gate, swingEnv(fL) - swingEnv(fR), 16, dt);
    const fwdSpeed = A.vel[0] * Math.sin(yaw) + A.vel[1] * Math.cos(yaw);
    walkLayer(A.gate.x, A.walkAmt, fwdSpeed, c);
    const S = A.strike; S.active = false; S.phase = 'none';
    if (A.clip) {
      A.clipT += dt;
      if (A.clipT >= A.clip.duration) { addClip(A.clip, A.clip.duration, 1, c); A.clip = null; }
      else {
        addClip(A.clip, A.clipT, 1, c);
        S.phase = phaseAt(A.clip, A.clipT); S.t = A.clipT; S.impactT = A.clip.impactT;
        S.active = A.clipT >= A.clip.phases[1].t0 && A.clipT <= A.clip.phases[1].t1;
      }
    }
    // ---- altura de pelvis
    const sf = Math.sin(yaw), cf = Math.cos(yaw);                       // adelante visual (marco interno)
    const px = _root[0] + c.px * cf + c.pz * sf, pz = _root[2] - c.px * sf + c.pz * cf;
    const ankles = A.feet.map((f) => [f.pos[0], f.sole + DIM.ankleH, f.pos[2]]);
    const lowest = Math.min(ankles[0][1], ankles[1][1]);
    const hipAbove = lerp(HIP_GUARD, HIP_WALK, A.walkAmt);
    springCritical(A.pelvisSp, lowest + hipAbove, 10, dt);
    let py = A.pelvisSp.x + c.dy;
    const hips = [[px + DIM.hipHalf * cf, pz - DIM.hipHalf * sf], [px - DIM.hipHalf * cf, pz + DIM.hipHalf * sf]];
    for (let i = 0; i < 2; i++) py = smin(py, capHeightForFoot(hips[i], ankles[i]), 0.06);
    A.pelvisY = py;
    // ---- rig
    const armPole = (sx, elb) => [sx * (0.45 + 2.5 * elb), -1, -0.15];
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
      pelvisPos: [px, py, pz],
      hipYaw: c.hipYaw, hipPitch: c.hipPitch, hipRoll: c.hipRoll, spYaw: c.spYaw, spPitch: c.spPitch, spRoll: c.spRoll,
      hdYaw: c.hdYaw, hdPitch: c.hdPitch, hdRoll: c.hdRoll,
      arms: {
        L: { rel: [c.hLx, c.hLy, c.hLz], pole: armPole(1, c.elbL), shrug: c.shrugL, prot: c.protL },
        R: { rel: [c.hRx, c.hRy, c.hRz], pole: armPole(-1, c.elbR), shrug: c.shrugR, prot: c.protR },
      },
      legs: {
        L: { ankle: ankles[0], pole: legPole(fL, 0), footYaw: fL.yaw, footPitch: fL.pitch },
        R: { ankle: ankles[1], pole: legPole(fR, 1), footYaw: fR.yaw, footPitch: fR.pitch },
      },
    };
    solveRig(rig, r);
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
    toW(P.handL.t, S.fist);
    A.diag.clamped = (rig.diag.legReachedL && rig.diag.legReachedR) ? 0 : 1;
    return skeleton;
  };
  // Posiciones MUNDO de las plantas de pie (para tests/visores): { L:{planted,pos:[x,y,z]}, R:{...} }
  A.feetWorld = () => A.feet.map((f) => ({ side: f.side, planted: f.planted, pos: toW([f.pos[0], f.sole, f.pos[2]], [0, 0, 0]), yaw: f.yaw }));
  return A;
}
