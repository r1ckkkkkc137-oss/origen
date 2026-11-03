import * as THREE from 'three';
// Cuerpo de depuración (cápsulas) sobre un Skeleton3D. Placeholder hasta que Arte haga los modelos.
const SEG = [
  ['pelvis', 'spine', 0.075], ['spine', 'chest', 0.08], ['chest', 'neck', 0.085], ['neck', 'head', 0.04], ['head', 't.headTop', 0.095],
  ['neck', 'shoulderL', 0.04], ['shoulderL', 'elbowL', 0.045], ['elbowL', 'handL', 0.038], ['handL', 't.handL', 0.05],
  ['neck', 'shoulderR', 0.04], ['shoulderR', 'elbowR', 0.045], ['elbowR', 'handR', 0.038], ['handR', 't.handR', 0.05],
  ['pelvis', 'hipL', 0.06], ['hipL', 'kneeL', 0.065], ['kneeL', 'footL', 0.05], ['footL', 't.toeL', 0.04],
  ['pelvis', 'hipR', 0.06], ['hipR', 'kneeR', 0.065], ['kneeR', 'footR', 0.05], ['footR', 't.toeR', 0.04],
];
const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1), sph = new THREE.SphereGeometry(1, 10, 6), UP = new THREE.Vector3(0, 1, 0);
export function createHumanView(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const parts = SEG.map(([a, b, r]) => { const m = new THREE.Mesh(cyl, mat), s0 = new THREE.Mesh(sph, mat), s1 = new THREE.Mesh(sph, mat); group.add(m, s0, s1); return { a, b, r, m, s0, s1 }; });
  const A = new THREE.Vector3(), B = new THREE.Vector3(), D = new THREE.Vector3();
  const P = (sk, k) => (k.startsWith('t.') ? sk.tips[k.slice(2)] : sk.pose[k]);
  return {
    group,
    update(sk) {
      for (const p of parts) {
        A.fromArray(P(sk, p.a)); B.fromArray(P(sk, p.b)); D.subVectors(B, A); const L = Math.max(D.length(), 1e-4);
        p.m.position.copy(A).addScaledVector(D, 0.5); p.m.scale.set(p.r, L, p.r); p.m.quaternion.setFromUnitVectors(UP, D.normalize());
        p.s0.position.copy(A); p.s1.position.copy(B); p.s0.scale.setScalar(p.r); p.s1.scale.setScalar(p.r);
      }
    },
  };
}
