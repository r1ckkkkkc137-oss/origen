// createLiveFight: pelea KAGE en vivo y determinista para el juego (Motor/main.js). Es un envoltorio de pelea/paso fijo sobre el núcleo:
//   - acumulador de paso fijo a 60 Hz: update(dtSeconds) avanza ticks enteros; MISMA seed => MISMA pelea sea cual sea el patrón de dt
//     (el resultado sólo depende de la cantidad de ticks, nunca del tiempo real). La parte fraccionaria se guarda (`alpha`) y se
//     usa para interpolar pos/yaw entre el tick anterior y el actual (render suave a cualquier fps).
//   - por peleador devuelve { id, side, pos:[x,y,z] METROS, yaw (contrato), state } con lo que necesita Animador (ver stateOf).
//   - devuelve los CombatEvents traducidos de este frame (con round/point) y un emisor `on(type, fn)`.
//   - `ground` (opcional) = predicado sólido de BLOQUES (world.solidAt): el origen se pega al suelo y pos[1] sigue el terreno
//     (sólo presentación: nada de esto vuelve a la sim).
// Unidades: pos/skeleton en METROS, origin y CombatEvent.point en BLOQUES (contracts v0.4).
import { BLOCK_M } from '../shared/contracts.js';
import { stepFight, getResult, TICK_RATE } from './core/index.js';
import { createFight } from './seeded.js';
import { createCombatTranslator } from './events.js';
import { resolveFightSeed } from './seed.js';
import { MOVES } from './data/moves.js';
import { findFightSpot, groundTopNear } from './spot.js';

const DT = 1 / TICK_RATE;
const SIDES = ['a', 'b'];
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return a + d * t; };
const r3 = (v) => Math.round(v * 1000) / 1000;

const DEFAULT_SPECS = [
  { id: 'a', name: 'Rojo', level: 50, style: 'boxer', stats: { fuerza: 55, velocidad: 55, tecnica: 55, resistencia: 55 } },
  { id: 'b', name: 'Azul', level: 50, style: 'kickboxer', stats: { fuerza: 55, velocidad: 55, tecnica: 55, resistencia: 55 } },
];

/**
 * Estado por peleador para Animador / HUD (se recalcula en cada update a partir del último tick de la sim).
 * @typedef {Object} LiveState
 * @property {string|null} move       id de movimiento en curso (MOVES) o null
 * @property {string|null} clip       clip KAGE sugerido (tick.animClip) y {animSeq} cambia cada vez que arranca uno
 * @property {'stand'|'clinch'|'groundTop'|'groundBottom'|'down'|'ko'|'victory'} stance
 * @property {'windup'|'active'|'recovery'|null} phase   fase del movimiento (startup→windup)
 * @property {number} progress        0..1 del movimiento completo; phaseProgress 0..1 dentro de la fase; moveSeconds: duración total (s); windupSeconds: duración del windup (s) hasta el impacto
 * @property {string|null} kind       strike|takedown|clinch|escape|advance|sub|sweep del movimiento; limb: handL|handR|footR|kneeR|...
 * @property {number} guard           0..1 (1 = manos arriba)
 * @property {boolean} onGround       en suelo (grappling o derribado)       position: 'top'|'bottom'|null + groundPos (guard|mount|...)
 * @property {{zone:string,age:number}|null} hurt  última zona golpeada y segundos desde el golpe (<= HURT_WINDOW) para reacciones
 * @property {boolean} rocked @property {boolean} down @property {boolean} ko  aturdido / en la lona / noqueado (resultado final)
 * @property {number} hp @property {number} stamina @property {number} fatigue @property {Object} damage  zonas 0..1
 * @property {{mode:string,speed:number}} loco   locomoción (tick.foot / animClip) y velocidad m/s (de la raíz)
 */
export const HURT_WINDOW = 0.6;

/**
 * @param {object} o
 * @param {object} [o.a] @param {object} [o.b]   FighterSpec (por defecto dos boxeadores de prueba)
 * @param {number|{worldSeed,x,y,z,salt?}|{worldSeed,encounterId,salt?}} [o.seed=1]
 * @param {[number,number,number]} [o.origin]    centro del ring en BLOQUES del mundo (por defecto: lugar de la seed, o [0,0,0])
 * @param {{a?:string,b?:string}} [o.styles]     estilos por lado (pisan spec.style)
 * @param {Function|{solidAt:Function,getBlock?:Function}} [o.ground]  solidAt-like en bloques: pega origin.y al suelo y sigue terreno
 * @param {{a:number,b:number}} [o.ids]          ids numéricos de los CombatEvents (default 0/1)
 * @param {object} [o.fightOpts]                 opts extra de createFight (controllers, human, tuning, tailSeconds...)
 * @param {number} [o.maxCatchUp=0.25]           tope de segundos acumulados por update (evita la espiral; no cambia la pelea, sólo cuánto avanza)
 */
export function createLiveFight(o = {}) {
  const specs = [o.a ?? DEFAULT_SPECS[0], o.b ?? DEFAULT_SPECS[1]].map((s, i) => ({ ...s, ...(o.styles?.[SIDES[i]] ? { style: o.styles[SIDES[i]] } : {}) }));
  const ids = o.ids ?? { a: 0, b: 1 };
  const ground = o.ground ?? null;
  const groundFn = ground ? (typeof ground === 'function' ? ground : (x, y, z) => ground.solidAt(x, y, z)) : null;
  const maxCatchUp = o.maxCatchUp ?? 0.25;
  const listeners = new Map();
  const translator = createCombatTranslator({ ids });
  let seedArg = o.seed ?? 1;
  let fight = null, origin = [0, 0, 0], prev = null, cur = null, acc = 0, lastHurt = null, result = null;
  const L = { tick: 0, time: 0, alpha: 0, steps: 0, events: [], rawEvents: [], fighters: null, list: null, round: 1, phase: 'stand', over: false, done: false, result: null };

  function resolveOrigin(seedArgIn) {
    const r = resolveFightSeed(seedArgIn);
    let org = o.origin ? [...o.origin] : r.location ? [...r.location] : null;
    if (groundFn) {
      if (!org) org = findFightSpot(ground, 0, 0, o.spotRadius ?? 6).origin;                               // sin lugar: busca uno llano cerca de (0,0)
      else if (o.origin == null || o.origin[1] == null || o.snapToGround) org[1] = groundTopNear(groundFn, Math.floor(org[0]), Math.floor(org[2]), org[1] ?? 32);
    }
    return org ?? [0, 0, 0];
  }

  function build(seedArgIn) {
    seedArg = seedArgIn;
    origin = resolveOrigin(seedArgIn);
    const r = resolveFightSeed(seedArgIn);
    const geometry = o.geometry && typeof o.geometry === 'object' ? { kind: '3d', ...o.geometry, origin } : { kind: '3d', origin };
    // seed numérico o {worldSeed,...}: el origen explícito manda sobre el lugar de la seed (la seed sigue derivándose de ella)
    fight = createFight(specs[0], specs[1], typeof seedArgIn === 'object' ? { ...seedArgIn } : seedArgIn, { record: true, ...(o.fightOpts ?? {}), geometry });
    void r;
    prev = cur = snapshot();
    acc = 0; lastHurt = { a: null, b: null }; result = null;
    L.tick = 0; L.time = 0; L.over = false; L.done = false; L.result = null;
  }

  function snapshot() {
    const t = fight.last ?? initialTick();
    return { a: { pos: t.a.pos.slice(), yaw: t.a.yaw }, b: { pos: t.b.pos.slice(), yaw: t.b.yaw }, t };
  }
  // Antes del primer tick: raíces iniciales del geometry3d (sin avanzar la sim)
  function initialTick() {
    const F = fight.core, g = F.geo;
    const z = { head: 0, body: 0, legs: 0, armL: 0, armR: 0 };
    const mk = (f) => { const ex = g.tickExtras(f); return { pos: ex.pos, yaw: ex.yaw, guard: 1, action: 'idle', animClip: 'guard', animSeq: 0, hp: 100, stamina: 1, fatigue: 0, damage: z, rocked: false, down: false, foot: null, groundRole: null, groundPos: null }; };
    return { a: mk(F.fighters[0]), b: mk(F.fighters[1]), round: F.round, phase: F.phase };
  }

  function yAt(xm, zm, y0) {
    if (!groundFn) return y0;
    return groundTopNear(groundFn, Math.floor(xm / BLOCK_M), Math.floor(zm / BLOCK_M), y0 / BLOCK_M) * BLOCK_M;
  }

  function stateOf(side, t) {
    const F = fight.core, f = F.byId[side], act = f.action, tk = t[side];
    const total = act ? act.startup + act.active + act.recovery : 0;
    let phase = null, pp = 0;
    if (act) {
      if (act.t < act.startup) { phase = 'windup'; pp = act.t / Math.max(1, act.startup); }
      else if (act.t < act.startup + act.active) { phase = 'active'; pp = (act.t - act.startup) / Math.max(1, act.active); }
      else { phase = 'recovery'; pp = (act.t - act.startup - act.active) / Math.max(1, act.recovery); }
    }
    const mv = act ? MOVES[act.move] : null;
    const myResult = fight.over ? F.result : null;
    const ko = !!myResult && myResult.loser === side && (myResult.method === 'KO' || myResult.method === 'TKO' || myResult.method === 'SUB');
    const victory = !!myResult && myResult.winner === side;
    let stance = 'stand';
    if (ko) stance = 'ko';
    else if (victory) stance = 'victory';
    else if (tk.down) stance = 'down';
    else if (t.phase === 'clinch') stance = 'clinch';
    else if (t.phase === 'ground') stance = tk.groundRole === 'top' ? 'groundTop' : 'groundBottom';
    const hu = lastHurt[side];
    const age = hu ? (F.t - hu.tick) * DT : Infinity;
    return {
      move: act ? act.move : null, clip: tk.animClip ?? null, animSeq: tk.animSeq ?? 0, display: tk.action,
      stance, phase, progress: total ? r3(Math.min(1, act.t / total)) : 0, phaseProgress: r3(Math.min(1, pp)), moveSeconds: total * DT, windupSeconds: act ? act.startup * DT : 0,
      kind: mv ? mv.kind : null, limb: mv ? mv.limb : null,
      guard: tk.guard, onGround: stance === 'groundTop' || stance === 'groundBottom' || stance === 'down' || stance === 'ko',
      position: t.phase === 'ground' ? tk.groundRole : null, groundPos: tk.groundPos ?? null,
      hurt: hu && age <= HURT_WINDOW ? { zone: hu.zone, age: r3(age) } : null,
      rocked: !!tk.rocked, down: !!tk.down, ko, victory, hp: tk.hp, stamina: tk.stamina, fatigue: tk.fatigue, damage: tk.damage,
      sub: tk.sub ?? null, subProgress: tk.subProgress ?? null,
      loco: { mode: tk.foot || tk.animClip || 'idle', speed: 0 },
    };
  }

  function emit(type, ev) {
    for (const fn of listeners.get(type) ?? []) fn(ev, L);
    for (const fn of listeners.get('*') ?? []) fn(ev, L);
  }

  function pack(alpha) {
    const t = cur.t, F = fight.core;
    const list = SIDES.map((side, i) => {
      const p = prev[side], c = cur[side];
      const a = (p === c) ? 1 : alpha;
      const x = lerp(p.pos[0], c.pos[0], a), z = lerp(p.pos[2], c.pos[2], a), y0 = lerp(p.pos[1], c.pos[1], a);
      const st = stateOf(side, t);
      const dx = c.pos[0] - p.pos[0], dz = c.pos[2] - p.pos[2];
      st.loco.speed = r3(Math.hypot(dx, dz) / DT);
      return { id: ids[side], side, pos: [x, yAt(x, z, y0), z], yaw: lerpAngle(p.yaw, c.yaw, a), state: st };
    });
    L.fighters = { a: list[0], b: list[1] }; L.list = list;
    L.round = t.round ?? F.round; L.phase = t.phase ?? F.phase;
  }

  build(seedArg);

  const live = {
    /** Último frame (el mismo objeto se reutiliza y se rellena en cada update). */
    frame: L,
    get fight() { return fight; },
    get seed() { return fight.seed; },
    get origin() { return origin; },
    get tick() { return fight.tick; },
    get over() { return fight.over; },
    get done() { return fight.done; },
    /** FightResult (getResult) cuando terminó la pelea (over), si no null. */
    get result() { return fight.over ? (result ??= getResult(fight)) : null; },
    ids,
    /**
     * Avanza dtSeconds de tiempo real. input (opcional) = intent del lado humano. Devuelve el frame:
     * { tick, time, alpha, steps, events:CombatEvent[] (este frame), rawEvents (KAGE), fighters:{a,b}, list:[a,b], round, phase, over, done, result }
     */
    update(dt, input) {
      acc = Math.min(acc + Math.max(0, Number.isFinite(dt) ? dt : 0), maxCatchUp + DT);
      L.events = []; L.rawEvents = []; L.steps = 0;
      while (acc >= DT - 1e-9 && !fight.done) {
        acc -= DT;
        prev = cur;
        const r = stepFight(fight, L.steps === 0 ? input : undefined);
        L.steps++;
        cur = snapshot();
        for (const ev of r.events) {
          L.rawEvents.push(ev);
          if (ev.type === 'hit' && ev.defender && ev.target) lastHurt[ev.defender] = { zone: ev.target, tick: fight.core.t };
          for (const ce of translator.translate(ev, fight.core)) L.events.push(ce);
        }
      }
      if (acc < 0) acc = 0;
      L.alpha = fight.done ? 1 : acc / DT;
      L.tick = fight.tick; L.time = fight.time; L.over = fight.over; L.done = fight.done; L.result = live.result;
      pack(L.alpha);
      for (const ce of L.events) emit(ce.type, ce);
      return L;
    },
    /** Avanza exactamente n ticks (tests / headless). */
    step(n = 1, input) { let last = null; for (let i = 0; i < n && !fight.done; i++) last = live.update(DT, i === 0 ? input : undefined); return last ?? L; },
    /** on('hit', fn) | on('*', fn); fn(CombatEvent, frame). Devuelve la función para desuscribir. */
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => live.off(type, fn); },
    off(type, fn) { listeners.get(type)?.delete(fn); },
    /** Reinicia con otra seed (o la misma): mismos peleadores, mismo origen salvo que la nueva seed traiga lugar. */
    restart(seed = seedArg) { build(seed); pack(1); return L; },
  };
  pack(1);
  return live;
}
