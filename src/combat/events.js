// Traductor delgado FIGHT_EVENTS de KAGE -> CombatEvent del contrato de ORIGEN (src/shared/contracts.js).
// NO toca la sim: es una función pura sobre los eventos que ya emite el núcleo (stepFight/simulateFight).
//
//   CombatEvent = { type, tick, attacker?:number, target?:number, action?, zone?, damage?, point?:[x,y,z] }
//   type ∈ COMBAT_EVENT = actionStart | hit | block | dodge | miss | knockdown | getUp | submission | injury | ko
//
// attacker/target son índices numéricos (default a=0, b=1; ids = {a, b} para usar ids de Creature).
// `point` (sólo hit/block y sólo con Geometry3D) = contactPoint de la geometría en el estado ACTUAL de F: llamar al traductor
// justo después de cada stepFight (con F = fight.core). Es presentación; no afecta nada de la sim.
// Cada CombatEvent lleva además `src` = tipo KAGE de origen (campo extra, para depurar/VFX finos).
import { COMBAT_EVENT } from '../shared/contracts.js';
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
});
/** Eventos KAGE sin equivalente en CombatEvent v0.1 (se descartan en el traductor; siguen en el stream KAGE). */
export const UNMAPPED = Object.freeze([
  X.CLINCH, X.BREAK, X.SPRAWL, X.ROCKED, X.POSITION, X.SWEEP, X.SUB_ESCAPE, X.STOPPAGE,
  X.ROUND_START, X.ROUND_END, X.DECISION, X.FIGHT_END,
]);

/**
 * @param {{ids?:{a:number,b:number}}} [opt]
 * @returns {{translate:(ev:object, F?:object)=>object[]}}  translate devuelve 0..2 CombatEvents (hit con `injury` agrega un INJURY).
 */
export function createCombatTranslator(opt = {}) {
  const ids = opt.ids ?? { a: 0, b: 1 };
  const CE = COMBAT_EVENT ?? {};
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
      if (type === 'submission') out.result = ev.result ?? 'attempt';
      if ((type === 'hit' || type === 'block') && F && F.geo && F.geo.units === 'block' && ev.attacker && ev.defender) {
        const mv = MOVES[ev.move];
        const p = mv && F.byId?.[ev.attacker] && F.byId?.[ev.defender] ? F.geo.contactPoint(F.byId[ev.attacker], F.byId[ev.defender], mv) : null;
        if (p) out.point = p;
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
