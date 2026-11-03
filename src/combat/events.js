// Traductor delgado FIGHT_EVENTS de KAGE -> CombatEvent del contrato de ORIGEN (src/shared/contracts.js).
// NO toca la sim: es una función pura sobre los eventos que ya emite el núcleo (stepFight/simulateFight).
//
//   CombatEvent = { type, tick, attacker?:number, target?:number, action?, zone?, damage?, point?:[x,y,z] (bloques), src?, result? }
//   type ∈ COMBAT_EVENT (contracts v0.3): los 22 tipos; NINGÚN tipo KAGE se descarta (UNMAPPED = []).
//
// attacker/target son índices numéricos (default a=0, b=1; ids = {a, b} para usar ids de Creature).
// `point` (sólo hit/block y sólo con Geometry3D; coords MUNDO en bloques) = contactPoint de la geometría en el estado ACTUAL de F: llamar al traductor
// justo después de cada stepFight (con F = fight.core). Es presentación; no afecta nada de la sim.
// Cada CombatEvent lleva además `src` = tipo KAGE de origen (campo extra, para depurar/VFX finos).
import { MOVES } from './data/moves.js';
import { FIGHT_EVENTS, FIGHT_EVENTS_EXT as X, ALL_EVENT_TYPES } from './core/events.js';

// Tipo KAGE -> tipo CombatEvent (los que no están acá: ver UNMAPPED).
export const KAGE_TO_COMBAT = Object.freeze({
  [FIGHT_EVENTS.STRIKE]: 'actionStart',   // golpe iniciado (phase/startup/active/recovery en el evento KAGE)
  [X.ACTION]: 'actionStart',              // inicio de acción no-golpe (derribo, clinch, pase, raspada...)
  [X.FEINT]: 'actionStart',               // amago (se anima como inicio de acción)
  [FIGHT_EVENTS.HIT]: 'hit',
  [FIGHT_EVENTS.BLOCK]: 'block',
  [X.PARRY]: 'block',                     // desvío activo = defensa con contacto
  [X.CHECK]: 'block',                     // patada baja chequeada con la canilla
  [X.CATCH]: 'block',                     // patada atrapada
  [FIGHT_EVENTS.DODGE]: 'dodge',
  [X.WHIFF]: 'miss',                      // golpe al aire (kind:'miss'|'short')
  [X.KNOCKDOWN]: 'knockdown',
  [FIGHT_EVENTS.TAKEDOWN]: 'knockdown',   // derribo consumado: el defensor queda en el piso
  [FIGHT_EVENTS.GET_UP]: 'getUp',
  [X.SUBMISSION]: 'submission',           // resolución {result:'tap'|'break'|'escape'}
  [X.SUB_ATTEMPT]: 'submission',          // intento (result queda 'attempt')
  [X.TAP]: 'submission',
  [FIGHT_EVENTS.KO]: 'ko',
  // contrato v0.2c+: antes descartados
  [X.CLINCH]: 'clinch',                   // entrada al clinch (action = kind)
  [X.BREAK]: 'break',                     // se separan (result = 'break'|'referee')
  [X.SPRAWL]: 'sprawl',                   // derribo defendido
  [X.ROCKED]: 'rocked',                   // aturdido (target = el aturdido)
  [X.POSITION]: 'position',               // cambio de posición en suelo (attacker = arriba, target = abajo, action = posición)
  [X.SWEEP]: 'sweep',                     // raspada
  [X.SUB_ESCAPE]: 'subEscape',            // escapa de la sumisión
  [X.STOPPAGE]: 'stoppage',               // el árbitro detiene (result = motivo)
  [X.ROUND_START]: 'roundStart',
  [X.ROUND_END]: 'roundEnd',
  [X.DECISION]: 'decision',               // attacker = ganador, result = 'UD'|'SD'|'MD'|'DRAW'
  [X.FIGHT_END]: 'fightEnd',              // attacker = ganador, result = método ('KO'|'TKO'|'SUB'|'DEC'...)
});
/** Eventos KAGE sin equivalente en CombatEvent: ninguno desde contratos v0.2c (se conserva el export; test: debe ser vacío). */
export const UNMAPPED = Object.freeze(
  [...ALL_EVENT_TYPES].filter((t) => !(t in KAGE_TO_COMBAT)),
);

/**
 * @param {{ids?:{a:number,b:number}}} [opt]
 * @returns {{translate:(ev:object, F?:object)=>object[]}}  translate devuelve 0..2 CombatEvents (hit con `injury` agrega un INJURY).
 */
export function createCombatTranslator(opt = {}) {
  const ids = opt.ids ?? { a: 0, b: 1 };
  return {
    translate(ev, F) {
      const type = KAGE_TO_COMBAT[ev.type];
      if (!type) return [];
      const out = { type, tick: ev.tick, src: ev.type };
      if (ev.attacker != null) out.attacker = ids[ev.attacker];
      if (ev.defender != null) out.target = ids[ev.defender];
      if (type === 'getUp' && ev.attacker != null) { delete out.attacker; out.target = ids[ev.attacker]; } // KAGE: attacker = el que se levanta
      if (ev.move) out.action = ev.move;
      const zone = ev.target ?? ev.koZone;
      if (zone && ev.type !== 'getUp') out.zone = zone;
      if (ev.damage != null) out.damage = ev.damage;
      if (type === 'submission') out.result = ev.result ?? (ev.type === X.TAP ? 'tap' : 'attempt');
      switch (ev.type) {
        case X.CLINCH: if (!out.action && ev.kind) out.action = ev.kind; break;
        case X.BREAK: case X.STOPPAGE: if (ev.reason) out.result = ev.reason; break;
        case X.POSITION: if (ev.top != null) out.attacker = ids[ev.top]; if (ev.bottom != null) out.target = ids[ev.bottom]; if (ev.pos) out.action = ev.pos; break;
        case X.SUB_ESCAPE: out.result = 'escape'; break;
        case X.DECISION: if (ev.winner != null) out.attacker = ids[ev.winner]; if (ev.kind) out.result = ev.kind; break;
        case X.FIGHT_END: if (ev.result?.winner != null) out.attacker = ids[ev.result.winner]; if (ev.result?.method) out.result = ev.result.method; break;
        default: break;
      }
      if ((type === 'hit' || type === 'block') && F && F.geo && F.geo.units === 'm' && ev.attacker && ev.defender) {
        const mv = MOVES[ev.move];
        const p = mv && F.byId?.[ev.attacker] && F.byId?.[ev.defender] ? F.geo.contactPoint(F.byId[ev.attacker], F.byId[ev.defender], mv) : null;
        if (p) out.point = F.geo.toBlocks(p);   // CombatEvent.point = MUNDO en bloques
      }
      const res = [out];
      if (ev.type === FIGHT_EVENTS.HIT && ev.injury) res.push({ type: 'injury', tick: ev.tick, target: ids[ev.defender], zone: ev.injury.part, action: ev.injury.kind, src: ev.type });
      return res;
    },
    /** Todos los CombatEvents de una lista de eventos KAGE (sin point: no hay F en diferido). */
    translateAll(evs) { return evs.flatMap((e) => this.translate(e)); },
  };
}
export { ALL_EVENT_TYPES };
