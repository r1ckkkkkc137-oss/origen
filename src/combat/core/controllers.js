// Controladores por lado: quién decide por cada peleador.
//
// Interfaz (todas las funciones son opcionales salvo decide; lo que falte cae a la IA por defecto):
//   decide(F, self, opp)                → decisión { kind:'action', move } | { kind:'feint' } |
//                                          { kind:'move', dir:-1|0|1, ticks, next? } | { kind:'wait', ticks } | null
//   readP(F, def, att, move, p)         → prob. de leer el ataque (p = la que calculó el núcleo)
//   chooseDefense(F, def, att, move)    → 'block'|'parry'|'slip'|'step'|'check'|'catch'|'sprawl'|'knee'
//   poll(F, self)                       → intención de este tick (sólo humano/replay; el núcleo la graba en F.inputs)
//
// Determinismo: el humano no usa RNG; con las mismas entradas por tick la pelea es idéntica.
// createReplayController(F.inputs, side) reproduce una pelea grabada.
import * as AI from './ai.js';
import { MOVES } from '../data/moves.js';
import { dist, cornered, rw } from './resolve.js';

/** Controlador por defecto: la IA del núcleo. */
export const AI_CONTROLLER = Object.freeze({
  kind: 'ai',
  decide: AI.decide,
  chooseDefense: AI.chooseDefense,
});

const EMPTY = Object.freeze({ walk: 0, act: null, feint: false, block: false, slip: false });

/** Normaliza una intención de input. */
export function normIntent(i) {
  if (!i) return EMPTY;
  return {
    walk: i.walk > 0 ? 1 : i.walk < 0 ? -1 : 0,
    act: typeof i.act === 'string' && MOVES[i.act] ? i.act : null,
    feint: !!i.feint,
    block: !!i.block,
    slip: !!i.slip,
  };
}
const sameIntent = (a, b) => a.walk === b.walk && a.act === b.act && a.feint === b.feint && a.block === b.block && a.slip === b.slip;

/**
 * Controlador humano. Intenciones por tick: { walk:-1|0|1 (atrás/quieto/adelante), act:moveId|null,
 * feint:bool, block:bool, slip:bool }.
 *   - set(intent): input vivo; vale desde el próximo tick hasta que se cambie. `act`/`feint` se consumen al usarse.
 *   - source: función (t, F, self) → intent, o array indexado por tick (para tests/replays).
 *   - assist (default true): en suelo/clinch, o si `act` no es válido en la fase, decide la IA.
 * Defensa manual: con block/slip apretado el ataque se lee (p ≥ 0.9) y se usa esa defensa;
 * sin nada apretado no hay lectura (p = 0). block → bloqueo / check (piernas) / sprawl (derribo);
 * slip → esquiva (cabeza) o paso atrás si hay espacio, si no bloqueo.
 */
export function createHumanController({ source = null, assist = true } = {}) {
  let live = EMPTY;
  let cur = EMPTY;
  let usedAct = -1;
  const ctl = {
    kind: 'human',
    autoCounter: false, // el contra no sale solo: tras defender, el próximo golpe (≤18 ticks) cuenta como contra
    set(intent) { live = normIntent(intent); usedAct = -1; },
    get intent() { return cur; },
    poll(F, self) {
      let i = live;
      if (typeof source === 'function') i = normIntent(source(F.t, F, self));
      else if (Array.isArray(source)) i = normIntent(source[F.t]);
      cur = i;
      return i;
    },
    decide(F, self, opp) {
      const i = cur;
      const phase = F.phase;
      if (i.act && usedAct !== F.t) {
        const mv = MOVES[i.act];
        const ok = mv.phase === phase || (phase === 'clinch' && mv.phase === 'clinch') || (phase === 'stand' && mv.kind === 'takedown');
        if (ok && self.stamina >= mv.stamina) {
          usedAct = F.t;
          if (source == null) live = { ...live, act: null }; // input vivo: el golpe se consume
          return { kind: 'action', move: i.act };
        }
      }
      if (i.feint && phase === 'stand') {
        if (source == null) live = { ...live, feint: false };
        return { kind: 'feint' };
      }
      if (phase !== 'stand' && assist) return AI.decide(F, self, opp);
      if (phase === 'stand') return { kind: 'move', dir: i.walk, ticks: 1, next: 1 };
      return { kind: 'wait', ticks: 1 };
    },
    readP(F, def, att, move, p) {
      const i = cur;
      if (i.block || i.slip) return Math.max(p, 0.9);
      return 0;
    },
    chooseDefense(F, def, att, move) {
      const i = cur;
      if (move.kind === 'takedown') return 'sprawl';
      if (i.slip) {
        if (move.zone === 'head') return 'slip';
        if (!cornered(F, def) && dist(F) > rw(F, move).rangeMax - 25) return 'step';
      }
      return move.zone === 'legs' ? 'check' : 'block';
    },
  };
  return ctl;
}

/** Reproduce las entradas grabadas en F.inputs ([{t, side, intent}], disperso: sólo cambios). */
export function createReplayController(inputs, side, opts = {}) {
  const mine = (inputs ?? []).filter((r) => r.side === side).sort((x, y) => x.t - y.t);
  let k = 0, last = EMPTY;
  const at = (t) => {
    while (k < mine.length && mine[k].t <= t) last = normIntent(mine[k++].intent);
    return last;
  };
  return createHumanController({ ...opts, source: (t) => at(t) });
}

/** Resuelve options.controllers → { a, b } con defaults de IA. Acepta 'ai' | 'human' | objeto controlador. */
export function resolveControllers(spec = {}) {
  const one = (c) => {
    if (!c || c === 'ai') return AI_CONTROLLER;
    if (c === 'human') return createHumanController();
    if (typeof c.decide !== 'function') throw new Error('controller sin decide()');
    return c;
  };
  return { a: one(spec.a), b: one(spec.b) };
}

export { sameIntent };
