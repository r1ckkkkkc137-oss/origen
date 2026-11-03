// Subconjunto VERBATIM de los contratos de KAGE (f40b47d) que usa el núcleo de combate portado.
// El contrato de ORIGEN vive en src/shared/contracts.js (dueño: Motor); este archivo NO lo reemplaza: son los
// nombres/valores de KAGE que el núcleo y sus tests de paridad necesitan tal cual (px, ACTIONS de anim 2D, FIGHT_EVENTS).

export const JOINTS = [
  'pelvis', 'spine', 'neck', 'head',
  'shoulderL', 'elbowL', 'handL',
  'shoulderR', 'elbowR', 'handR',
  'hipL', 'kneeL', 'footL',
  'hipR', 'kneeR', 'footR',
];


export function emptyPose() {
  const p = {};
  for (const j of JOINTS) p[j] = { x: 0, y: 0 };
  return p;
}


export const FIGHT_EVENTS = Object.freeze({
  STRIKE: 'strike', BLOCK: 'block', HIT: 'hit', DODGE: 'dodge',
  KO: 'ko', TAKEDOWN: 'takedown', GET_UP: 'getUp',
  // v2 (aditivo). PARRY/WHIFF pedidos por coordinación; el resto = FIGHT_EVENTS_EXT de src/fight/events.js
  // con los MISMOS strings (así ALL_EVENT_TYPES de Combate no cambia).
  PARRY: 'parry',             // desvío activo (abre contra)
  WHIFF: 'whiff',             // golpe al aire (fuera de rango / esquivado sin contacto)
  ACTION: 'action',           // inicio de un movimiento no-golpe (shoot, entrada a clinch...): lo emite src/fight/core.js
  FEINT: 'feint', CHECK: 'check', CATCH: 'catch',
  CLINCH: 'clinch', BREAK: 'break', SPRAWL: 'sprawl',
  KNOCKDOWN: 'knockdown', ROCKED: 'rocked',
  POSITION: 'position', SWEEP: 'sweep',
  SUB_ATTEMPT: 'subAttempt', SUB_ESCAPE: 'subEscape', SUBMISSION: 'submission', TAP: 'tap',  // SUBMISSION: resolución Ronda 17 {move,phase,pressure,result}
  STOPPAGE: 'stoppage', ROUND_START: 'roundStart', ROUND_END: 'roundEnd',
  DECISION: 'decision', FIGHT_END: 'fightEnd',
});


export const TICK_RATE = 60;

export const UNITS = Object.freeze({
  PX_PER_M: 85,           // stickman de ~1.75 m ≈ 150 px
  ARENA_HALF_WIDTH: 260,  // arena = 520 px ≈ 6.1 m
  FIGHTER_HEIGHT: 150,    // alto aprox. pies→cabeza de una pose en guardia
  FLOOR_Y: 0,
  FLOOR_Y_RATIO: 0.72,    // fracción del alto de pantalla donde Engine pone el piso (view.floorY)
});

export const ACTIONS = Object.freeze({
  IDLE: 'idle', WALK: 'walk', GUARD: 'guard',
  JAB: 'jab', CROSS: 'cross', KICK: 'kick',
  HIT: 'hit', BLOCK: 'block', DODGE: 'dodge',
  KO: 'ko', VICTORY: 'victory', EAT: 'eat', TRAIN: 'train',
  // v2 (aditivo): grappling y suelo. Si anim no tiene clip, Engine mapea al más cercano (src/engine/adapters.js).
  CLINCH: 'clinch', SHOOT: 'shoot', SPRAWL: 'sprawl',
  GROUND_TOP: 'groundTop', GROUND_BOTTOM: 'groundBottom', GET_UP: 'getUp',
  FEINT: 'feint', SUB: 'sub',
  // v3 (aditivo, 2026-10-26, acción Dormir de la sala; solo el rig de la mascota, nunca en pelea). Contrato de Animador:
  // Engine manda SLEEP directo (de pie, anim se acuesta solo con lieDown y encadena el loop; ya acostado sigue en loop;
  // intent.instant => directo al loop, p. ej. save cargado durmiendo) -> WAKE_UP (despertar normal: auto en 100 o tras
  // >= 10 min) o WAKE_STARTLED (despertado antes de 10 min, baja el ánimo), que Engine sigue mandando mientras
  // contacts.sleep.phase === 'waking' (tope 4 s; ~1.5 s sin contacts) -> IDLE. anim expone contacts.sleep =
  // { phase: 'lying'|'asleep'|'waking', t } | null. Si anim no tiene el clip (CLIP_NAMES), Engine cae a 'idle'.
  /** Acostarse (one-shot; anim lo usa solo al recibir SLEEP de pie, Engine no necesita mandarlo). */
  LIE_DOWN: 'lieDown',
  /** Dormido, respiración lenta (loop). */
  SLEEP: 'sleep',
  /** Despertar descansado: incorporarse + estirarse (one-shot ~1.5 s). */
  WAKE_UP: 'wakeUp',
  /** Despertar de golpe (sobresalto, one-shot ~1.0 s). */
  WAKE_STARTLED: 'wakeStartled',
});

