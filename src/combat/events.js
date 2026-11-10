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
/**
 * Miembro de la guardia del que DEFIENDE en un evento block (contrato anim-r7: guard {limb, side}).
 * Todos en guardia ortodoxa: lo que el atacante lanza con su lado L entra por el lado R del rival (espejo), y al revés.
 * - check / patada a las piernas: espinilla. catch: guante (el pie se atrapa con la mano). parry: guante.
 * - recto o uppercut a la cabeza: guante. Hook, overhand, giro a la cabeza: antebrazo (earmuff). Al cuerpo: antebrazo (codo cerrado).
 * - patada media o alta: antebrazo del lado por donde entra.
 */
export function guardOf(ev) {
  const mv = MOVES[ev.move];
  if (!mv) return null;
  const side = String(mv.limb ?? '').endsWith('L') ? 'R' : 'L';
  if (ev.type === X.CATCH || ev.type === X.PARRY) return { limb: 'glove', side };
  if (ev.type === X.CHECK || mv.zone === 'legs') return { limb: 'shin', side };
  if (mv.zone === 'head' && (mv.arc === 'straight' || mv.arc === 'upper') && String(mv.limb).startsWith('hand')) return { limb: 'glove', side };
  return { limb: 'forearm', side };
}

/**
 * Defensa VISIBLE que explica un fallo por precisión (whiff kind 'miss'), para que ningún golpe falle "al aire" (orden de Rick, 2026-11-10).
 * Determinista: depende sólo del golpe y del estilo del que defiende. side = lado hacia el que se mueve la cabeza o la mano del que defiende
 * (fuera de la línea del golpe: espejo del miembro que golpea, como guardOf).
 * - jab -> parry (la mano de atrás lo desvía).
 * - rectos y golpes por encima (cross, overhand, superman, codos, gnp a la cabeza) -> slip.
 * - hook o giro a la cabeza (hook, clinchElbow, backfist) -> roll (agacharse por debajo).
 * - uppercut y patada alta -> pull (echar la cabeza atrás).
 * - al cuerpo o a las piernas (bodyHook, bodyCross, bodyKick, teep, lowKick, calfKick, rodillas): pull (cadera o pierna atrás);
 *   muayThai y kickboxer desvían con la mano lo que va al cuerpo de frente (teep, bodyCross, gnpBody) -> parry.
 * @returns {{kind:'slip'|'roll'|'pull'|'parry', side:'L'|'R'}|null}
 */
export function evadeOf(ev, styleId) {
  if (ev.type !== X.WHIFF || ev.kind !== 'miss') return null;
  const mv = MOVES[ev.move]; if (!mv) return null;
  const limb = mv.limb || ev.limb || '';
  const side = limb.endsWith('L') ? 'R' : 'L';
  const zone = mv.zone ?? ev.target;
  const handFighter = styleId === 'muayThai' || styleId === 'kickboxer';
  let kind;
  if (mv.id === 'jab') kind = 'parry';
  else if (mv.id === 'uppercut' || mv.id === 'dirtyUppercut' || mv.id === 'highKick') kind = 'pull';
  else if (zone === 'head') kind = mv.arc === 'hook' || mv.arc === 'spin' ? 'roll' : mv.arc === 'knee' ? 'pull' : 'slip';
  else kind = handFighter && (mv.arc === 'push' || mv.arc === 'straight' || mv.arc === 'over') ? 'parry' : 'pull';
  return { kind, side };
}

export function createCombatTranslator(opt = {}) {
  const ids = opt.ids ?? { a: 0, b: 1 };
  // Patada atrapada: la sim decide en el MISMO tick (onCatch) si derriba (TAKEDOWN move 'kickCatch') o suelta (A.action = null, sin evento).
  // El traductor guarda la atrapada y, al cerrar el tick (endTick), si no hubo derribo emite `release` (catcher = attacker, pateador = target).
  let pendCatch = null;
  const endTick = () => {
    const c = pendCatch; pendCatch = null;
    if (!c) return [];
    const r = { type: 'release', tick: c.tick, src: 'catch', result: 'release' };
    if (c.round != null) r.round = c.round;
    if (c.attacker != null) r.attacker = c.attacker;   // el que atrapó
    if (c.target != null) r.target = c.target;         // el pateador
    if (c.action) r.action = c.action;                 // la patada atrapada
    return [r];
  };
  return {
    /** Cierra el tick: devuelve 0..1 CombatEvent `release` (patada atrapada soltada sin derribo). Llamar tras traducir todos los eventos de un stepFight. */
    endTick,
    translate(ev, F) {
      const type = KAGE_TO_COMBAT[ev.type];
      if (!type) return [];
      if (pendCatch && ev.tick !== pendCatch.tick) pendCatch = null;   // tick viejo sin endTick: se descarta (no inventa nada)
      const out = { type, tick: ev.tick, src: ev.type };
      if (ev.round != null) out.round = ev.round;   // contrato v0.4: round (1-based) del evento
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
      if (type === 'block') { const g = guardOf(ev); if (g) out.guard = g; }
      if (type === 'miss') { const e = evadeOf(ev, F?.byId?.[ev.defender]?.style?.id); if (e) out.evade = e; }   // fallo por precisión: defensa visible
      if ((type === 'hit' || type === 'block') && F && F.geo && F.geo.units === 'm' && ev.attacker && ev.defender) {
        const mv = MOVES[ev.move];
        const p = mv && F.byId?.[ev.attacker] && F.byId?.[ev.defender] ? F.geo.contactPoint(F.byId[ev.attacker], F.byId[ev.defender], mv) : null;
        if (p) out.point = F.geo.toBlocks(p);   // CombatEvent.point = MUNDO en bloques
      }
      if (ev.type === X.CATCH) pendCatch = { tick: ev.tick, round: out.round, attacker: ids[ev.defender], target: ids[ev.attacker], action: out.action };
      if (ev.type === FIGHT_EVENTS.TAKEDOWN && ev.move === 'kickCatch') pendCatch = null;   // derribó: no hay suelta
      const res = [out];
      if (ev.type === FIGHT_EVENTS.HIT && ev.injury) res.push({ type: 'injury', tick: ev.tick, target: ids[ev.defender], zone: ev.injury.part, action: ev.injury.kind, src: ev.type });
      return res;
    },
    /** Todos los CombatEvents de una lista de eventos KAGE (sin point: no hay F en diferido). */
    translateAll(evs) {
      const res = [];
      for (let i = 0; i < evs.length; i++) {
        res.push(...this.translate(evs[i]));
        if (i === evs.length - 1 || evs[i + 1].tick !== evs[i].tick) res.push(...endTick());
      }
      return res;
    },
  };
}
export { ALL_EVENT_TYPES };
