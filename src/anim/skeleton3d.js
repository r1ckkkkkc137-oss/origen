// skeleton3d.js — esqueleto humanoide 3D (Y arriba, metros, ~1.80 m, mira a +Z, izquierda = +X). Matemática pura.
//
// FORMA DE DATOS (alineable con contracts.Skeleton3D):
//   sk = {
//     bones: [{ name, parent, length, restOffset:[x,y,z], restDir:[x,y,z], restHint:[x,y,z] }],  // estático
//          - parent: nombre del padre o null. restOffset: posición de la CABEZA del hueso relativa a la cabeza del padre
//            en pose de reposo (ejes mundo, todos los huesos con orientación identidad en reposo). length: cabeza->cola.
//     index: { name: i },
//     pose:  { [boneName]: { p:[x,y,z] cabeza MUNDO, t:[x,y,z] cola MUNDO, q:[x,y,z,w] rotación MUNDO vs reposo,
//                            lq:[x,y,z,w] rotación LOCAL vs padre } },
//     root:  { pos:[x,y,z] (suelo bajo la pelvis), yaw (rad, 0 = mira +Z) },
//     diag:  { ... }  // flags de IK / flexiones, solo debug
//   }
// Huesos (segmentos; cada uno nombrado por su articulación de origen):
//   pelvis, spine, chest, neck, head,
//   shoulderL/R (clavícula; su cola = articulación del hombro), upperArmL/R (hombro->codo), forearmL/R (codo->muñeca),
//   handL/R (muñeca->puño), thighL/R (cadera->rodilla), shinL/R (rodilla->tobillo), footL/R (tobillo->punta).
import { qFromYPR, qMul, qRot, qBone, qIdent, qConj, qAxisAngle, add, addScaled, norm, dot, cross, copy, copyQ } from './math3.js';
import { solveTwoBone, makeIKOut } from './ik.js';

export const DIM = Object.freeze({
  ankleH: 0.08, shin: 0.42, thigh: 0.44, hipHalf: 0.09,
  pelvis: 0.14, spine: 0.18, chest: 0.22, neck: 0.10, head: 0.22,
  clavUp: 0.20, clav: 0.18, upperArm: 0.31, foreArm: 0.27, hand: 0.18, foot: 0.22,
});
export const STAND_PELVIS_Y = DIM.ankleH + DIM.shin + DIM.thigh;   // 0.94
export const HEIGHT = STAND_PELVIS_Y + DIM.pelvis + DIM.spine + DIM.chest + DIM.neck + DIM.head;  // 1.80

export const BONE_NAMES = [
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'forearmL', 'handL', 'shoulderR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
];

export function createHumanoid3D() {
  const D = DIM, UP = [0, 1, 0], DOWN = [0, -1, 0], FWD = [0, 0, 1], BACK = [0, 0, -1];
  const B = (name, parent, length, restOffset, restDir = UP, restHint = FWD) => ({ name, parent, length, restOffset, restDir, restHint });
  const bones = [
    B('pelvis', null, D.pelvis, [0, STAND_PELVIS_Y, 0]),
    B('spine', 'pelvis', D.spine, [0, D.pelvis, 0]),
    B('chest', 'spine', D.chest, [0, D.spine, 0]),
    B('neck', 'chest', D.neck, [0, D.chest, 0]),
    B('head', 'neck', D.head, [0, D.neck, 0]),
  ];
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    bones.push(
      B('shoulder' + s, 'chest', D.clav, [0, D.clavUp, 0], [sx, 0, 0]),
      B('upperArm' + s, 'shoulder' + s, D.upperArm, [sx * D.clav, 0, 0], DOWN, BACK),
      B('forearm' + s, 'upperArm' + s, D.foreArm, [0, -D.upperArm, 0], DOWN, BACK),
      B('hand' + s, 'forearm' + s, D.hand, [0, -D.foreArm, 0], DOWN, BACK),
    );
  }
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    bones.push(
      B('thigh' + s, 'pelvis', D.thigh, [sx * D.hipHalf, 0, 0], DOWN),
      B('shin' + s, 'thigh' + s, D.shin, [0, -D.thigh, 0], DOWN),
      B('foot' + s, 'shin' + s, D.foot, [0, -D.shin, 0], FWD, UP),
    );
  }
  const index = {}; bones.forEach((b, i) => { index[b.name] = i; });
  const pose = {};
  for (const b of bones) pose[b.name] = { p: [0, 0, 0], t: [0, 0, 0], q: [0, 0, 0, 1], lq: [0, 0, 0, 1] };
  const sk = { bones, index, pose, root: { pos: [0, 0, 0], yaw: 0 }, diag: {}, _ik: { thighL: makeIKOut(), thighR: makeIKOut(), upperArmL: makeIKOut(), upperArmR: makeIKOut() } };
  return sk;
}

// Rig = parámetros de alto nivel -> pose completa (FK de columna + IK de brazos y piernas).
//  rig = { root:{pos,yaw}, pelvisPos:[x,y,z] mundo, hipYaw,hipPitch,hipRoll (rel. a root.yaw), spYaw,spPitch,spRoll (pecho vs pelvis),
//          hdYaw,hdPitch,hdRoll (cabeza vs pecho), arms:{L:{wrist,pole,shrug,prot}, R:{...}},
//          legs:{L:{ankle,pole,footYaw,footPitch}, R:{...}} }  — footYaw es MUNDO (absoluto).
const _t1 = [0, 0, 0], _t2 = [0, 0, 0];
export function solveRig(sk, rig) {
  const P = sk.pose, D = DIM, b = sk.bones;
  const yaw = rig.root.yaw;
  sk.root.pos[0] = rig.root.pos[0]; sk.root.pos[1] = rig.root.pos[1]; sk.root.pos[2] = rig.root.pos[2]; sk.root.yaw = yaw;
  // --- columna (FK) ---
  const qPel = qFromYPR(yaw + rig.hipYaw, rig.hipPitch, rig.hipRoll);
  const qSpine = qMul(qPel, qFromYPR(0.4 * rig.spYaw, 0.4 * rig.spPitch, 0.4 * rig.spRoll));
  const qChest = qMul(qSpine, qFromYPR(0.6 * rig.spYaw, 0.6 * rig.spPitch, 0.6 * rig.spRoll));
  const qNeck = qMul(qChest, qFromYPR(0.4 * rig.hdYaw, 0.4 * rig.hdPitch, 0.4 * rig.hdRoll));
  const qHead = qMul(qNeck, qFromYPR(0.6 * rig.hdYaw, 0.6 * rig.hdPitch, 0.6 * rig.hdRoll));
  const set = (name, p, t, q) => { const e = P[name]; copy(p, e.p); copy(t, e.t); copyQ(q, e.q); };
  const pelP = copy(rig.pelvisPos, [0, 0, 0]);
  const spineP = add(pelP, qRot(qPel, [0, D.pelvis, 0]));
  const chestP = add(spineP, qRot(qSpine, [0, D.spine, 0]));
  const neckP = add(chestP, qRot(qChest, [0, D.chest, 0]));
  const headP = add(neckP, qRot(qNeck, [0, D.neck, 0]));
  const headT = add(headP, qRot(qHead, [0, D.head, 0]));
  set('pelvis', pelP, spineP, qPel); set('spine', spineP, chestP, qSpine); set('chest', chestP, neckP, qChest);
  set('neck', neckP, headP, qNeck); set('head', headP, headT, qHead);
  const chestYaw = [0, 0, 0, 1];  // yaw mundo del pecho (para orientar polos)
  { const f = qRot(qChest, [0, 0, 1]); qAxisAngle([0, 1, 0], Math.atan2(f[0], f[2]), chestYaw); }
  sk.diag.chestYaw = Math.atan2(qRot(qChest, [0, 0, 1])[0], qRot(qChest, [0, 0, 1])[2]);

  // --- brazos ---
  const clavP = add(chestP, qRot(qChest, [0, D.clavUp, 0]));
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    const a = rig.arms[s];
    const qClav = qMul(qChest, qMul(qAxisAngle([0, 0, 1], sx * a.shrug), qAxisAngle([0, 1, 0], -sx * a.prot)));
    const shoulder = add(clavP, qRot(qClav, [sx * D.clav, 0, 0]));
    set('shoulder' + s, clavP, shoulder, qClav);
    const wrist = a.rel ? add(shoulder, qRot(qFromYPR(yaw, 0, 0), a.rel), [0, 0, 0]) : a.wrist;
    const ik = solveTwoBone(shoulder, wrist, D.upperArm, D.foreArm, qRot(chestYaw, a.pole, _t1), sk._ik['upperArm' + s], sk.diag['bendA' + s]);
    sk.diag['bendA' + s] = ik.bend.slice();
    const dirU = norm(addScaled(ik.mid, shoulder, -1, [0, 0, 0])), dirF = norm(addScaled(ik.end, ik.mid, -1, [0, 0, 0]));
    const hintArm = [ik.bend[0], ik.bend[1], ik.bend[2]];   // dirección hacia la que dobla el codo (reposo: -Z)
    const wristP = ik.end;
    const handT = addScaled(wristP, dirF, D.hand, [0, 0, 0]);
    const ua = b[sk.index['upperArm' + s]], fa = b[sk.index['forearm' + s]], ha = b[sk.index['hand' + s]];
    set('upperArm' + s, shoulder, ik.mid, qBone(ua.restDir, ua.restHint, dirU, hintArm));
    set('forearm' + s, ik.mid, wristP, qBone(fa.restDir, fa.restHint, dirF, hintArm));
    set('hand' + s, wristP, handT, qBone(ha.restDir, ha.restHint, dirF, hintArm));
    sk.diag['elbow' + s] = ik; sk.diag['armReached' + s] = ik.reached;
  }
  // --- piernas ---
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    const l = rig.legs[s];
    const hip = add(pelP, qRot(qPel, [sx * D.hipHalf, 0, 0]));
    const ik = solveTwoBone(hip, l.ankle, D.thigh, D.shin, l.pole, sk._ik['thigh' + s], sk.diag['bendL' + s]);
    sk.diag['bendL' + s] = ik.bend.slice();
    const dirT = norm(addScaled(ik.mid, hip, -1, [0, 0, 0])), dirS = norm(addScaled(ik.end, ik.mid, -1, [0, 0, 0]));
    const ta = b[sk.index['thigh' + s]], sa = b[sk.index['shin' + s]];
    const qFoot = qFromYPR(l.footYaw, 0, 0); const qFoot2 = qMul(qFoot, qAxisAngle([1, 0, 0], -l.footPitch));
    const ankle = ik.end, toe = add(ankle, qRot(qFoot2, [0, 0, D.foot]));
    const hintLeg = [ik.bend[0], ik.bend[1], ik.bend[2]];
    set('thigh' + s, hip, ik.mid, qBone(ta.restDir, ta.restHint, dirT, hintLeg));
    set('shin' + s, ik.mid, ankle, qBone(sa.restDir, sa.restHint, dirS, hintLeg));
    set('foot' + s, ankle, toe, qFoot2);
    sk.diag['knee' + s] = ik; sk.diag['legReached' + s] = ik.reached; sk.diag['hip' + s] = hip;
  }
  // --- rotaciones locales ---
  for (const bn of b) {
    const e = P[bn.name];
    if (!bn.parent) copyQ(e.q, e.lq); else qMul(qConj(P[bn.parent].q), e.q, e.lq);
  }
  return sk;
}
