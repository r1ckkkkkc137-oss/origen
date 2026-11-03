// Nombres y jerarquía EXACTOS del contrato (src/shared/contracts.js HUMAN_BONES, 17 huesos/joints).
export const HUMAN_BONES_LOCAL = Object.freeze([
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
  'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR',
]);
export const HUMAN_PARENT = Object.freeze({
  pelvis: null, spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', elbowL: 'shoulderL', handL: 'elbowL',
  shoulderR: 'chest', elbowR: 'shoulderR', handR: 'elbowR',
  hipL: 'pelvis', kneeL: 'hipL', footL: 'kneeL',
  hipR: 'pelvis', kneeR: 'hipR', footR: 'kneeR',
});
