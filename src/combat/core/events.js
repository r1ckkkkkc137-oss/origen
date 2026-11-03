// Eventos de pelea. Los del contrato (src/shared/contracts.js) se reexportan tal cual;
// FIGHT_EVENTS_EXT es una PROPUESTA de extensión (ver src/fight/README.md). No editar contracts.js desde aquí.
import { FIGHT_EVENTS } from '../kage-contracts.js';

export { FIGHT_EVENTS };

export const FIGHT_EVENTS_EXT = Object.freeze({
  WHIFF: 'whiff',             // golpe al aire: { kind:'miss'|'short' } (fallo o fuera de rango)
  PARRY: 'parry',             // desvío técnico de un recto (abre contragolpe)
  ACTION: 'action',           // inicio de acción no-golpe (derribo, clinch, pase, raspada...) con timings
  FEINT: 'feint',             // amago: { attacker, defender, move, bit:boolean }
  CHECK: 'check',             // patada baja chequeada con la canilla
  CATCH: 'catch',             // patada atrapada (puede derivar en derribo)
  CLINCH: 'clinch',           // entrada al clinch { attacker, defender, move }
  BREAK: 'break',             // se separan (clinch roto / árbitro / se levantan)
  SPRAWL: 'sprawl',           // derribo defendido
  KNOCKDOWN: 'knockdown',     // cae pero no es KO { defender, move, getUpIn }
  ROCKED: 'rocked',           // aturdido (piernas de goma) { defender, ticks }
  POSITION: 'position',       // cambio de posición en suelo { top, bottom, pos }
  SWEEP: 'sweep',             // raspada: el de abajo queda arriba
  SUB_ATTEMPT: 'subAttempt',  // intento de sumisión { attacker, defender, move } (move = id de clip Animador)
  SUB_ESCAPE: 'subEscape',    // escapa de la sumisión
  SUBMISSION: 'submission',   // resolución: { attacker, defender, move, phase, pressure, result:'tap'|'break'|'escape' }
  TAP: 'tap',                 // rendición => fin por sumisión (mantener; Break si trae injury)
  STOPPAGE: 'stoppage',       // el árbitro detiene (TKO) { defender, reason }
  ROUND_START: 'roundStart',
  ROUND_END: 'roundEnd',      // { round, scores }
  DECISION: 'decision',       // { winner, cards, kind:'UD'|'SD'|'MD'|'DRAW' }
  FIGHT_END: 'fightEnd',      // { result }
});

export const ALL_EVENT_TYPES = Object.freeze(new Set([...Object.values(FIGHT_EVENTS), ...Object.values(FIGHT_EVENTS_EXT)]));
