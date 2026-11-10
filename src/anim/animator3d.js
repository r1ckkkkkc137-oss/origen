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
import { GUARD, CHANNELS, makeChannels, makeIdleParams, idleLayer, walkLayer, addClip, phaseAt, CLIPS, BLOCK_POSE, HITSTOP, sampleTrack } from './clips.js';
import { ZONE_CLIP } from './reactions.js';
import './kicks.js';
import { GROUND_POSES, GROUND_KEYS, GROUND_MOVE_CLIP } from './ground.js';
import { buildColliders, extrapolate, firstContact, penetration, pushOut, pushIn, sdist, axisU, axisAt, CONTACT, COL, guardIndex } from './contact.js';
import { planClimb, buildClimb, sampleClimb, wallToXZ, xzToWall, climbPathAt, CLIMB_T } from './climb.js';
import { createRng } from '../shared/rng.js';
import { clamp, smoothstep, smin, spring, springCritical, lerp, qRot, qFromYPR } from './math3.js';

export const BLOCK_M_DEFAULT = 0.5;
/** r7: clip propio por move de la sim. Para Motor: createLiveAnimation(live, { clipMap: MOVE_CLIP, ... }) (sin esto el animador remapea igual). */
export const MOVE_CLIP = Object.freeze({ bodyKick: 'bodykick', highKick: 'highkick', ...GROUND_MOVE_CLIP });
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

// punto de [c,d] más cercano al segmento [a,b] (r8)
function closestSegSeg(a, b, c, d) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - c[0], d[1] - c[1], d[2] - c[2]], w = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
  const A = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], B = u[0] * v[0] + u[1] * v[1] + u[2] * v[2], C = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const D = u[0] * w[0] + u[1] * w[1] + u[2] * w[2], E = v[0] * w[0] + v[1] * w[1] + v[2] * w[2], den = A * C - B * B;
  let sN = den > 1e-9 ? (B * E - C * D) / den : 0; sN = clamp(sN, 0, 1);
  let tN = C > 1e-9 ? (B * sN + E) / C : 0; tN = clamp(tN, 0, 1);
  sN = A > 1e-9 ? clamp((tN * B - D) / A, 0, 1) : 0;
  return [c[0] + v[0] * tN, c[1] + v[1] * tN, c[2] + v[2] * tN];
}
/** Enlaza dos animadores como rivales (contacto + distancia de entrada). Devuelve [a, b]. */
export function pairAnimators(a, b) { a.setOpponent(b); b.setOpponent(a); return [a, b]; }
/**
 * Fábrica para `createLiveAnimation(live, { createAnimator3D: pairedAnimatorFactory() })`: liveAnim crea a y b seguidos con esta
 * función; cada par consecutivo queda enlazado (a<->b) sin tocar src/combat. `create` por defecto = createAnimator3D.
 */
export function pairedAnimatorFactory(create = createAnimator3D) {
  let pending = null;
  return (opts) => { const an = create(opts); if (pending) { pairAnimators(pending, an); pending = null; } else pending = an; return an; };
}
export function createAnimator3D(opts = {}) {
  const blockM = opts.blockM || BLOCK_M_DEFAULT;
  const getBlock = opts.getBlock || (() => false);
  const rng = createRng(opts.seed ?? 1);
  const top = makeTopSampler(opts.getBlock ? getBlock : (x, y, z) => y < 0, blockM);   // sin getBlock: suelo plano y=0
  const rig = createHumanoid3D();
  const idleP = makeIdleParams(rng.next);
  const turnOmega = opts.turnOmega ?? 7, turnOmegaFight = opts.turnOmegaFight ?? 10;   // ronda 4: de pelea el giro/circle sigue al rival más rápido

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
  const LAT_CH = ['hdYaw', 'hdRoll', 'spYaw', 'spRoll', 'hipYaw', 'hipRoll', 'px'];
  const latLayer = (clip, t, k, w, wH, out) => { for (const ch of LAT_CH) { const tr = clip.tracks[ch]; if (tr) out[ch] += k * (ch.startsWith('hd') ? wH : w) * sampleTrack(tr, t); } };
  A.rootI = _root; A._kf = 0.3;                                                    // raíz en el marco interno (la lee el rival enlazado)

  // ---- rival enlazado (ronda 6): contacto del golpe + distancia real para la entrada del gancho.
  //   A.setOpponent(B)            B = otro animador 3D (se lee B.skeleton, B.rootI, B.vel) | () => Skeleton3D mundo | null (desenlazar).
  //   pairAnimators(a, b) / pairedAnimatorFactory()  (exports) enlazan los dos lados; liveAnim crea a y b con opt.createAnimator3D.
  //   Orden de update a->b: a lee la pose de b del frame anterior (1/60 s de retraso, despreciable a la escala del golpe).
  A.opp = null;
  A.setOpponent = (o) => { A.opp = o || null; CT.pin = null; return A; };
  const CT = A.contact = { limb: [0, 0, 0], aim: 0, aimX: 0, aimZ: 0, pin: null, d: [0, 0, 0], raw: 0, pen: 0, zone: '', cols: null, rel: 0, dRel: [0, 0, 0], side: 'L', kick: false, last: null };
  A.lastContactIn = null;
  A._onContactIn = (info) => {
    const w = info.point; A.lastContactIn = { ...info, at: A.t, pointI: [-w[2], w[1], w[0]] }; A._pend.push({ type: 'contactIn', ...info });
    // orden b->a: la reacción ya arrancó este frame o el anterior sin saber dónde pegó -> corrige el lado con suavizado (m.latT)
    const m = A.clipMode; if (A.clip && A.clip.name && A.clip.name.startsWith('hurt') && A.clipT < 0.1 && m.zone) m.latT = latFrom(A.lastContactIn, m.zone);
  };
  const latFrom = (ci, zone) => {
    const P = rig.pose, ref = zone === 'legs' ? P.pelvis.p : P.head.p, yw = A.visYaw;
    const side = (ci.pointI[0] - ref[0]) * Math.cos(yw) - (ci.pointI[2] - ref[2]) * Math.sin(yw);   // >0: contacto en mi izquierda
    return (side > 0 ? -1 : 1) * clamp(Math.abs(side) / 0.08, 0.35, 1);
  };
  const oppSkel = () => { const o = A.opp; if (!o) return null; if (typeof o === 'function') return o() || null; return o.inited === false ? null : (o.skeleton || null); };
  const entryFactor = (clip, tLeft) => {                               // 0..kMax: cuánta entrada (paso + pelvis) necesita el gancho
    const e = clip.entry, sk = oppSkel();
    let d = opts.entryDist ?? null;
    if (sk && A.inited) {
      const o = A.opp, ox = -sk.root.pos[2], oz = sk.root.pos[0], dx = ox - _root[0], dz = oz - _root[2], dd = Math.hypot(dx, dz) || 1;
      const close = o && o.vel ? ((o.vel[0] - A.vel[0]) * dx + (o.vel[1] - A.vel[1]) * dz) / dd * Math.max(0, tLeft) : 0;   // cambio previsto hasta el impacto
      const ar = clip.aim;
      if (ar && ar.ref1 && sk.tips && sk.tips.headTop) {
        // con el esqueleto del rival: k tal que la punta libre llegue a la profundidad del CENTRO de su cabeza (el gancho pega en el costado)
        const hb = sk.pose.head, ht = sk.tips.headTop, hx = -(hb[2] + (ht[2] - hb[2]) * 0.55), hz = hb[0] + (ht[0] - hb[0]) * 0.55;
        const fwd = ((hx - _root[0]) * dx + (hz - _root[2]) * dz) / dd + close;
        return clamp((fwd + (e.bias || 0) - ar.ref[2]) / (ar.ref1[2] - ar.ref[2]), e.kMin ?? 0, e.kMax);
      }
      d = dd + close;
    }
    if (d == null) return 1;
    return clamp((d - e.d0) / (e.d1 - e.d0), e.kMin ?? 0, e.kMax);
  };
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
  // ronda 5: jab/cross llegan a 1,0 m (mano ~0,65 m fuera de la guardia): cortar un golpe extendido con menos de 0,14 s daría saltos >15 cm/frame
  const STRIKE_MIN_FADE = 0.14;
  const CONTACT_SKIN = 0.006, AIM_DRIVE = 0.015, AIM_SEEK = 0.15, ARM_REACH = 0.68;   // ARM_REACH: hombro->nudillos con el codo ~150° (brazo 0,31+0,27+0,12)                           // ronda 6: el ajuste mete 1,5 cm (lo para el contacto); busca la zona si el arco pasa a <15 cm
  const REBOUND_RATE = 0.9, REBOUND_BACK = 0.10;                    // r8: rebote de la patada bloqueada (velocidad del clip hacia atrás, cuánto desanda)
  const PIN_FOLLOW = 0.06, PIN_FOLLOW_MAX = 0.06, PIN_FOLLOW_LATE = 0.16;   // r7: aviso de bloqueo tardío -> la mano va al guante más rápido   // la mano acompaña el retroceso como mucho 6 cm (luego se queda: el rival se separa)
                                             // ronda 6: m/frame que la mano clavada sigue al rival que retrocede
  const strikeExtended = () => !!(A.clip && A.clip.tip && A.clip.impactT > 0 && !A.clip.feint && !A.clip.hold && A.clipT > A.clip.impactT * 0.6 && A.clipT < A.clip.duration * 0.6);
  const startClip = (name, o) => {
    const clip = CLIPS[name]; if (!clip) return false;
    if (A.clip && !o.force) return false;
    if (A.clip && o.force && clip.from !== A.clipMode.name) A.fade = { clip: A.clip, t: A.clipT, w: 1, rate: 1 / (strikeExtended() ? STRIKE_MIN_FADE : 0.08), h: A.clipMode.holding ? A.clipMode.holdT : -1, amp: A.clipMode.amp ?? 1, ampH: A.clipMode.ampHead ?? A.clipMode.amp ?? 1, ek: A.clipMode.entryK || 0, lat: A.clipMode.lat };
    A.clip = clip; A.clipT = clamp(o.phase ?? 0, 0, 1) * clip.duration;
    const m = A.clipMode; m.name = name; m.driven = !!o.driven; m.map = null; m.rebound = null; m.speed = o.speed > 0 ? o.speed : 1;
    if (o.duration > 0) {
      if (o.impactIn > 0 && o.impactIn < o.duration) m.map = { ti: o.impactIn, tt: o.duration };
      else m.speed *= clip.duration / o.duration;
    }
    m.stale = 0; m.prev = A.clipT; m.holding = false; m.holdT = 0; m.amp = o.amp > 0 ? o.amp : 1; m.ampHead = o.ampHead > 0 ? o.ampHead : m.amp; m.entryK = clip.entry ? entryFactor(clip, clip.impactT - A.clipT) : 0; m.lat = null; m.latT = null; m.zone = null;
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
  // mientras la sim sostenga una finta de gancho (state.clip 'feint' + move hook) no se vuelve a lanzar el gancho entero (liveAnim lo re-agenda
  // con el actionStart de X.FEINT): el amago no se tira al aire.
  A.feintLock = null; A._pend = [];
  // r7: liveAnim (src/combat) manda 'lowkick' para bodyKick/highKick y 'jab' para los golpes de suelo (kind 'strike'). Con el último
  // state.move se elige el clip propio, deformado en el tiempo para que el impacto caiga donde liveAnim lo agendó (impactT del clip pedido).
  // Con opts.clipMap = MOVE_CLIP (recomendado) liveAnim ya pide el clip propio y no hay deformación.
  const remap = (name, opts) => {
    const st = A.lastSt, mv = st && st.move, req = CLIPS[name];
    let to = null;
    if (name === 'lowkick' && (mv === 'bodyKick' || mv === 'highKick')) to = MOVE_CLIP[mv];
    else if ((name === 'jab' || name === 'cross') && (GROUND_MOVE_CLIP[mv] || (st && st.stance === 'groundTop'))) to = GROUND_MOVE_CLIP[mv] || 'gnp_punch';
    if (!to || !CLIPS[to] || !req || opts.duration) return [name, opts];
    const c = CLIPS[to], ii = req.impactT;
    return [to, { ...opts, impactIn: ii, duration: ii + (c.duration - c.impactT) }];
  };
  A.play = (name, opts = {}) => {
    if (A.feintLock && name === 'hook' && !opts.force) return false;
    if (A.lastSt && A.lastSt.stance === 'groundBottom' && CLIPS[name] && CLIPS[name].tip && !CLIPS[name].ground) { A._lastPlay = null; return false; }   // golpe desde abajo (guardElbow): pendiente
    const [n2, o2] = remap(name, opts), ok = startClip(n2, o2);
    A._lastPlay = ok ? { name, opts, t: A.t, started: n2 } : null;
    return ok;
  };
  // finta de gancho: arranca feint_hook a la MISMA fase del gancho en curso (son iguales hasta FEINT_CUT) => sin salto; si el gancho ya pasó
  // el corte, entra en el corte con fundido corto.
  // state.damage[zona] sube ~por punto de daño KAGE (medido en peleas vivas: cabeza 6.2 -> +0.011, 19.4 -> +0.034; cuerpo 14.3 -> +0.041; piernas 12.5 -> +0.028)
  const DMG_PER_PT = { head: 0.00176, body: 0.00276, legs: 0.00225, armL: 0.0025, armR: 0.0025 };
  const WALK_MODES = new Set(['exit', 'walk', 'victory', 'ko', 'down']);
  A.fightLoco = !!opts.fightLoco;
  const FEINT_OF = { hook: 'feint_hook', bodyHook: 'feint_hook', uppercut: 'feint_hook' };
  A.feint = (move = 'hook') => {
    const name = FEINT_OF[move]; if (!name) return false;
    const fc = CLIPS[name], cut = fc.impactT;
    const t = A.clip && A.clipMode.name === 'hook' && !A.clipMode.driven ? A.clipT : 0;
    if (A.clip && A.clipMode.name === 'hook' && t <= cut) {          // mismo arranque: continuidad exacta, sin fundido
      A.clip = fc; A.clipT = t; const m = A.clipMode; m.name = name; m.map = null; m.rebound = null; m.speed = 1; m.prev = t; m.driven = false; m.holding = false; m.stale = 0; m.amp = 1; m.ampHead = 1;
    } else startClip(name, { force: true, phase: Math.min(t, cut) / fc.duration });
    A._pend.push({ type: 'feint', name, move });   // se entrega en el próximo update() (events se vacía al empezar)
    return true;
  };
  A.playAt = (name, phase01, simImpact01) => {
    const clip = CLIPS[name]; if (!clip) return false;
    const m = A.clipMode;
    if (!A.clip || m.name !== name || !m.driven) { if (!startClip(name, { driven: true, force: true })) return false; }
    let p = clamp(phase01, 0, 1);
    if (simImpact01 > 0 && simImpact01 < 1) {
      const pi = clip.impactT / clip.duration;
      p = p <= simImpact01 ? (p / simImpact01) * pi : pi + ((p - simImpact01) / (1 - simImpact01)) * (1 - pi);
    }
    if (m.rebound) { m.stale = 0; return true; }                       // r8: rebotando: no sigue la fase de la sim
    A.clipT = p * clip.duration; m.cutAt = p >= 1 ? 1 : 0; m.stale = 0;
    return true;
  };
  // nivel de guardia 0..1 (1 = bloqueo alto): sostenido mientras la sim lo pida, con resorte (≈0.08 s). Se suma bajo los clips.
  A.guard = { target: 0, sp: { x: 0, v: 0 } };
  A.setGuardLevel = (l) => { A.guard.target = clamp(+l || 0, 0, 1); };
  A.cancel = (fade = 0.10) => { if (!A.clip) return false; const ext = strikeExtended(); A.fade = { clip: A.clip, t: A.clipT, w: 1, rate: 1 / Math.max(ext ? Math.max(fade, STRIKE_MIN_FADE) : fade, 1e-3), h: A.clipMode.holding ? A.clipMode.holdT : -1, amp: A.clipMode.amp ?? 1, ampH: A.clipMode.ampHead ?? A.clipMode.amp ?? 1, ek: A.clipMode.entryK || 0, lat: A.clipMode.lat }; A.clip = null; return true; };

  // ---- reacciones y estados (zona del golpe, aturdido, KO, levantarse)
  //   react(zone,{power})   zone = 'head'|'body'|'legs'  (state.hurt.zone de la sim). Corta lo que haya con fundido de 80 ms. power ∈ (0..1.5] escala la pose.
  //   setState(state)       lee el state del peleador de la sim (state.hurt, rocked, stance down|ko, guard) y dispara/sostiene el clip correcto cada frame:
  //                         hurt nuevo -> hurt_<zona>; rocked -> 'rocked' sostenido; down/ko -> 'ko' (cae y queda); al salir de down/ko -> 'getUp'; guard -> setGuardLevel.
  // ronda 4: retroceso proporcional a la fuerza. power 0..1 = daño/16 (la misma normalización que KAGE powerNorm). Fuentes, en orden:
  // o.power, o.damage (CombatEvent 'hit'.damage), o el salto de state.damage[zona] en el frame del golpe (lo estima setState). Sin dato => 1 (= r3).
  // Cuerpo/pelvis (torso, cadera, pz, dy, brazos) escalan fuerte; la cabeza menos y con tope 1 (el latigazo r3 ya está al límite de "cuello roto").
  // El golpe fuerte además dura más (speed < 1: el pico llega ~igual de rápido por frame, sin pops) y el débil se recupera antes.
  A.reactAmp = (power) => { const p = clamp(power, 0, 1.3), amp = 0.40 + 0.90 * p; return { amp, ampHead: Math.min(1, 0.65 + 0.35 * p), speed: clamp(1 / Math.sqrt(amp), 0.78, 1.15) }; };
  A.react = (zone, o = {}) => {
    const n = ZONE_CLIP[zone] || 'hurt_body';
    const pw = o.power ?? (o.damage != null ? o.damage / 16 : null);
    const a = pw == null ? { amp: 1, ampHead: 1 } : A.reactAmp(pw);
    // ronda 6: si el rival enlazado acaba de tocar (contactIn), el retroceso sale DESDE ese punto: el lado del contacto decide el signo
    // y el tamaño de los canales laterales (giro/inclinación de cabeza y tronco). Los clips hurt asumen golpe en el lado derecho.
    const ci = A.lastContactIn, lat = ci && A.t - ci.at <= 0.15 ? latFrom(ci, zone) : null;
    A.lastReact = { zone, power: pw, lat, ...a };
    const ok = startClip(n, { force: true, ...a });
    if (ok) { A.clipMode.lat = lat ?? 1; A.clipMode.latT = A.clipMode.lat; A.clipMode.zone = zone; }
    return ok;
  };
  A.lying = false; A.hurtSeen = null;
  A.setState = (st) => {
    if (!st) return;
    // finta (ronda 4): la sim marca el amago con clip 'feint'; para un hook abortado move = 'hook' (variant no viene)
    if (st.clip === 'feint' && FEINT_OF[st.move]) {
      const key = `${st.animSeq ?? 0}:${st.move}`;
      if (A.feintLock !== key) { A.feintLock = key; A.feint(st.move); }
    } else A.feintLock = null;
    // ronda 4: juego de pies de pelea (stepIn/stepOut/circle/advance/retreat/pivot/guardia y golpes) vs caminar (exit/walk): state.loco.mode
    if (st.loco && st.loco.mode) A.fightLoco = !WALK_MODES.has(st.loco.mode);
    if (st.guard !== undefined) A.setGuardLevel(st.guard);
    A.lastSt = st;
    // liveAnim llama play() ANTES de setState en el mismo frame: si el move recién empezó, el remapeo de play vio el state anterior.
    // Se corrige acá con el state nuevo (mismo instante, clip recién arrancado => sin salto).
    if (A._lastPlay && A._lastPlay.t === A.t) {
      const lp = A._lastPlay; A._lastPlay = null;
      if (st.stance === 'groundBottom') { const c = CLIPS[lp.started]; if (A.clip && A.clipMode.name === lp.started && c && c.tip && !c.ground) A.cancel(0.05); }
      else if (lp.started && A.clip && A.clipMode.name === lp.started) { const [n2, o2] = remap(lp.name, lp.opts); if (n2 !== lp.started) startClip(n2, { ...o2, force: true }); }
    }
    const gr = GROUND_STANCE[st.stance];
    A.ground = gr ? { role: gr, pos: GROUND_KEYS.includes(st.groundPos) ? st.groundPos : (gr === 'top' ? 'mount' : 'mount') } : null;
    if (gr && A.lying) A.lying = false;
    if (gr) { A.setGuardLevel(0); A._lastGround = A.ground; if (A.clip && !A.clip.ground && !(A.clip.tip && A.ground.role === 'top' && isStrike(A.clip))) A.cancel(0.12); }   // en el suelo no van clips de pie
    const wantLying = !gr && (st.ko === true || st.down === true || st.stance === 'ko' || st.stance === 'down');
    if (wantLying && A._lastGround && A._lastGround.role === 'bottom' && !A.lying) { A.ground = A._lastGround; return; }   // KO estando abajo: sigue tendido (sin pararse para caer)
    if (!gr && !wantLying) A._lastGround = null;
    const name = A.clip ? A.clipMode.name : '';
    if (wantLying) {
      if (!A.lying) { A.lying = true; startClip('ko', { force: true }); }
      return;
    }
    if (A.lying) { A.lying = false; startClip('getUp', { force: true }); return; }
    if (st.hurt && st.hurt.blocked && (A.hurtSeen === null || st.hurt.age < A.hurtSeen - 1e-6)) {   // r7: respaldo state.hurt.blocked
      A.blockHit(st.hurt); if (A.opp && typeof A.opp !== 'function' && A.opp.strikeBlocked) A.opp.strikeBlocked(st.hurt);
    } else if (st.hurt && A.blockedAt >= 0 && A.t - A.blockedAt <= 0.15) { /* golpe bloqueado: sin reacción de dolor */ }
    else if (st.hurt && (A.hurtSeen === null || st.hurt.age < A.hurtSeen - 1e-6)) {
      // state.hurt sólo trae {zone, age}; la fuerza se deduce del salto de state.damage[zona] (0..1 acumulado) en ese frame
      let pw = st.hurt.power ?? (st.hurt.damage != null ? st.hurt.damage / 16 : null);
      const z = st.hurt.zone, d1 = st.damage?.[z], d0 = A.dmgSeen?.[z];
      if (pw == null && d1 != null && d0 != null && d1 > d0) pw = (d1 - d0) / (DMG_PER_PT[z] ?? DMG_PER_PT.body) / 16;
      if (A.ground && A.ground.role === 'bottom') { const a = pw == null ? { amp: 1, ampHead: 1 } : A.reactAmp(pw); A.lastReact = { zone: z, power: pw, ground: true, ...a }; startClip(z === 'head' ? 'hurt_ground' : 'hurt_ground_body', { force: true, ...a }); }
      else if (A.ground) A.lastReact = { zone: z, power: pw, ground: true, top: true };   // golpeado estando arriba (raro: guardElbow): sin clip de pie; pendiente
      else A.react(z, { power: pw ?? undefined });
    }
    A.hurtSeen = st.hurt ? st.hurt.age : null;
    if (st.damage) { A.dmgSeen = A.dmgSeen || {}; for (const k in st.damage) A.dmgSeen[k] = st.damage[k]; }
    if (st.rocked) { if (!A.clip) startClip('rocked', { force: true }); }
    else if (name === 'rocked') A.cancel(0.3);
  };
  A.clipInfo = (name) => {
    const clip = CLIPS[name ?? A.clipMode.name]; if (!clip) return null;
    const d = clip.duration, a = clip.phases.find((q) => q.name === 'strike') || clip.phases[1];
    return { name: clip.name, duration: d, impactT: clip.impactT, impact01: clip.impactT / d, active01: [a.t0 / d, a.t1 / d], tip: clip.tip || 'L' };
  };

  // ---- suelo (ronda 7): capa de pose absoluta por (rol, posición) con pesos por resorte (≈0,12 s); ver ground.js
  A.ground = null; A.gndW = 0; const GW = {};
  for (const role of ['top', 'bottom']) for (const k of GROUND_KEYS) GW[role + ':' + k] = { x: 0, v: 0, P: GROUND_POSES[role][k] };
  function groundStep(dt) {
    let tot = 0; const want = A.ground ? A.ground.role + ':' + A.ground.pos : null;
    for (const key in GW) { const w = GW[key]; springCritical(w, key === want ? 1 : 0, 26, dt); if (w.x < 1e-4 && key !== want) { w.x = 0; w.v = 0; } w.x = clamp(w.x, 0, 1); tot += w.x; }
    if (tot > 1) for (const key in GW) GW[key].x /= tot;
    A.gndW = Math.min(1, tot);
  }
  function groundLayer(c) {
    const W = A.gndW;
    for (const n of CHANNELS) {
      let v = c[n] * (1 - W);
      for (const key in GW) { const w = GW[key].x; if (w > 0) v += w * (GW[key].P[n] ?? GUARD[n]); }
      c[n] = v;
    }
  }
  const GROUND_STANCE = { groundTop: 'top', groundBottom: 'bottom' };
  // cabeza del que está abajo: nunca entra en el suelo (esfera de la cabeza del colisor, r = CONTACT.head). Se corrige con el cabeceo del
  // cuello (pendiente medida en la pose actual) -> el latigazo de hurt_ground "choca" con el suelo y rebota sin atravesarlo.
  A.headFloor = { pen: 0, hits: 0 };
  const headCY = () => { const h = rig.pose.head; return h.p[1] + (h.t[1] - h.p[1]) * CONTACT.headC; };
  function floorHead(r) {
    const fy = _root[1] + CONTACT.head + 0.004; let pen0 = fy - headCY(); A.headFloor.pen = Math.max(0, pen0);
    if (pen0 <= 0) return false;
    A.headFloor.hits++;
    for (let it = 0; it < 4 && pen0 > 1e-4; it++) {
      const y0 = headCY(); r.hdPitch += 0.08; solveRig(rig, r); const y1 = headCY(); const sl = (y1 - y0) / 0.08;
      r.hdPitch -= 0.08;
      if (Math.abs(sl) < 0.02) { r.spPitch += 0.05; solveRig(rig, r); pen0 = fy - headCY(); continue; }
      r.hdPitch += clamp(pen0 / sl * 1.05, -0.8, 0.8); solveRig(rig, r); pen0 = fy - headCY();
    }
    return true;
  }
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
    const ev = A.events; ev.length = 0; if (A._pend.length) { ev.push(...A._pend); A._pend.length = 0; }
    if (!A.inited || Math.hypot(rootW.pos[0] - A.lastRoot[1], rootW.pos[2] + A.lastRoot[0]) > 3) reset(rootW);
    A.t += dt;
    // ---- entrada: raíz interna (marco +Z adelante, +X izquierda)
    _root[0] = -rootW.pos[2]; _root[1] = rootW.pos[1]; _root[2] = rootW.pos[0];
    // velocidad (suavizada) por diferencia de raíz
    const k = 1 - Math.exp(-dt * 18);   // ronda 4: 12 -> 18 (los pasos reaccionan antes al stepIn/stepOut)
    A.vel[0] += ((_root[0] - A.lastRoot[0]) / dt - A.vel[0]) * k; A.vel[1] += ((_root[2] - A.lastRoot[1]) / dt - A.vel[1]) * k;
    A.lastRoot[0] = _root[0]; A.lastRoot[1] = _root[2];
    const speed = Math.hypot(A.vel[0], A.vel[1]);
    // rumbo visual: resorte crítico sobre el error angular (el sim puede saltar)
    A.yawSp.x = wrapPi(A.visYaw - rootW.yaw);
    springCritical(A.yawSp, 0, A.fightLoco ? turnOmegaFight : turnOmega, dt);
    A.visYaw = rootW.yaw + A.yawSp.x;
    const yaw = A.visYaw;
    // modo de locomoción
    const wTarget = clamp(speed / 0.5, 0, 1) * (A.fightLoco ? 0 : 1);   // de pelea se mantiene la estancia de guardia (no pasa a marcha)
    A.walkAmt += (wTarget - A.walkAmt) * (1 - Math.exp(-dt * 13));   // ronda 4: 8 -> 13
    const turning = Math.abs(A.yawSp.x) > 0.08 || Math.abs(A.yawSp.v) > 0.3;
    A.idleT = (speed > 0.08 || turning) ? 0 : A.idleT + dt;
    // ---- pies
    const CLm = A.clip && A.clip.climb && A.climbC ? A.climbC : null;
    if (CLm) { A.walkAmt = 0; A.vel[0] = A.vel[1] = 0; }
    if (CLm && A.clipT > 1.40) initFeet(A.feet, top, _root, yaw, 0);   // salida: pies de reposo sobre la raíz (el sim ya la subió al saliente)
    if (!CLm) updateFeet(A.feet, top, _root, yaw, { t: A.t, vel: A.vel, speed, walkAmt: A.walkAmt, idleT: A.idleT, fight: A.fightLoco, freeze: !!(A.clip && A.clip.feet && A.walkAmt < 0.3) }, dt, ev);
    const [fL, fR] = A.feet;
    // ---- canales: guardia + idle + caminar + clips
    const c = A.ch; for (const n of CHANNELS) c[n] = GUARD[n];
    idleLayer(A.t, idleP, 1 - 0.7 * A.walkAmt, c);
    springCritical(A.gate, swingEnv(fL) - swingEnv(fR), 16, dt);
    const fwdSpeed = A.vel[0] * Math.sin(yaw) + A.vel[1] * Math.cos(yaw);
    walkLayer(A.gate.x, A.walkAmt, fwdSpeed, c);
    springCritical(A.guard.sp, A.guard.target, 30, dt);   // ronda 4: 22 -> 30 (subir/bajar la guardia más seco)
    groundStep(dt);
    if (A.guard.sp.x > 1e-4 && A.gndW < 0.999) { const g = clamp(A.guard.sp.x, 0, 1.05) * (1 - A.gndW); for (const n in BLOCK_POSE) c[n] += BLOCK_POSE[n] * g; }
    if (A.gndW > 1e-4) groundLayer(c);
    const S = A.strike; S.active = false; S.phase = 'none';
    if (A.clip && A.clipMode.rebound && A.clipMode.rebound.end) { A.clipMode.rebound = null; const nm = A.clipMode.name; A.cancel(0.20); ev.push({ type: 'clipEnd', name: nm, rebound: true }); }
    if (A.fade) {
      A.fade.w -= dt * A.fade.rate; if (A.fade.w <= 0) A.fade = null; else { const fw = A.fade.w * A.fade.w * (3 - 2 * A.fade.w); addClip(A.fade.clip, A.fade.t, fw * (A.fade.amp ?? 1), c, fw * (A.fade.ampH ?? 1)); if (A.fade.clip.entry && A.fade.ek) addClip(A.fade.clip.entry, A.fade.t, fw * A.fade.ek, c); if (A.fade.lat != null && A.fade.lat !== 1) latLayer(A.fade.clip, A.fade.t, A.fade.lat - 1, fw * (A.fade.amp ?? 1), fw * (A.fade.ampH ?? 1), c); if (A.fade.h >= 0 && A.fade.clip.holdLayer) { A.fade.h += dt; const tmp = makeChannels(); A.fade.clip.holdLayer(A.fade.h, tmp); for (const n of CHANNELS) c[n] += fw * tmp[n]; } }
    }
    if (A.clip) {
      const m = A.clipMode, clip = A.clip, tPrev = m.prev;
      if (m.driven && !m.rebound) { if ((m.stale += dt) > 0.25) { A.cancel(0.12); ev.push({ type: 'clipEnd', name: m.name, stale: true }); } }   // la sim dejó de conducirlo
      else {
        let rate = m.speed;
        if (m.map) rate = m.speed * (A.clipT < clip.impactT ? clip.impactT / m.map.ti : (clip.duration - clip.impactT) / (m.map.tt - m.map.ti));
        if (m.rebound) rate = -REBOUND_RATE;                            // r8: patada bloqueada/chequeada: rebota (desanda la carga) y vuelve a la guardia
        A.clipT += dt * rate;
        if (m.rebound && A.clipT <= m.rebound.until) { A.clipT = m.rebound.until; m.rebound.end = true; }
      }
      m.prev = A.clipT;
      if (tPrev < clip.impactT && A.clipT >= clip.impactT) ev.push(clip.feint ? { type: 'feintCut', name: m.name, move: clip.feint } : { type: 'impact', name: m.name, tip: clip.tip || 'L' });
      if (clip.hold && A.clipT >= clip.duration) {                    // clip SOSTENIDO (rocked, ko): se queda en la última pose hasta otro play/cancel
        if (!m.holding) { m.holding = true; m.holdT = 0; ev.push({ type: 'clipHold', name: m.name }); }
        A.clipT = clip.duration; m.holdT += dt; addClip(clip, clip.duration, 1, c); if (clip.holdLayer) clip.holdLayer(m.holdT, c);
        S.phase = 'hold'; S.t = clip.duration; S.impactT = clip.impactT; S.name = m.name; S.phase01 = 1; S.tip = clip.tip || 'L';
      } else if (A.clipT >= clip.duration || (m.driven && m.cutAt)) { addClip(clip, clip.duration, 1, c); A.clip = null; ev.push({ type: 'clipEnd', name: m.name }); }
      else {
        addClip(clip, A.clipT, m.amp ?? 1, c, m.ampHead ?? m.amp ?? 1);
        if (m.latT != null && m.lat !== m.latT) m.lat += (m.latT - m.lat) * (1 - Math.exp(-dt / 0.03));
        if (m.lat != null && m.lat !== 1) latLayer(clip, A.clipT, m.lat - 1, m.amp ?? 1, m.ampHead ?? m.amp ?? 1, c);
        if (clip.aim && clip.aim.sref && CT.fit && A.opp) {             // ronda 6: si el blanco está más cerca, la pelvis entra menos (b<0) y el brazo llega casi recto
          CT.bodyZ = CT.bodyB || 0; const wb = aimW(clip, A.clipT) * CT.bodyZ; c.pz += wb;
          const pzI = sampleTrack(clip.tracks.pz, clip.impactT), fI = clip.tracks.fLz ? sampleTrack(clip.tracks.fLz, clip.impactT) : 0;
          if (pzI > 1e-3 && fI > 0) c.fLz += wb * Math.min(2, fI / pzI);   // el paso del pie delantero se acorta igual: la guardia no se abre (la pelvis no baja)
        } else CT.bodyZ = 0;
        if (clip.entry) {                                               // ronda 6: entrada del gancho escalada por la distancia al rival en el impacto
          if (A.clipT <= clip.impactT + 1e-9) { const k = entryFactor(clip, clip.impactT - A.clipT); m.entryK += (k - m.entryK) * (1 - Math.exp(-dt * 30)); }
          addClip(clip.entry, A.clipT, m.entryK, c);
        }
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
    if (c.ptR > 1e-3) {                                                // r7: pie de la patada en punta (empeine alineado con la tibia)
      const sh = rig.pose.shinR, dx = sh.t[0] - sh.p[0], dy = sh.t[1] - sh.p[1], dz = sh.t[2] - sh.p[2], dl = Math.hypot(dx, dy, dz) || 1, w = clamp(c.ptR, 0, 1), L = r.legs.R;
      L.footYaw += wrapPi(Math.atan2(dx, dz) - L.footYaw) * w; L.footPitch += (Math.asin(clamp(dy / dl, -1, 1)) - L.footPitch) * w;
      solveRig(rig, r);
    }
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
    guardYield(dt, r);
    { const kc = A.clip && A.clip.tip === 'kickR' ? A.clip : A.fade && A.fade.clip.tip === 'kickR' ? A.fade.clip : null; if (kc) A._kf = kc.kickFrac ?? 0.3; }
    { const sc = isStrike(A.clip) ? A.clip : A.fade && isStrike(A.fade.clip) ? A.fade.clip : null; A._elb = !!(sc && sc.tip === 'elbowR'); }   // r7: punta = codo   // r7: punta de la patada (fracción tobillo->rodilla)
    contactStep(dt, r, ev);
    if (A.gndW > 0.05 && A.ground && A.ground.role === 'bottom') floorHead(r);
    CT.lastR = r; CT.lastS = S;
    exportSkeleton(rootW, yaw, S);
    if (A.opp && A.opp._refine && Math.abs(A.opp.t - A.t) < 1e-9) { A.opp._guardRefine(); A._guardRefine(); A.opp._refine(); A._refine(); A.opp._guardRefine(); A._guardRefine(); A.opp._refine(); A._refine(); }   // orden a->b: b ya movido, a corrige su punta contra la pose NUEVA de b; r8: y b contra la a corregida
    A.diag.clamped = (rig.diag.legReachedL && rig.diag.legReachedR) ? 0 : 1;
    return skeleton;
  };
  const exportSkeleton = (rootW, yaw, S) => {
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
    if (S.tip === 'kickR') { const k = P.shinR, a = P.shinR.t, f = A._kf; toW([a[0] + (k.p[0] - a[0]) * f, a[1] + (k.p[1] - a[1]) * f, a[2] + (k.p[2] - a[2]) * f], S.fist); }
    else if (S.tip === 'elbowR') toW(P.upperArmR.t, S.fist);
    else toW(P['hand' + (S.tip || 'L')].t, S.fist);
  };
  // ---- contacto (ronda 6): la punta del golpe (nudillos o espinilla) no atraviesa al rival. Corre después de solveRig:
  //  1) penetra -> primer punto de contacto en el rayo hombro/cadera->punta; 2) desde el primer contacto de la fase de golpe hasta
  //  HITSTOP s (reales) después del impacto, la punta queda CLAVADA al colisor tocado (sigue su retroceso); 3) al soltar, mezcla 0,08 s
  //  hacia el clamp libre; 4) siempre se proyecta fuera de los colisores. La corrección se aplica moviendo la muñeca (brazo IK) o el tobillo.
  const _tip = [0, 0, 0], _org = [0, 0, 0], _ref = [0, 0, 0], _fc = [0, 0, 0], _want = [0, 0, 0];
  const tipOf = (side, kick, o) => {
    const P = rig.pose;
    if (kick) { const k = P.shinR, a = k.t, f = A._kf; o[0] = a[0] + (k.p[0] - a[0]) * f; o[1] = a[1] + (k.p[1] - a[1]) * f; o[2] = a[2] + (k.p[2] - a[2]) * f; }
    else { const h = A._elb ? P['upperArm' + side].t : P['hand' + side].t; o[0] = h[0]; o[1] = h[1]; o[2] = h[2]; }   // r7: codo (gnp_elbow)
    return o;
  };
  const tipSide = (cl) => (cl.tip === 'kickR' || cl.tip === 'elbowR' ? 'R' : (cl.tip || 'L'));
  const rtOf = (kick) => (kick ? CONTACT.shinTip : A._elb ? CONTACT.elbow : CONTACT.fist);
  const aimW = (cl, t) => { const tI = cl.impactT, tA = Math.max(0, tI - 0.10), tH = tI + HITSTOP; return t <= tI ? smooth01((t - tA) / (tI - tA)) : t <= tH ? 1 : 1 - smooth01((t - tH) / 0.15); };
  const isStrike = (cl) => !!(cl && cl.tip && cl.impactT > 0 && !cl.hold);
  const applyTip = (r, side, kick, target) => {
    for (let it = 0; it < 3; it++) {
      tipOf(side, kick, _tip);
      const ex = target[0] - _tip[0], ey = target[1] - _tip[1], ez = target[2] - _tip[2];
      if (Math.hypot(ex, ey, ez) < 0.002) break;
      if (kick) { const a = r.legs.R.ankle, g = 1 / 0.7; r.legs.R.ankle = [a[0] + ex * g, a[1] + ey * g, a[2] + ez * g]; }
      else if (A._elb) {                                                // r7 codo: se mueve el CODO (esfera del húmero) y el antebrazo lo acompaña rígido;
        const P = rig.pose, S0 = P['upperArm' + side].p, E = P['upperArm' + side].t, W = P['forearm' + side].t;   // el polo apunta al codo pedido => la IK lo deja ahí
        let vx = E[0] + ex - S0[0], vy = E[1] + ey - S0[1], vz = E[2] + ez - S0[2]; { const vl = Math.hypot(vx, vy, vz) || 1, L = DIM.upperArm / vl; vx *= L; vy *= L; vz *= L; }
        // el codo vive en la esfera del húmero: si el punto pedido queda dentro del rival, se busca el punto de la esfera EN su superficie
        if (CT.cols) for (let k = 0; k < 5; k++) {
          const q = [S0[0] + vx, S0[1] + vy, S0[2] + vz]; if (pushOut(CT.cols, q, CONTACT.elbow) <= 1e-4) break;
          vx = q[0] - S0[0]; vy = q[1] - S0[1]; vz = q[2] - S0[2]; const vl = Math.hypot(vx, vy, vz) || 1, L = DIM.upperArm / vl; vx *= L; vy *= L; vz *= L;
        }
        const yw = r.root.yaw, cy = Math.cos(yw), sy = Math.sin(yw), A2 = r.arms[side];
        A2.rel = null; A2.wrist = [S0[0] + vx + W[0] - E[0], S0[1] + vy + W[1] - E[1], S0[2] + vz + W[2] - E[2]];
        A2.poleFace = [vx * cy - vz * sy, vy, vx * sy + vz * cy]; A2.poleW = 1;
      }
      else { const w = r.arms[side].rel ? rig.pose['forearm' + side].t : r.arms[side].wrist; r.arms[side].rel = null; r.arms[side].wrist = [w[0] + ex, w[1] + ey, w[2] + ez]; }
      solveRig(rig, r);
    }
    if (globalThis.__DBG_TIP && A._elb) { tipOf(side, kick, _tip); console.log('applyTip res', Math.hypot(target[0] - _tip[0], target[1] - _tip[1], target[2] - _tip[2]).toFixed(3)); }
  };
  // el resto del miembro (codo/rodilla y la mitad del segmento distal) tampoco entra: si penetra, se desplaza la punta pedida
  // (gana x2 en la articulación media) y se re-resuelve; 2 pasadas. Cubre la rodilla de la patada que vuelve y el torso que se dobla.
  const _m = [0, 0, 0], _h = [0, 0, 0];
  const LIMB_STEP = 0.10, LIMB_STEP_KICK = 0.10, LIMB_STEP_REC = 0.035, LIMB_DEEP = 0.012, LIMB_DEEP_MAX = 0.12, REFINE_LIMB_MAX = 0.04;                                             // m/frame (60 Hz) que puede cambiar la corrección del miembro
  const BK_TOL = 0.012, _bk1 = [null], BK1 = (c) => { _bk1[0] = c; return _bk1; };
  const limbNeed = (cols, side, kick, rt, e) => {
    const P = rig.pose, J = kick ? P.thighR.t : P['upperArm' + side].t; tipOf(side, kick, _tip);
    e[0] = e[1] = e[2] = 0; CT.limbPen = 0;                              // r8: profundidad real máxima de las muestras (no la suma ponderada)
    const R0 = kick ? P.thighR.p : P['upperArm' + side].p;               // cadera / hombro
    const nq = kick && A.clip && A.clip.aim && A.clip.aim.zone === 'head' ? 8 : 9;   // patada media/baja: + q8 = mitad punta->tobillo (r8; la alta envuelve la cabeza con el empeine)                                              // r8: brazo + húmero a 0,3 y 0,75 (el guante del rival que se cruza)
    // patada bloqueada (r7): el brazo/espinilla que bloquea apoya sobre la pierna; no se la empuja (sólo la punta contra él, por el clavado)
    // patada: los brazos del rival (guantes/antebrazos) ceden ante la pierna (guardYield del rival), no la empujan; sólo el cuerpo (0..7)
    const bk0 = CT.blk && A.clip && CT.blk.clip === A.clip ? cols[CT.blk.i] : null, bk = bk0 && (bk0.limb !== 'glove' || !kick) && bk0.limb !== 'shin' ? bk0 : null, lc = kick || bk ? (CT.lc || (CT.lc = [])) : cols;   // r8: puño bloqueado: el guante/antebrazo que bloquea apoya en el brazo (no lo empuja)
    const rec = kick && A.clip && A.clip.tip === 'kickR' ? A.clipT > A.clip.impactT + 0.05 && !(A.clip.aim && A.clip.aim.zone === 'legs') : false;   // recogida: la pierna rodea también los brazos (que bajan a cubrir)
    CT.rec = rec && !bk0 && !!kick;
    if (kick) { lc.length = 0; for (const c of cols) if (c !== bk && (bk0 || rec || CT.refAll || !c.guard)) lc.push(c); }
    else if (bk) { lc.length = 0; for (const c of cols) if (c !== bk) lc.push(c); }   // r8: la 2.ª pasada (rival ya movido/cedido) no deja la pierna dentro de sus brazos   // bloqueada: el resto de la guardia sí frena la pierna
    for (let q = 0; q < nq; q++) {
      if (A._elb && !kick && (q < 4 || q >= 7)) continue;                         // codo: la punta ES la articulación (la lleva el clavado); sólo antebrazo lejano y húmero
      // muestras: articulación media (x2), 1/4, 1/2 y 3/4 del segmento distal, mitad del proximal; patada (r7): + tobillo y medio pie
      const g = q === 0 ? 2 : q === 4 || (kick && (q === 7 || q === 8)) ? 2.5 : !kick && q === 5 ? 3 : !kick && q === 6 ? 1.8 : 1.3;
      let rq = kick ? CONTACT.thigh * 0.8 : rt + 0.02;
      if (q === 0) { _m[0] = J[0]; _m[1] = J[1]; _m[2] = J[2]; }
      else if (q < 4) { const u = q / 4, D = A._elb && !kick ? P['forearm' + side].t : _tip; for (let k = 0; k < 3; k++) _m[k] = J[k] + (D[k] - J[k]) * u; }
      else if (q === 4) for (let k = 0; k < 3; k++) _m[k] = (R0[k] + J[k]) / 2;
      else if (kick && q === 8) { const a = P.shinR.t; for (let k = 0; k < 3; k++) _m[k] = (_tip[k] + a[k]) / 2; rq = CONTACT.shinTip; }
      else if (q >= 8 || (!kick && q === 7)) { const u = q === 7 ? 0.875 : q === 8 ? 0.125 : 0.625, D = A._elb && !kick ? P['forearm' + side].t : _tip; for (let k = 0; k < 3; k++) _m[k] = J[k] + (D[k] - J[k]) * u; }   // r8: segmento distal más denso
      else if (!kick) { const u = q === 5 ? 0.3 : 0.75; for (let k = 0; k < 3; k++) _m[k] = R0[k] + (J[k] - R0[k]) * u; }
      else if (q === 5) { const a = P.shinR.t; _m[0] = a[0]; _m[1] = a[1]; _m[2] = a[2]; rq = CONTACT.shinTip; }
      else if (q === 6) { const f = P.footR; for (let k = 0; k < 3; k++) _m[k] = (f.p[k] + f.t[k]) / 2; rq = 0.035; }
      else for (let k = 0; k < 3; k++) _m[k] = R0[k] + (J[k] - R0[k]) * 0.8;
      _h[0] = _m[0]; _h[1] = _m[1]; _h[2] = _m[2];
      // r8: el húmero no entra en el guante que bloquea (sólo el antebrazo/puño se apoyan en él)
      let dd = pushOut(!kick && bk && q >= 4 && q <= 6 ? cols : lc, _h, rq);
      if (!kick && bk && (q < 4 || q >= 7)) { const d2 = pushOut(BK1(bk), _h, rq - BK_TOL); if (d2 > 0) dd = Math.max(dd, d2 + BK_TOL); }   // r8: antebrazo/puño apoyan en el guante que bloquea, sin hundirse más de BK_TOL
      if (dd > 0) { for (let k = 0; k < 3; k++) e[k] += (_h[k] - _m[k]) * g; if (dd > CT.limbPen) CT.limbPen = dd; }
    }
    return Math.hypot(e[0], e[1], e[2]);
  };
  const _e = [0, 0, 0];
  const shiftTip = (r, cols, side, kick, rt, v) => {
    if (Math.hypot(v[0], v[1], v[2]) < 1e-4) return;
    tipOf(side, kick, _tip); _want[0] = _tip[0] + v[0]; _want[1] = _tip[1] + v[1]; _want[2] = _tip[2] + v[2];
    if (cols) pushOut(cols, _want, rt);
    applyTip(r, side, kick, _want);
  };
  const limbOut = (r, cols, side, kick, rt, dt) => {
    const L = CT.limb;
    shiftTip(r, cols, side, kick, rt, L);                             // corrección del frame anterior
    const need = limbNeed(cols, side, kick, rt, _e);
    const tx = need > 1e-3 ? L[0] + _e[0] : L[0] * Math.exp(-dt / 0.06), ty = need > 1e-3 ? L[1] + _e[1] : L[1] * Math.exp(-dt / 0.06), tz = need > 1e-3 ? L[2] + _e[2] : L[2] * Math.exp(-dt / 0.06);
    let sx = tx - L[0], sy = ty - L[1], sz = tz - L[2]; const sl = Math.hypot(sx, sy, sz), cap = Math.max((kick ? (CT.rec ? LIMB_STEP_REC : LIMB_STEP_KICK) : LIMB_STEP) * dt * 60, Math.min((CT.limbPen - LIMB_DEEP) * 0, LIMB_DEEP_MAX));   // r8: si el miembro entra hondo (rival que se mete), sale en el frame (queda <= LIMB_DEEP)
    if (sl > cap) { sx *= cap / sl; sy *= cap / sl; sz *= cap / sl; }
    L[0] += sx; L[1] += sy; L[2] += sz;
    if (need > 1e-3) shiftTip(r, cols, side, kick, rt, [sx, sy, sz]);
  };
  // r7: MI guardia cede ante el miembro del rival (la pierna de su patada, su brazo que pasa entre mis guantes): si mi antebrazo/guante
  // entra en sus muslos/espinillas/antebrazos/guantes, la muñeca se aparta (<= GUARD_STEP m/frame) y vuelve sola (0,08 s) cuando se libera.
  const GUARD_STEP = 0.06, GUARD_STEP_KICK = 0.14, _gy = { L: [0, 0, 0], R: [0, 0, 0] }, _gs = [0, 0, 0], _ge = [0, 0, 0];
  const GUARD_OPP = [2, 3, 4, 5, 8, 9, 10, 11], UPPER_ARM_R = 0.05;
  A.guardShift = _gy;
  // r7: bloqueo -> el miembro que bloquea VA al golpe: su superficie se lleva hasta la punta del golpe del rival (muñeca para guante/antebrazo,
  // tobillo para la espinilla del chequeo), con envolvente (entra 0,05 s, sostiene, suelta a 0,30 s) y <= MEET_STEP m/frame. El que golpea
  // persigue la superficie más cercana del mismo miembro (clavado tardío) => se encuentran sin atravesarse.
  const MEET_INTO = 0.016, MEET_INTO_FA = 0.03, MEET_STEP = 0.07, MEET_STEP_FIST = 0.10, MEET_STEP_SHIN = 0.12, _mt = [0, 0, 0], _mc = [0, 0, 0], _mo = [0, 0, 0];
  A.meet = null;
  function meetStep(dt, r) {
    const M = A.meet, o = A.opp && typeof A.opp !== 'function' ? A.opp : null;
    if (!M) return false;
    const oc = o && (isStrike(o.clip) ? o.clip : null), op = o && o.contact && o.contact.pin;
    const on = !!(oc && op && !op.done && A.t - M.t0 < 0.4);   // r8: todo miembro que bloquea va al golpe mientras está clavado (puños: a un punto FIJO)   // puños/guante: ya frenan bien sin ir al golpe              // sólo mientras el golpe del rival está clavado (impacto + hit-stop)
    M.e = on ? Math.min(1, (M.e || 0) + dt / 0.025) : Math.max(0, (M.e || 0) - dt / 0.12);
    const env = M.e;
    let tx = 0, ty = 0, tz = 0;
    if (oc && env > 0) {
      const f = o.strike.fist; _mt[0] = -f[2]; _mt[1] = f[1]; _mt[2] = f[0];
      if (M.limb !== 'shin') { if (!M.fix) M.fix = _mt.slice(); _mt[0] = M.fix[0]; _mt[1] = M.fix[1]; _mt[2] = M.fix[2]; }   // puño: el guante va adonde estaba el puño al aviso (si siguiera al puño que lo persigue, derivarían juntos)
      const P = rig.pose, s = M.side, leg = M.limb === 'shin';
      const a0 = leg ? P['shin' + s].p : M.limb === 'glove' ? P['forearm' + s].t : P['upperArm' + s].t, b0 = leg ? P['shin' + s].t : M.limb === 'glove' ? P['hand' + s].t : P['forearm' + s].t;
      const ax = b0[0] - a0[0], ay = b0[1] - a0[1], az = b0[2] - a0[2], L2 = ax * ax + ay * ay + az * az || 1;
      if (leg && o.skeleton && o.skeleton.pose) {                       // r8: chequeo: el punto de la espinilla del rival (rodilla->tobillo) más cercano a la mía (no se cruzan)
        const kp = o.skeleton.pose.kneeR, ap = o.skeleton.pose.footR, K0 = [-kp[2], kp[1], kp[0]], K1 = [-ap[2], ap[1], ap[0]];
        const cp = closestSegSeg(a0, b0, K0, K1); _mt[0] = cp[0]; _mt[1] = cp[1]; _mt[2] = cp[2];
      }
      let u = ((_mt[0] - a0[0]) * ax + (_mt[1] - a0[1]) * ay + (_mt[2] - a0[2]) * az) / L2; u = clamp(u, 0.15, 0.95);
      for (let k = 0; k < 3; k++) _mc[k] = a0[k] + (b0[k] - a0[k]) * u;
      const dx = _mt[0] - _mc[0], dy = _mt[1] - _mc[1], dz = _mt[2] - _mc[2], dl = Math.hypot(dx, dy, dz) || 1;
      const R = leg ? CONTACT.shin * 2 + 0.004 : (M.limb === 'glove' ? CONTACT.glove : CONTACT.forearm) + (oc.tip === 'kickR' ? CONTACT.shinTip : CONTACT.fist) - (M.limb === 'forearm' && oc.tip !== 'kickR' ? MEET_INTO_FA : MEET_INTO);   // chequeo: eje a eje = 2 radios de espinilla (+4 mm)   // r8: apunta 1 cm dentro (la punta del rival lo saca): las superficies quedan juntas
      const k = Math.max(0, dl - R) / dl * env / Math.max(u, 0.3);       // el extremo (muñeca/tobillo) se mueve más que el punto medio
      tx = dx * k; ty = dy * k; tz = dz * k;
    }
    let sx = tx - M.off[0], sy = ty - M.off[1], sz = tz - M.off[2]; const sl = Math.hypot(sx, sy, sz), cap = (oc && oc.tip !== 'kickR' ? MEET_STEP_FIST : M.limb === 'shin' ? MEET_STEP_SHIN : MEET_STEP) * dt * 60;
    if (sl > cap) { sx *= cap / sl; sy *= cap / sl; sz *= cap / sl; }
    M.off[0] += sx; M.off[1] += sy; M.off[2] += sz;
    if (env <= 0 && Math.hypot(M.off[0], M.off[1], M.off[2]) < 1e-4) { A.meet = null; return false; }
    if (M.limb === 'shin') { const a = r.legs[M.side].ankle; r.legs[M.side].ankle = [a[0] + M.off[0], a[1] + Math.max(M.off[1], -0.02), a[2] + M.off[2]]; }
    else { const w = r.arms[M.side].rel ? rig.pose['forearm' + M.side].t : r.arms[M.side].wrist; r.arms[M.side].rel = null; r.arms[M.side].wrist = [w[0] + M.off[0], w[1] + M.off[1], w[2] + M.off[2]]; }
    void _mo; return true;
  }
  function guardYield(dt, r) {
    if (meetStep(dt, r)) solveRig(rig, r);
    const sk = oppSkel();
    const ocols = sk ? (CT.ocols = buildColliders(sk, CT.ocols)) : null;
    let any = false;
    const sc = isStrike(A.clip) ? A.clip : A.fade && isStrike(A.fade.clip) ? A.fade.clip : null;
    const oc = A.opp && typeof A.opp !== 'function' && A.opp.clip ? A.opp.clip : null;
    const holding = A.blockedAt >= 0 && A.t - A.blockedAt < 0.35 && !(oc && oc.tip === 'kickR' && A.meet && A.meet.limb !== 'glove');   // bloqueando un puño: la guardia lo sostiene (no se aparta); una patada: el brazo apoya sobre la pierna
    for (const s of ['L', 'R']) {
      if (holding && (!A.meet || A.meet.side === s || A.meet.limb === 'shin')) { const g = _gy[s], k = 1 - Math.exp(-dt / 0.08); g[0] -= g[0] * k; g[1] -= g[1] * k; g[2] -= g[2] * k; }
      if (sc && sc.tip === s) { _gy[s][0] = _gy[s][1] = _gy[s][2] = 0; continue; }   // el brazo que golpea lo maneja el contacto
      const meetArm = A.meet && A.meet.side === s && A.meet.limb !== 'shin' && A.t - A.meet.t0 < 0.4;   // el brazo que bloquea la patada apoya, no se aparta
      const g = _gy[s], P = rig.pose, el = P['upperArm' + s].t, wr = P['forearm' + s].t, kn = P['hand' + s].t;
      _ge[0] = _ge[1] = _ge[2] = 0; let need = 0;
      const hold = holding && (!A.meet || A.meet.side === s || A.meet.limb === 'shin');   // r8: sólo el brazo que bloquea sostiene; el otro cede
      if (ocols && !hold && !meetArm) for (let q = 0; q < 6; q++) {
        // muestras: antebrazo 1/2 y muñeca, guante 1/2 y nudillos, y (r7, el muslo de la patada entra por el codo) antebrazo 0 y 1/4
        const u = q < 2 ? 0.5 + 0.5 * q : q < 4 ? 0.5 * (q - 1) : 0.25 * (q - 4), A0 = q < 2 || q > 3 ? el : wr, B0 = q < 2 || q > 3 ? wr : kn, rr = q < 2 || q > 3 ? CONTACT.forearm : CONTACT.glove;
        for (let k = 0; k < 3; k++) _gs[k] = A0[k] + (B0[k] - A0[k]) * u;
        const m0 = _gs.slice(), sub = GUARD_OPP.map((i) => ocols[i]);
        if (pushOut(sub, _gs, rr) > 0) { for (let k = 0; k < 3; k++) _ge[k] += (_gs[k] - m0[k]) * (q === 0 ? 1.6 : 1.1); need = 1; }
      }
      let sx, sy, sz;
      if (need) { sx = _ge[0]; sy = _ge[1]; sz = _ge[2]; } else { const k = 1 - Math.exp(-dt / 0.08); sx = -g[0] * k; sy = -g[1] * k; sz = -g[2] * k; }
      const sl = Math.hypot(sx, sy, sz), cap = (need && oc && oc.tip === 'kickR' ? GUARD_STEP_KICK : GUARD_STEP) * dt * 60; if (sl > cap) { sx *= cap / sl; sy *= cap / sl; sz *= cap / sl; }
      g[0] += sx; g[1] += sy; g[2] += sz;
      if (Math.hypot(g[0], g[1], g[2]) < 1e-5) { g[0] = g[1] = g[2] = 0; continue; }
      const w = r.arms[s].rel ? P['forearm' + s].t : r.arms[s].wrist; r.arms[s].rel = null; r.arms[s].wrist = [w[0] + g[0], w[1] + g[1], w[2] + g[2]]; any = true;
    }
    if (any) solveRig(rig, r);
  }
  // r7: el pie de la patada (tobillo->punta) tampoco entra: se gira el PIE (no mueve rodilla ni tobillo) quitando la componente de la
  // dirección del pie que entra en el colisor (2 pasadas). Sólo cambia footYaw/footPitch y se re-resuelve.
  const _fd = [0, 0, 0], _fq = [0, 0, 0], _fn = [0, 0, 0];
  const footOut = (r, cols) => {
    const L = r.legs.R; let changed = false;
    for (let it = 0; it < 2; it++) {
      const f = rig.pose.footR, a = f.p; let worst = 0, wi = -1, wu = 0;
      for (let j = 2; j <= 6; j++) { const u = j / 6; for (let k = 0; k < 3; k++) _fq[k] = a[k] + (f.t[k] - a[k]) * u; for (const c of cols) { const d = 0.03 - sdist(c, _fq); if (d > worst) { worst = d; wi = c.i; wu = u; } } }
      if (wi < 0 || worst < 1e-3) break;
      const c = cols[wi]; for (let k = 0; k < 3; k++) _fq[k] = a[k] + (f.t[k] - a[k]) * wu; axisAt(c, axisU(c, _fq), _fn);
      for (let k = 0; k < 3; k++) { _fn[k] = _fq[k] - _fn[k]; _fd[k] = f.t[k] - a[k]; }
      const nl = Math.hypot(_fn[0], _fn[1], _fn[2]) || 1, dl = Math.hypot(_fd[0], _fd[1], _fd[2]) || 1;
      for (let k = 0; k < 3; k++) { _fn[k] /= nl; _fd[k] /= dl; }
      const dn = _fd[0] * _fn[0] + _fd[1] * _fn[1] + _fd[2] * _fn[2], push = Math.min(1, worst / (DIM.foot * wu)) + 0.15;
      for (let k = 0; k < 3; k++) _fd[k] += _fn[k] * Math.max(push, -dn + 0.15);
      const l2 = Math.hypot(_fd[0], _fd[1], _fd[2]) || 1;
      L.footYaw = Math.atan2(_fd[0], _fd[2]); L.footPitch = Math.asin(clamp(_fd[1] / l2, -1, 1));
      solveRig(rig, r); changed = true;
    }
    return changed;
  };
  // 2.ª pasada sin estado (la llama el rival al terminar SU update en el mismo tick): sólo saca la punta / el miembro si la pose nueva
  // del rival los dejó dentro, re-resuelve y re-exporta. No toca el clavado ni las rampas.
  // r8: 2.ª pasada de la GUARDIA (sin tope): tras las correcciones de los golpes de este tick, mis brazos que no golpean ni sostienen un bloqueo
  // salen de los miembros del rival (su brazo/pierna ya está en su pose final). Lo que se mueve queda en _gy (vuelve solo).
  A._guardRefine = () => {
    const r = CT.lastR, S = CT.lastS, sk = oppSkel(); if (!r || !sk || A.gndW > 0.5) return;
    const ocols = CT.gcols = buildColliders(sk, CT.gcols), sub = GUARD_OPP.map((i) => ocols[i]);
    // r8: + húmeros del rival (hombro->codo; no son colisores de contacto): mi guante no se mete en su brazo que golpea
    const ua = CT.gua || (CT.gua = ['L', 'R'].map(() => ({ kind: 'cap', a: [0, 0, 0], b: [0, 0, 0], r: UPPER_ARM_R })));
    if (!A.ground && !(A.opp && A.opp.ground)) ['L', 'R'].forEach((s, j) => { const a = sk.pose['shoulder' + s], b = sk.pose['elbow' + s]; if (!a || !b) return; ua[j].a[0] = -a[2]; ua[j].a[1] = a[1]; ua[j].a[2] = a[0]; ua[j].b[0] = -b[2]; ua[j].b[1] = b[1]; ua[j].b[2] = b[0]; sub.push(ua[j]); });
    const sc = isStrike(A.clip) ? A.clip : A.fade && isStrike(A.fade.clip) ? A.fade.clip : null;
    const oc = A.opp && typeof A.opp !== 'function' && A.opp.clip ? A.opp.clip : null;
    const holding = A.blockedAt >= 0 && A.t - A.blockedAt < 0.35 && !(oc && oc.tip === 'kickR' && A.meet && A.meet.limb !== 'glove');
    let any = false;
    for (const s of ['L', 'R']) {
      if (sc && (sc.tip === s || (sc.tip === 'elbowR' && s === 'R'))) continue;
      if (holding && (!A.meet || A.meet.side === s || A.meet.limb === 'shin')) continue;
      // (el brazo que va a la patada SÍ, con más margen: apoya en la superficie de la pierna sin cruzarla)
      const mA = !!(A.meet && A.meet.side === s && A.meet.limb !== 'shin' && A.t - A.meet.t0 < 0.4);
      for (let it = 0; it < 5; it++) {
        const P = rig.pose, el = P['upperArm' + s].t, wr = P['forearm' + s].t, kn = P['hand' + s].t; let need = 0; _ge[0] = _ge[1] = _ge[2] = 0;
        for (let q = 0; q < 6; q++) {
          const u = q < 2 ? 0.5 + 0.5 * q : q < 4 ? 0.5 * (q - 1) : 0.25 * (q - 4), A0 = q < 2 || q > 3 ? el : wr, B0 = q < 2 || q > 3 ? wr : kn, rr = q < 2 || q > 3 ? CONTACT.forearm : CONTACT.glove;
          for (let k = 0; k < 3; k++) _gs[k] = A0[k] + (B0[k] - A0[k]) * u;
          const m0 = _gs.slice(); const d = pushOut(sub, _gs, rr); if (d > 0) { for (let k = 0; k < 3; k++) _ge[k] += (_gs[k] - m0[k]) * (q === 0 || q === 4 ? 1.8 : q === 5 ? 1.5 : 1.15); if (d > (mA ? 0.018 : LIMB_DEEP * 0.7)) need = 1; }
        }
        if (!need) break;
        const g = _gy[s]; g[0] += _ge[0]; g[1] += _ge[1]; g[2] += _ge[2];
        r.arms[s].rel = null; r.arms[s].wrist = [wr[0] + _ge[0], wr[1] + _ge[1], wr[2] + _ge[2]]; solveRig(rig, r); any = true;
      }
    }
    if (any) exportSkeleton({ pos: skeleton.root.pos.slice(), yaw: skeleton.root.yaw }, skeleton.visualYaw, S);
  };
  A._refine = () => {
    const r = CT.lastR, S = CT.lastS, sk = oppSkel();
    if (!r || !sk || !(isStrike(A.clip) || (A.fade && isStrike(A.fade.clip)))) return;
    const cl = isStrike(A.clip) ? A.clip : A.fade.clip, kick = cl.tip === 'kickR', side = tipSide(cl), rt = rtOf(kick);
    const cols = CT.rcols = buildColliders(sk, CT.rcols);
    tipOf(side, kick, _tip); _want[0] = _tip[0]; _want[1] = _tip[1]; _want[2] = _tip[2];
    CT.refAll = true; const mv = pushOut(cols, _want, rt), need = limbNeed(cols, side, kick, rt, _e); CT.refAll = false;
    if (mv < 1e-3 && need < 1e-3) { if (kick && footOut(r, cols)) exportSkeleton({ pos: skeleton.root.pos.slice(), yaw: skeleton.root.yaw }, skeleton.visualYaw, S); return; }
    { const el = Math.hypot(_e[0], _e[1], _e[2]), cap = Math.max(REFINE_LIMB_MAX, Math.min((CT.limbPen - LIMB_DEEP) * 2.5, LIMB_DEEP_MAX)), k = el > cap ? cap / el : 1; for (let q = 0; q < 3; q++) _want[q] += _e[q] * k; }   // el miembro: tope por frame (sin pops); la punta sí sale entera
    pushOut(cols, _want, rt); applyTip(r, side, kick, _want);
    { // r8: si sigue hondo (> LIMB_DEEP), más pasadas amortiguadas (la IK no lo saca en una; entre dos colisores oscila): se queda la mejor
      let best = Infinity; const bw = [0, 0, 0];
      for (let it = 0; it < 8; it++) {
        CT.refAll = true; const n2 = limbNeed(cols, side, kick, rt, _e); CT.refAll = false;
        tipOf(side, kick, _tip);
        if (n2 < best) { best = n2; bw[0] = _tip[0]; bw[1] = _tip[1]; bw[2] = _tip[2]; }
        if (CT.limbPen <= LIMB_DEEP) break;
        const st = (it < 2 ? 1 : 0.5) * Math.min(1, Math.min(CT.limbPen * 2.5, LIMB_DEEP_MAX) / (n2 || 1));
        for (let q = 0; q < 3; q++) _want[q] = _tip[q] + _e[q] * st;
        pushOut(cols, _want, rt); applyTip(r, side, kick, _want);
        if (it === 7) { CT.refAll = true; const n3 = limbNeed(cols, side, kick, rt, _e); CT.refAll = false; if (n3 > best) applyTip(r, side, kick, bw); }
      }
    }
    if (kick) footOut(r, cols);
    exportSkeleton({ pos: skeleton.root.pos.slice(), yaw: skeleton.root.yaw }, skeleton.visualYaw, S);
    CT.refined = (CT.refined || 0) + 1;
  };
  // ---- bloqueo (ronda 7). Combate decide en la sim si el golpe fue bloqueado y lo emite en el evento `block` (bloqueo, desvío, chequeo de low
  // kick, patada atrapada) con `power`, `point` y (rama siguiente de Combate) `guard: {limb:'glove'|'forearm'|'shin', side:'L'|'R'}`.
  //   A.strikeBlocked(info)  (lado que GOLPEA) el golpe en curso frena contra ese miembro del rival (colisor objetivo). Sin `guard`: el guante o
  //                          antebrazo más cercano a la trayectoria del puño (no se usa `point`: hoy cae en la zona del cuerpo); patada chequeada
  //                          (src 'check' o patada sin guard): espinilla contra espinilla (la del rival más cercana).
  //   A.blockHit(info)       (lado que RECIBE) la guardia cede con la fuerza (clip block_hit / check_hit), sin reacción de dolor (se ignora el
  //                          state.hurt que llegue en los 0,15 s siguientes).
  //   Respaldo: state.hurt.blocked === true en setState hace lo mismo (y avisa al rival enlazado). bindCombatEvents(live, anims) los conecta.
  A.blockedAt = -1;
  // punto del eje de c más cercano al segmento S->T (blanco de un golpe bloqueado: el guante/antebrazo donde lo cruza la trayectoria)
  const axisNear = (c, S, T) => {
    const q = [0, 0, 0], p = [0, 0, 0]; let bu = 0, bd = Infinity;
    for (let j = 0; j <= 16; j++) { axisAt(c, j / 16, q); let md = Infinity; for (let m = 0; m <= 16; m++) { const v = m / 16; for (let k = 0; k < 3; k++) p[k] = S[k] + (T[k] - S[k]) * v; md = Math.min(md, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); } if (md < bd) { bd = md; bu = j / 16; } }
    return axisAt(c, bu, [0, 0, 0]);
  };
  A.strikeBlocked = (info = {}) => {
    const cl = isStrike(A.clip) ? A.clip : null, sk = oppSkel(); if (!cl || !sk) return false;
    const cols = CT.cols = buildColliders(sk, CT.cols), kick = cl.tip === 'kickR', src = info.src || info.result || '';
    let i = guardIndex(info.guard);
    if (i < 0) {
      // sin guard: lo más cercano a la trayectoria (hombro/cadera -> blanco previsto o punta actual)
      const P = rig.pose, S0 = kick ? P.thighR.p : P['upperArm' + tipSide(cl)].p, T = CT.aimQ || tipOf(tipSide(cl), kick, [0, 0, 0]);
      const low = kick && (src === 'check' || (cl.aim && cl.aim.zone === 'legs'));   // low kick: chequeo con la espinilla (la adelantada, L); media/alta: brazos
      const cand = low ? [COL.shinL] : kick ? [COL.forearmL] : [COL.gloveL, COL.gloveR, COL.forearmL, COL.forearmR];   // r8: como Combate (combat-guard): media/alta = antebrazo; media/alta de derecha: llega por la izquierda del rival (su brazo L)
      let bd = Infinity; const q = [0, 0, 0];
      for (const k of cand) for (let j = 4; j <= 24; j++) { const u = j / 24; for (let m = 0; m < 3; m++) q[m] = S0[m] + (T[m] - S0[m]) * u; const d = sdist(cols[k], q); if (d < bd) { bd = d; i = k; } }
    }
    if (kick && src === 'catch') i = COL.gloveL;                        // patada atrapada: el pie contra las manos (pose de pierna atrapada: pendiente)
    CT.blk = { clip: cl, i, src, at: A.t, power: info.power ?? null };
    // si el aviso llega con la punta ya en el blanco (el evento de la sim cae en el tick de impacto): clavado NUEVO en la superficie del miembro
    // de guardia más cercana a la punta; la mano va hacia él con el seguimiento limitado del clavado (<= PIN_FOLLOW m/frame, hasta 0,20 m)
    // y el hit-stop cuenta desde el aviso.
    if (A.clipT >= cl.impactT - 1 / 60 - 1e-9 && A.clipT <= cl.impactT + HITSTOP + 1 / 60) {
      const c = cols[i], rt = rtOf(kick), tp = tipOf(tipSide(cl), kick, [0, 0, 0]);
      // punto del miembro de guardia que da hacia el golpe: del eje (donde lo cruza la trayectoria) hacia el hombro/cadera del que golpea
      const S0 = kick ? rig.pose.thighR.p : rig.pose['upperArm' + tipSide(cl)].p, ax = axisNear(c, S0, tp), u = axisU(c, ax);
      const nx = S0[0] - ax[0], ny = S0[1] - ax[1], nz = S0[2] - ax[2], nl = Math.hypot(nx, ny, nz) || 1, R = c.r + rt;
      const g = [ax[0] + nx / nl * R, ax[1] + ny / nl * R, ax[2] + nz / nl * R];
      CT.pin = { fol: 0, max: kick ? 0.40 : 0.20, i, u, p: tp, off: [g[0] - ax[0], g[1] - ax[1], g[2] - ax[2]], tImp: A.t, done: false, t0: A.clipT, late: true, chase: true };   // r8: el puño persigue la superficie del guante/antebrazo que va al golpe
      CT.zone = c.zone; CT.last = { name: A.clipMode.name, zone: c.zone, limb: c.limb, side: c.side, blocked: true, point: toW(g, [0, 0, 0]), clipT: A.clipT, early: cl.impactT - A.clipT };
      A._pend.push({ type: 'contact', ...CT.last });
    } else if (CT.pin && CT.pin.i !== i) CT.pin = null;                // aviso temprano: re-clava sobre el miembro de guardia al tocarlo
    A._pend.push({ type: 'blocked', limb: cols[i].limb, side: cols[i].side, src });
    return true;
  };
  A.blockHit = (info = {}) => {
    const src = info.src || info.result || '', g = info.guard || null, pw = info.power ?? 0.6;
    const o = A.opp && typeof A.opp !== 'function' ? A.opp : null, oc = o && o.clip && o.clip.tip ? o.clip : null, kickish = !!(oc && oc.tip === 'kickR');
    const zone = info.zone || (oc && oc.aim ? oc.aim.zone : null);
    let name = 'block_hit';
    if (src === 'check' || (g && g.limb === 'shin') || (kickish && zone === 'legs')) {   // chequeo: levanta la pierna por donde entra la patada
      let side = g && (g.side === 'L' || g.side === 'R') ? g.side : oc && oc.tip === 'kickR' ? 'L' : null;   // r8: espejo del miembro que patea (como Combate)
      if (!side && o) { const f = o.strike.fist, P = rig.pose.pelvis.p, yw = A.visYaw, lx = -f[2] - P[0], lz = f[0] - P[2]; side = lx * Math.cos(yw) - lz * Math.sin(yw) > 0 ? 'L' : 'R'; }
      name = side === 'R' ? 'check_hit_R' : 'check_hit';
    }
    else if (kickish) {                                                 // patada media/alta: brazo del lado por donde entra (guard.side o geometría)
      let side = g && (g.side === 'L' || g.side === 'R') ? g.side : oc.tip === 'kickR' ? 'L' : null;
      if (!side) { const f = o.strike.fist, P = rig.pose.head.p, yw = A.visYaw, lx = -f[2] - P[0], lz = f[0] - P[2]; side = lx * Math.cos(yw) - lz * Math.sin(yw) > 0 ? 'L' : 'R'; }
      name = `block_kick_${zone === 'head' ? 'high' : 'body'}_${side}`;
    }
    A.blockedAt = A.t; A.hurtSeen = A.hurtSeen ?? null;
    { // qué miembro bloquea: guard del evento, o el que eligió el rival enlazado (strikeBlocked), o por el clip
      const ob = o && o.contact && o.contact.blk && o.contact.blk.clip === o.clip ? o.contact.cols[o.contact.blk.i] : null;
      const limb = g && g.limb ? g.limb : ob ? ob.limb : (name.startsWith('check') ? 'shin' : 'glove');
      const side = g && g.side ? g.side : ob ? ob.side : name.endsWith('_R') ? 'R' : 'L';
      A.meet = { limb, side, t0: A.t, off: A.meet ? A.meet.off : [0, 0, 0] };
    }
    const amp = clamp(0.45 + 0.8 * pw, 0.35, 1.3);
    const ok = startClip(name, { force: true, amp, ampHead: amp });
    A.lastBlock = { name, power: pw, guard: g, src, at: A.t };
    A._pend.push({ type: 'blockHit', name, power: pw });
    return ok;
  };
  function contactStep(dt, r, ev) {
    CT.raw = 0; CT.pen = 0;
    const sk = oppSkel();
    const live = isStrike(A.clip), cl = live ? A.clip : (A.fade && isStrike(A.fade.clip) ? A.fade.clip : null);
    if (!live) CT.pin = null;
    const dn = Math.hypot(CT.d[0], CT.d[1], CT.d[2]);
    if (!sk || !cl) {                                                    // sin golpe: la corrección residual se apaga sola (sin pop)
      CT.prevOk = false;
      { const k = Math.exp(-dt / 0.05); CT.aim *= k; CT.aimX *= k; CT.aimZ *= k; } if (Math.abs(CT.aim) + Math.abs(CT.aimX) + Math.abs(CT.aimZ) < 1e-4) CT.aim = CT.aimX = CT.aimZ = 0;
      { const k = Math.exp(-dt / 0.06); CT.limb[0] *= k; CT.limb[1] *= k; CT.limb[2] *= k; }
      const ln = Math.hypot(CT.limb[0], CT.limb[1], CT.limb[2]);
      if (dn < 1e-4 && !CT.aim && !CT.aimX && !CT.aimZ && ln < 1e-4) { CT.d[0] = CT.d[1] = CT.d[2] = 0; CT.limb[0] = CT.limb[1] = CT.limb[2] = 0; return; }
      const k = Math.exp(-dt / 0.04); CT.d[0] *= k; CT.d[1] *= k; CT.d[2] *= k;
      tipOf(CT.side, CT.kick, _want); _want[0] += CT.d[0] + CT.aimX + CT.limb[0]; _want[1] += CT.d[1] + CT.aim + CT.limb[1]; _want[2] += CT.d[2] + CT.aimZ + CT.limb[2];
      if (sk) { CT.cols = buildColliders(sk, CT.cols); pushOut(CT.cols, _want, CT.kick ? CONTACT.shinTip : CONTACT.fist); }
      applyTip(r, CT.side, CT.kick, _want); return;
    }
    const cols = CT.cols = buildColliders(sk, CT.cols);
    // r7: guardia del rival. Golpe NO bloqueado: guantes/antebrazos sólo empujan (el golpe los rodea o pasa entre ellos, nunca los atraviesa)
    // y no lo frenan; BLOQUEADO (strikeBlocked): el miembro de guardia indicado es el blanco y el que frena.
    const blk = CT.blk && CT.blk.clip === cl ? CT.blk : null;
    const stop = CT.stop || (CT.stop = []); stop.length = 0;
    if (blk) stop.push(cols[blk.i]); for (let i = 0; i < COL.BODY; i++) stop.push(cols[i]);
    if (!CT.prevCols) CT.prevCols = cols.map((c) => ({ a: c.a.slice(), b: c.b.slice() }));
    else if (CT.prevOk && A.opp && typeof A.opp !== 'function' && A.opp.t < A.t - 1e-9) extrapolate(cols, CT.prevCols, 1);   // orden a->b: la pose del rival es de hace 1 frame
    else for (let i = 0; i < cols.length; i++) for (let j = 0; j < 3; j++) { CT.prevCols[i].a[j] = cols[i].a[j]; CT.prevCols[i].b[j] = cols[i].b[j]; }
    CT.prevOk = true;
    const kick = cl.tip === 'kickR', side = tipSide(cl), rt = rtOf(kick);
    if (side !== CT.side || kick !== CT.kick) { CT.side = side; CT.kick = kick; }
    tipOf(side, kick, _tip);
    const P = rig.pose, O = kick ? P.thighR.t : A._elb ? P['upperArm' + side].p : P['upperArm' + side].t; _org[0] = O[0]; _org[1] = O[1]; _org[2] = O[2];   // rayo del segmento distal: codo->nudillos / rodilla->espinilla
    const t = A.clipT;
    // apuntado vertical (sólo con rival): la punta llega a la altura de la zona en el impacto; rampa suave, se mantiene el hit-stop, sale en 0,15 s
    // ajuste al blanco (sólo con rival): con la punta LIBRE prevista en el impacto (clip.aim.ref, marco raíz: [izq, altura, adelante];
    // gancho: interpolada por la entrada k) se calcula dónde toca la zona (rayo hombro/cadera->punta a la altura de la zona, o el punto
    // de superficie más cercano si el arco pasa al lado) y la diferencia entra en rampa durante los últimos 0,10 s: el golpe llega a la
    // superficie EN el impacto, frenando de forma continua (sin plegarse de golpe al chocar). Se congela tras el impacto y sale en 0,15 s.
    if (live && cl.aim) {
      const tI = cl.impactT, w = aimW(cl, t);
      if (t <= tI + 1e-9 && !A.clipMode.rebound) {
        const a = cl.aim, ek = A.clipMode.entryK || 0, rf = a.refPos && A.ground && a.refPos[A.ground.pos] ? a.refPos[A.ground.pos] : !a.ref ? [0, 1, 0.5] : a.ref1 ? [0, 1, 2].map((k) => a.ref[k] + (a.ref1[k] - a.ref[k]) * ek) : a.ref;
        const yw = r.root.yaw, sy = Math.sin(yw), cy = Math.cos(yw), tl = Math.max(0, tI - t);
        const rx = _root[0] + A.vel[0] * tl, rz = _root[2] + A.vel[1] * tl;
        const Px = rx + cy * rf[0] + sy * rf[2], Py = _root[1] + rf[1], Pz = rz - sy * rf[0] + cy * rf[2];
        let ci = 0;
        if (blk) ci = blk.i;
        else if (a.zone === 'body') ci = 1;
        else if (a.zone === 'legs') { let bd = Infinity; for (let k = 2; k <= 5; k++) { const d = sdist(cols[k], [Px, Py, Pz]); if (d < bd) { bd = d; ci = k; } } }
        const col = cols[ci], Q = blk ? axisNear(col, kick ? rig.pose.thighR.p : rig.pose['upperArm' + side].p, [Px, Py, Pz])
          : a.center ? (col.kind === 'sph' ? [col.a[0], col.a[1] + (a.dy || 0), col.a[2]] : [0, 1, 2].map((k) => col.a[k] + (col.b[k] - col.a[k]) * (a.u ?? 0.5) + (k === 1 ? a.dy || 0 : 0)))   // r7 suelo: al centro del blanco tendido
          : [Px, a.dy == null ? Py : col.a[1] + a.dy, Pz];
        CT.aimQ = Q;
        const S0 = kick ? rig.pose.thighR.p : rig.pose['upperArm' + side].p;   // rayo de apuntado desde hombro/cadera (no depende del codo)
        const one = [col], hit = firstContact(one, S0, Q, rt, [0, 0, 0]);
        let G = null;
        if (hit) { const L = Math.hypot(Q[0] - S0[0], Q[1] - S0[1], Q[2] - S0[2]) || 1; G = [0, 1, 2].map((k) => hit.point[k] + (Q[k] - S0[k]) / L * AIM_DRIVE); }
        else { const q = Q.slice(), sd = sdist(col, q) - rt; if (sd < AIM_SEEK) { pushIn(col, q, rt - AIM_DRIVE); G = q; } }
        const fx = G ? G[0] - Px : 0, fy = G ? G[1] - Py : 0, fz = G ? G[2] - Pz : 0;
        CT.fit = [fx, fy, fz];
        if (G && a.sref) {                                                  // b: cuánto menos entra la pelvis para que hombro->blanco = ARM_REACH (codo ~150°)
          const sr = a.sref, Sx = rx + cy * sr[0] + sy * sr[2], Sy = _root[1] + sr[1], Sz = rz - sy * sr[0] + cy * sr[2];
          const Dx = G[0] - Sx, Dy = G[1] - Sy, Dz = G[2] - Sz, Df = Dx * sy + Dz * cy, D2 = Dx * Dx + Dy * Dy + Dz * Dz, Lt = ARM_REACH;
          const disc = Df * Df - D2 + Lt * Lt, cap = Math.max(0, sampleTrack(cl.tracks.pz, cl.impactT)) + 0.03;
          CT.bodyB = D2 < Lt * Lt && disc >= 0 ? Math.max(-cap, Math.min(0, Df - Math.sqrt(disc))) : 0;
        } else CT.bodyB = 0;
      }
      const F = CT.fit || [0, 0, 0], yw = r.root.yaw, bz = CT.bodyZ || 0;   // lo que ya absorbió la pelvis no lo hace el brazo
      CT.aimX = w * (F[0] - bz * Math.sin(yw)); CT.aim = w * F[1]; CT.aimZ = w * (F[2] - bz * Math.cos(yw));
    } else { const k = Math.exp(-dt / 0.05); CT.aim *= k; CT.aimX *= k; CT.aimZ *= k; CT.fit = null; CT.bodyB = 0; }
    if (Math.abs(CT.aim) + Math.abs(CT.aimX) + Math.abs(CT.aimZ) > 1e-4) { _want[0] = _tip[0] + CT.aimX; _want[1] = _tip[1] + CT.aim; _want[2] = _tip[2] + CT.aimZ; applyTip(r, side, kick, _want); tipOf(side, kick, _tip); }
    const pr = penetration(cols, _tip, rt); CT.raw = Math.max(0, pr.pen);
    if (live && CT.pin && !CT.pin.done) {
      if (CT.pin.tImp < 0 && t >= cl.impactT - 1e-9) CT.pin.tImp = A.t;
      if (CT.pin.tImp >= 0 && A.t - CT.pin.tImp >= HITSTOP + (CT.pin.late ? 1 / 60 : 0) - 1e-9) { CT.pin.done = true; CT.rel = 1; CT.dRel[0] = CT.d[0]; CT.dRel[1] = CT.d[1]; CT.dRel[2] = CT.d[2];
 }
    }
    // r8: patada bloqueada/chequeada: desde el impacto el clip va hacia atrás (rebota desandando la carga) en vez de seguir el barrido a
    // través del miembro que bloquea; al soltar el clavado la punta libre ya está del lado del golpe (sin salto)
    // (también la low kick que conecta en el muslo: el clip libre barre a través de la pierna, que no se va con el golpe)
    if (live && kick && ((blk && blk.src !== 'catch') || (!blk && CT.pin && (CT.pin.i >= 2 && CT.pin.i <= 5))) && !A.caught && !A.clipMode.rebound && t >= cl.impactT - 1e-9) A.clipMode.rebound = { until: Math.max(0.02, cl.impactT - REBOUND_BACK) };
    let want = null;
    if (live && CT.pin && !CT.pin.done) {                                  // clavado al colisor tocado: sigue el retroceso del rival
      // clavado en el punto de impacto (mundo); si el rival se mueve, la mano lo acompaña con velocidad limitada (<= PIN_FOLLOW m/frame a 60 Hz)
      const c = cols[CT.pin.i]; axisAt(c, CT.pin.u, _ref);
      if (CT.pin.chase) { const q = CT.pin.p.slice(); pushIn(c, q, rt); CT.pin.u = axisU(c, q); axisAt(c, CT.pin.u, _ref); for (let k = 0; k < 3; k++) CT.pin.off[k] = q[k] - _ref[k]; }   // patada bloqueada: persigue la superficie más cercana del brazo que se mueve
      const gx = _ref[0] + CT.pin.off[0] - CT.pin.p[0], gy = _ref[1] + CT.pin.off[1] - CT.pin.p[1], gz = _ref[2] + CT.pin.off[2] - CT.pin.p[2];
      const gl = Math.hypot(gx, gy, gz), room = Math.max(0, (CT.pin.max ?? PIN_FOLLOW_MAX) - CT.pin.fol), cap = Math.min((CT.pin.late ? PIN_FOLLOW_LATE : PIN_FOLLOW) * dt * 60, room), k = gl > cap ? cap / gl : 1;
      CT.pin.p[0] += gx * k; CT.pin.p[1] += gy * k; CT.pin.p[2] += gz * k; CT.pin.fol += gl * k;
      _want[0] = CT.pin.p[0]; _want[1] = CT.pin.p[1]; _want[2] = CT.pin.p[2]; want = _want;
    } else {
      let fc = firstContact(stop, _org, _tip, rt, _fc);
      if (!fc && live && !CT.pin && Math.abs(t - cl.impactT) <= 1 / 60 + 1e-9) {   // r7: punta a ras (<= 6 mm) de la superficie en el impacto => toca
        let bi = -1, bd = CONTACT_SKIN; for (let k = 0; k < stop.length; k++) { const d = sdist(stop[k], _tip) - rt; if (d < bd) { bd = d; bi = k; } }
        if (bi >= 0) { _fc[0] = _tip[0]; _fc[1] = _tip[1]; _fc[2] = _tip[2]; pushOut([stop[bi]], _fc, rt); fc = { point: _fc, i: bi, s: 1 }; }
      }
      if (fc) {
        _want[0] = fc.point[0]; _want[1] = fc.point[1]; _want[2] = fc.point[2]; want = _want;
        if (live && !CT.pin && !A.clipMode.rebound && t >= cl.phases[1].t0 - 1e-9 && t <= cl.impactT + HITSTOP) {
          const c = stop[fc.i]; fc.i = c.i; const u = axisU(c, fc.point); axisAt(c, u, _ref);
          CT.pin = { fol: 0, i: fc.i, u, p: [fc.point[0], fc.point[1], fc.point[2]], off: [fc.point[0] - _ref[0], fc.point[1] - _ref[1], fc.point[2] - _ref[2]], tImp: t >= cl.impactT ? A.t : -1, done: false, t0: t };
          CT.zone = c.zone;
          const pw = toW(fc.point, [0, 0, 0]);
          CT.last = { name: A.clipMode.name, zone: c.zone, limb: c.limb, side: c.side, blocked: !!blk, point: pw, clipT: t, early: cl.impactT - t };
          ev.push({ type: 'contact', ...CT.last });
          if (A.opp && A.opp._onContactIn) A.opp._onContactIn({ ...CT.last });
        }
      }
    }
    const dx = want ? want[0] - _tip[0] : 0, dy = want ? want[1] - _tip[1] : 0, dz = want ? want[2] - _tip[2] : 0;
    if (CT.rel > 0) {                                                      // suelta el clavado: mezcla hacia el clamp libre
      CT.rel = Math.max(0, CT.rel - dt / 0.08); const w = CT.rel * CT.rel * (3 - 2 * CT.rel);
      CT.d[0] = dx + (CT.dRel[0] - dx) * w; CT.d[1] = dy + (CT.dRel[1] - dy) * w; CT.d[2] = dz + (CT.dRel[2] - dz) * w;
    } else if (!want && !live && dn > 1e-4) {                              // fundido del golpe cortado: apagar suave
      const k = Math.exp(-dt / 0.04); CT.d[0] *= k; CT.d[1] *= k; CT.d[2] *= k;
    } else { CT.d[0] = dx; CT.d[1] = dy; CT.d[2] = dz; }
    if (Math.hypot(CT.d[0], CT.d[1], CT.d[2]) < 1e-5 && pr.pen <= 0) { limbOut(r, cols, side, kick, rt, dt); if (kick) footOut(r, cols); return; }
    _want[0] = _tip[0] + CT.d[0]; _want[1] = _tip[1] + CT.d[1]; _want[2] = _tip[2] + CT.d[2];
    pushOut(cols, _want, rt);
    applyTip(r, side, kick, _want);
    limbOut(r, cols, side, kick, rt, dt);
    if (kick) footOut(r, cols);
    tipOf(side, kick, _tip);
    CT.pen = Math.max(0, penetration(cols, _tip, rt).pen);
  }
  // Posiciones MUNDO de las plantas de pie (para tests/visores): { L:{planted,pos:[x,y,z]}, R:{...} }
  A.feetWorld = () => A.eff.map((e, i) => ({ side: A.feet[i].side, planted: e.planted, pos: toW([e.pos[0], e.sole, e.pos[2]], [0, 0, 0]), contact: toW(e.contact, [0, 0, 0]), yaw: e.yaw, pitch: e.pitch, ball: e.ball }));
  return A;
}
