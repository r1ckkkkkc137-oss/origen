// API pública de Combate para ORIGEN (src/combat/). El resto del juego importa SÓLO de acá.
//   Núcleo KAGE (determinista por seed, 60 Hz): createFight / stepFight / tickFight / simulateFight / replayFight / getResult.
//   Geometría: opts.geometry = undefined|'2d' (KAGE exacto) | '3d' | { kind:'3d', skeleton, boneMap, blockM } (ver geometry.js).
//   Eventos: createCombatTranslator() -> CombatEvent del contrato (events.js).
export * from './core/index.js';
export { createGeometry, createGeometry2D, createGeometry3D } from './geometry.js';
export { BLOCK_M, yawFromHeading, headingFromYaw } from './geometry3d.js';
export { HUMAN_PARENT, KAGE_TO_HUMAN, HUMAN_ONLY, KAGE_UNMAPPED, ZONE_OF, restPose, proceduralPose } from './pose.js';
export { createCombatTranslator, KAGE_TO_COMBAT, UNMAPPED } from './events.js';
