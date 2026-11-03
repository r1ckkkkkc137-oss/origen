// API pública de Combate (src/fight/). Envuelve el núcleo (core.js, de 880c4464) sin tocarlo.
//
//   createFight(p1, p2, seed, opts?)  -> fight            (p1 = 'a', p2 = 'b'; FighterSpec del contrato)
//   tickFight(fight, dt, input?)      -> FightFrame + { ticks, over }  avanza tiempo real (acumulador a TICK_RATE)
//   stepFight(fight, input?)          -> { tick, events }          avanza exactamente 1 tick
//   simulateFight(a, b, seed, opts?)  -> FightResult (contracts.js)  pura y determinista (+ inputs grabados)
//   replayFight(a, b, seed, inputs, opts?) -> FightResult        reproduce una pelea grabada (mismo resultado)
//   getResult(fight)                  -> FightResult parcial/final (lo acumulado hasta ahora, + inputs)
//
// Controladores (núcleo a119f83, controllers.js): opts.controllers = { a?, b? } con 'ai' | 'human' | objeto
// { decide, readP?, chooseDefense?, poll?, autoCounter? }. Atajo: opts.human = 'a'|'b'. El input humano
// { walk:-1|0|1, act:moveId|null, feint, block, slip } entra por tickFight/stepFight y se pasa al
// controlador con human.set() antes del tick; el núcleo graba cada cambio en F.inputs ([{t, side, intent}]).
//
// Unidades: px (arena ±260, centro 0), 60 ticks/s. Sin Math.random, sin canvas, sin DOM.
import { TICK_RATE } from '../kage-contracts.js';
import { createFightCore, stepCore, moveToAction, DEFAULT_TUNING } from './core.js';
import { FIGHT_EVENTS, FIGHT_EVENTS_EXT, ALL_EVENT_TYPES } from './events.js';
import { STYLES, STYLE_IDS } from '../data/styles.js';
import { MOVES } from '../data/moves.js';
import { mapStats, STYLE_ALIASES, RIVAL_STYLES, OVERRIDES, LOW_LEVEL_BOOST, fightLevel, lowLevelWeight } from './tuning.js';
import { styleFromStats } from './fighter.js';
import { createHumanController, createReplayController, AI_CONTROLLER, normIntent } from './controllers.js';

export { TICK_RATE, FIGHT_EVENTS, FIGHT_EVENTS_EXT, ALL_EVENT_TYPES, moveToAction, STYLE_IDS, RIVAL_STYLES };
export { createHumanController, createReplayController, AI_CONTROLLER, normIntent };

const DT = 1 / TICK_RATE;
/** Máximo de ticks que tickFight avanza por llamada (evita espiral si el frame se cuelga). */
export const MAX_STEPS_PER_CALL = 10;
/** Ticks que se siguen simulando tras el final (animar KO / victoria). */
export const TAIL_SECONDS = 2;

/**
 * Tuning efectivo = defaults del núcleo + OVERRIDES de tuning.js + refuerzo de nivel bajo (si se pasa level)
 * + opts.tuning (prioridad).
 */
export function effectiveTuning(extra = {}, level = null) {
  const boost = {};
  const w = level == null ? 0 : lowLevelWeight(level);
  if (w > 0) for (const [k, v] of Object.entries(LOW_LEVEL_BOOST)) boost[k] = Math.round(((OVERRIDES[k] ?? DEFAULT_TUNING[k]) + v * w) * 1e6) / 1e6;
  const o = { ...OVERRIDES, ...boost, ...extra };
  return {
    ...DEFAULT_TUNING, ...o,
    hitstop: { ...DEFAULT_TUNING.hitstop, ...(OVERRIDES.hitstop ?? {}), ...(extra.hitstop ?? {}) },
    windows: { ...DEFAULT_TUNING.windows, ...(OVERRIDES.windows ?? {}), ...(extra.windows ?? {}) },
  };
}

/** Resuelve el estilo de un spec: id válido, alias ('mixto', 'grappler', ...) o derivado de stats. */
export function resolveStyle(spec = {}) {
  const raw = spec.style;
  if (raw && STYLES[raw]) return raw;
  if (typeof raw === 'string') {
    const al = STYLE_ALIASES[raw] ?? STYLE_ALIASES[raw.toLowerCase()];
    if (al && STYLES[al]) return al;
  }
  return styleFromStats(spec.stats ?? {});
}

/** FighterSpec (4 o 7 stats) -> spec que el núcleo acepta, con las 7 stats explícitas. Puro. */
export function toCoreSpec(spec = {}, fallbackId = 'x') {
  const style = resolveStyle(spec);
  return {
    id: spec.id ?? fallbackId, name: spec.name ?? 'Stickman', level: spec.level ?? 1, color: spec.color,
    condition: spec.condition ?? 1, seed: spec.seed, style,
    stats: mapStats(spec.stats ?? {}, style, spec.extra ?? {}),
  };
}

const SIDES = ['a', 'b'];

/** Controladores por lado: 'ai' | 'human' | objeto | null. 'human' se crea acá para poder hacerle set(). */
function buildControllers(opts) {
  const spec = { ...(opts.controllers ?? {}) };
  if (opts.human === 'a' || opts.human === 'b') spec[opts.human] = spec[opts.human] ?? 'human';
  if (opts.replay) for (const side of SIDES) if (opts.replay.some((r) => r.side === side)) spec[side] = createReplayController(opts.replay, side, { assist: opts.assist ?? true });
  const ctl = {}, humans = {}, kinds = {};
  for (const side of SIDES) {
    let c = spec[side];
    if (c === 'human') c = createHumanController({ assist: opts.assist ?? true });
    ctl[side] = c && c !== 'ai' ? c : 'ai';
    humans[side] = c && typeof c === 'object' && typeof c.set === 'function' ? c : null;
    kinds[side] = ctl[side] === 'ai' ? 'ai' : c.kind ?? 'custom';
  }
  return { ctl, humans, kinds };
}

/**
 * Crea una pelea. p1 juega como 'a' (izquierda, mira a +x), p2 como 'b'.
 * opts: { controllers?: {a?, b?}, human?: 'a'|'b', assist?: bool (default true: en suelo/clinch decide la IA),
 *         replay?: inputs grabados, tuning?: overrides extra, tailSeconds?, record? }
 */
export function createFight(p1, p2, seed = 1, opts = {}) {
  const sa = toCoreSpec(p1, 'a'), sb = toCoreSpec(p2, 'b');
  const { ctl, humans, kinds } = buildControllers(opts);
  const level = fightLevel(sa.stats, sb.stats);
  const core = createFightCore(sa, sb, seed >>> 0, { ...effectiveTuning(opts.tuning, level), controllers: ctl, geometry: opts.geometry });
  return {
    kind: 'kage-fight', seed: seed >>> 0, tickRate: TICK_RATE, core,
    specs: { a: sa, b: sb },
    tick: 0, acc: 0, time: 0,
    level, controllers: kinds, humans, assist: opts.assist ?? true,
    human: humans.a ? 'a' : humans.b ? 'b' : null, // lado que recibe un input "plano"
    tailTicks: Math.round((opts.tailSeconds ?? TAIL_SECONDS) * TICK_RATE),
    last: null, frame: null, done: false, over: false, // over = terminó la pelea (puede seguir la cola); done = cola terminada
    record: opts.record !== false, ticks: [], events: [],
  };
}

// ---- Input humano ---------------------------------------------------------
// input = intent { walk, act, feint, block, slip } para el lado humano por defecto, o { a?: intent, b?: intent }.
// Se entrega con human.set(): vale desde el próximo tick hasta que cambie; act/feint se consumen al usarse
// (mantener el botón = repetir). Sin input (undefined) se conserva el último. Un input para un lado sin
// controlador humano se ignora (ese lado lo juega la IA): fight.ignoredInputs cuenta esos casos.
function applyInput(fight, input) {
  if (input == null) return;
  const perSide = typeof input === 'object' && (typeof input.a === 'object' || typeof input.b === 'object');
  const pairs = perSide ? SIDES.filter((s) => input[s] != null).map((s) => [s, input[s]]) : [[fight.human, input]];
  for (const [side, intent] of pairs) {
    const h = side && fight.humans[side];
    if (h) h.set(intent);
    else fight.ignoredInputs = (fight.ignoredInputs ?? 0) + 1;
  }
}

// ---- Normalización de eventos al contrato ---------------------------------
// Contrato: actor = quien lo origina. Para las DEFENSAS (block/dodge/parry/check/catch/sprawl) Engine
// interpreta actor = el que defiende (flash de bloqueo en él). El núcleo pone actor = atacante en todos;
// acá se corrige para defensas. attacker/defender se conservan siempre.
const DEFENSIVE = new Set([FIGHT_EVENTS.BLOCK, FIGHT_EVENTS.DODGE, FIGHT_EVENTS_EXT.PARRY, FIGHT_EVENTS_EXT.CHECK, FIGHT_EVENTS_EXT.CATCH, FIGHT_EVENTS_EXT.SPRAWL]);
function normEvent(ev) {
  const out = { ...ev };
  if (DEFENSIVE.has(ev.type) && ev.defender) out.actor = ev.defender;
  if (out.actor === undefined) out.actor = null;
  return out;
}

/** Avanza exactamente un tick. */
export function stepFight(fight, input) {
  if (fight.done) return { tick: fight.last, events: [] };
  if (!fight.over) applyInput(fight, input);
  const F = fight.core;
  const { tick, events } = stepCore(F);
  const evs = events.map(normEvent);
  fight.last = tick;
  fight.tick = F.t;
  fight.time = F.t * DT;
  if (fight.record) { fight.ticks.push(tick); for (const e of evs) fight.events.push(e); }
  if (F.done && !fight.over) fight.over = true;
  if (fight.over && F.t > F.endT + fight.tailTicks) fight.done = true;
  return { tick, events: evs };
}

/**
 * Avanza `dt` segundos de tiempo real con paso fijo (acumulador). Máx MAX_STEPS_PER_CALL ticks por llamada.
 * input (opcional) se aplica en cada tick avanzado. Devuelve los ticks y eventos nuevos.
 */
export function tickFight(fight, dt, input) {
  const ticks = [], events = [];
  fight.acc += Math.max(0, Number.isFinite(dt) ? dt : 0);
  let n = 0;
  while (fight.acc >= DT - 1e-9 && n < MAX_STEPS_PER_CALL && !fight.done) {
    fight.acc -= DT; n++;
    const r = stepFight(fight, n === 1 ? input : undefined); // el input se entrega una vez por llamada (frame)
    ticks.push(r.tick);
    for (const e of r.events) events.push(e);
  }
  if (n >= MAX_STEPS_PER_CALL) fight.acc = Math.min(fight.acc, DT);
  // FightFrame del contrato (campos del último tick + eventos de esta llamada) y además ticks[] de la llamada.
  const r = fight.over ? fight.core.result : null;
  const frame = { ...(fight.last ?? {}), events, ticks, done: fight.done, over: fight.over };
  if (r) { frame.winner = r.winner; frame.reason = reasonOf(r.method); frame.method = r.method; }
  fight.frame = frame;
  return frame;
}

const reasonOf = (m) => (m === 'DEC' ? 'decision' : m === 'DRAW' ? 'draw' : 'ko');

/** FightResult del contrato (+ extras) con lo acumulado. inputs = cambios de input humano grabados por el núcleo. */
export function getResult(fight) {
  const F = fight.core;
  const r = F.result;
  const method = r ? r.method : null;
  const reason = r ? reasonOf(method) : null;
  return {
    seed: fight.seed, tickRate: TICK_RATE, ticks: fight.ticks, events: fight.events,
    winner: r ? r.winner : null, reason,
    // extras (no contractuales)
    method, detail: r ? r.detail : null, round: r ? r.round : null, endTick: r ? r.tick : null,
    cards: F.cards, stats: F.stats, styles: { a: fight.specs.a.style, b: fight.specs.b.style },
    fighters: { a: fight.specs.a, b: fight.specs.b },
    inputs: F.inputs.map((x) => ({ t: x.t, side: x.side, intent: { ...x.intent } })),
    controllers: { ...fight.controllers }, assist: fight.assist,
  };
}

/**
 * Pelea completa (IA vs IA por defecto). Pura y determinista: mismo (a, b, seed, opts) => mismo resultado.
 * opts (no contractual): { record:false } para tests rápidos (ticks vacíos), tuning, tailSeconds,
 * controllers (p. ej. createHumanController({ source }) con source determinista), replay.
 */
export function simulateFight(a, b, seed = 1, opts = {}) {
  const fight = createFight(a, b, seed, opts);
  const cap = fight.core.opt.maxTicks + fight.tailTicks + 10;
  while (!fight.done && fight.core.t < cap) stepFight(fight);
  return getResult(fight);
}

/**
 * Reproduce una pelea grabada: mismos (a, b, seed) + inputs de getResult/simulateFight => mismo resultado.
 * Los lados con inputs se reproducen con createReplayController; los demás los juega la IA.
 * opts.assist debe coincidir con la grabación (default: el de la grabación si se pasa el resultado entero).
 */
export function replayFight(a, b, seed, inputsOrResult, opts = {}) {
  const rec = Array.isArray(inputsOrResult) ? { inputs: inputsOrResult } : inputsOrResult ?? {};
  return simulateFight(a, b, seed, { ...opts, assist: opts.assist ?? rec.assist ?? true, replay: rec.inputs ?? [] });
}
