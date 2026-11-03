import * as THREE from 'three';
// Cuerpo de depuración (cápsulas) sobre un Skeleton3D, con InstancedMesh: 2 draw calls por humano. Placeholder hasta los modelos de Arte.
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
  const cyls = new THREE.InstancedMesh(cyl, mat, SEG.length), sphs = new THREE.InstancedMesh(sph, mat, SEG.length * 2);
  cyls.frustumCulled = sphs.frustumCulled = false; // instancias se mueven; bounding fijo engañaría al culling
  group.add(cyls, sphs);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), D = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), M = new THREE.Matrix4(), Q0 = new THREE.Quaternion();
  const P = (sk, k) => (k.startsWith('t.') ? sk.tips[k.slice(2)] : sk.pose[k]);
  return {
    group,
    update(sk) {
      SEG.forEach(([a, b, r], i) => {
        A.fromArray(P(sk, a)); B.fromArray(P(sk, b)); D.subVectors(B, A); const L = Math.max(D.length(), 1e-4);
        Q.setFromUnitVectors(UP, D.normalize());
        M.compose(S.copy(A).addScaledVector(D, L * 0.5), Q, D.set(r, L, r)); cyls.setMatrixAt(i, M);
        S.set(r, r, r); M.compose(A, Q0, S); sphs.setMatrixAt(i * 2, M); M.compose(B, Q0, S); sphs.setMatrixAt(i * 2 + 1, M);
      });
      cyls.instanceMatrix.needsUpdate = sphs.instanceMatrix.needsUpdate = true;
    },
  };
}
