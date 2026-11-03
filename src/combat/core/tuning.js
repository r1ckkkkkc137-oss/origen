// Tuning de Combate (dueño: Rick Combate / capa de integración). Tres cosas:
//  1) Mapeo de stats 4 -> 7 (contracts.js v1 tiene 4; el núcleo usa 7).
//  2) Resolución de estilo (alias, 'mixto' de Engine, rival sin estilo -> elegido por seed).
//  3) OVERRIDES de balance sobre los defaults del núcleo (src/fight/core.js). Solo datos.

// Fuente única: las 7 stats y el bonus de lucha por estilo los define el núcleo (fighter.js).
// NO copiar acá: se re-exportan para que Motor/tests los lean desde tuning.js sin divergir.
import { FIGHT_STATS, LUCHA_STYLE_BONUS } from './fighter.js';
export { FIGHT_STATS, LUCHA_STYLE_BONUS };
export const CORE_STATS = FIGHT_STATS;
export const CONTRACT_STATS_V1 = Object.freeze(['fuerza', 'velocidad', 'resistencia', 'tecnica']);

/**
 * MAPEO 4 -> 7 (contrato v1 manda fuerza/velocidad/resistencia/tecnica; Motor pasará a 7).
 * Si una stat viene en la entrada se respeta tal cual. Si falta, se deriva (resultado 1..100):
 *   mandibula = 0.70·resistencia + 0.30·fuerza
 *   cardio    = 0.65·resistencia + 0.35·velocidad
 *   lucha     = 0.40·fuerza + 0.35·tecnica + 0.25·resistencia + LUCHA_STYLE_BONUS[estilo]
 *               (bonus importado de fighter.js; hoy wrestler 6, bjj 5, allRounder 2, muayThai 0,
 *                brawler -1, kickboxer -2, counterpuncher -2, boxer -3)
 * Faltantes de las 4 base valen 50. Estas fórmulas son las de fighter.normalizeStats: un spec de 4 y su
 * versión expandida a 7 por mapStats dan EXACTAMENTE la misma pelea (lo verifica sim.test.js).
 * Los pesos se documentan/exportan acá pero no son un mando de balance: cambiarlos rompería esa
 * equivalencia; el balance va en OVERRIDES (o en el núcleo, vía su dueño).
 * Alias de entrada aceptados: aguante/chin -> mandibula, grappling/wrestling -> lucha, strength/speed/... -> ES.
 */
export const DERIVE_WEIGHTS = Object.freeze({
  mandibula: Object.freeze({ resistencia: 0.7, fuerza: 0.3 }),
  cardio: Object.freeze({ resistencia: 0.65, velocidad: 0.35 }),
  lucha: Object.freeze({ fuerza: 0.4, tecnica: 0.35, resistencia: 0.25 }),
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const STAT_IN_ALIASES = Object.freeze({ aguante: 'mandibula', chin: 'mandibula', grappling: 'lucha', wrestling: 'lucha', strength: 'fuerza', speed: 'velocidad', technique: 'tecnica', toughness: 'resistencia' });

/** Acepta stats de 4 (contrato v1) o 7. Devuelve siempre las 7 (1..100, 2 decimales). Puro. */
export function mapStats(stats = {}, style = 'allRounder', extra = {}) {
  const given = {};
  for (const src of [stats ?? {}, extra ?? {}]) {
    for (const [k, v] of Object.entries(src)) {
      const key = STAT_IN_ALIASES[k] ?? k;
      if (CORE_STATS.includes(key) && Number.isFinite(+v)) given[key] = clamp(+v, 1, 100);
    }
  }
  const s = {};
  for (const k of CONTRACT_STATS_V1) s[k] = given[k] ?? 50;
  for (const [k, w] of Object.entries(DERIVE_WEIGHTS)) {
    if (given[k] !== undefined) { s[k] = given[k]; continue; }
    let v = 0;
    for (const [src, wt] of Object.entries(w)) v += s[src] * wt;
    if (k === 'lucha') v += LUCHA_STYLE_BONUS[style] ?? 0;
    s[k] = clamp(v, 1, 100);
  }
  const out = {};
  for (const k of CORE_STATS) out[k] = Math.round(s[k] * 100) / 100;
  return out;
}

/** Alias de estilos (ES/Engine) -> ids de src/data/styles.js. */
export const STYLE_ALIASES = Object.freeze({
  boxeador: 'boxer', boxeo: 'boxer', counter: 'counterpuncher', contragolpeador: 'counterpuncher',
  luchador: 'wrestler', lucha: 'wrestler', wrestling: 'wrestler',
  grappler: 'bjj', jiujitsu: 'bjj', 'jiu-jitsu': 'bjj', bjj: 'bjj',
  muaythai: 'muayThai', 'muay thai': 'muayThai', muay_thai: 'muayThai',
  kickboxing: 'kickboxer', kickboxer: 'kickboxer',
  mixto: 'allRounder', mma: 'allRounder', allrounder: 'allRounder', peleador: 'brawler', brawler: 'brawler',
});

/** Los 5 estilos rivales canónicos (grappler = bjj). Un rival sin estilo recibe uno de estos por seed. */
export const RIVAL_STYLES = Object.freeze(['boxer', 'wrestler', 'muayThai', 'kickboxer', 'bjj']);

/**
 * Overrides de balance sobre DEFAULT_TUNING del núcleo (src/fight/core.js). Se fusionan al crear la pelea
 * (hitstop/windows en profundidad). Vacío = defaults del núcleo. Cada entrada lleva su porqué.
 * Medido con el harness de 8 estilos (28 cruces), 200 peleas por cruce, stats parejas 10/50/85, lados
 * alternados, contra el núcleo da371af (snapshot fijo). Núcleo solo: estilos 41-61% global, peor cruce
 * boxer v wrestler 23/77-24/76. Con overrides: estilos 44-57%, peor 29/70-30/69. Siguen haciendo falta.
 */
export const OVERRIDES = Object.freeze({
  // Derribos ligeramente más difíciles: sin esto el luchador gana 61-64% global y aplasta al boxer a nivel alto.
  tdBias: -0.15,
  // Trabar sumisión algo más difícil: sin esto bjj gana ~74% a kickboxer/muayThai, terminando en ~2 min.
  subBias: -0.4,
  // Levantarse algo más fácil: el striker abajo casi no tenía salida (y topControl del núcleo lo aplasta más).
  getUpBias: 0.4,
});

/**
 * Refuerzo CHICO de finalizaciones a nivel bajo. Desde da371af el daño ya escala relativo al rival (levelKeep solo
 * velocidad), así que nivel 10 sin refuerzo ≈ nivel 85 (DEC ~30%); el refuerzo viejo (+0.1/+0.06) compensaba
 * doble (DEC 9%, TKO 48%). Con +0.03/+0.015 a nivel 10: KO 20 TKO 34 SUB 21 DEC 24 (8 estilos × 200, da371af).
 * Se SUMA a koScale/damageScale con peso t = clamp((LOW_LEVEL_TO - nivel) / (LOW_LEVEL_TO - LOW_LEVEL_FROM), 0, 1),
 * nivel = media de fuerza/velocidad/resistencia/tecnica de ambos: entero a ≤10, nada desde 60.
 * opts.tuning explícito tiene prioridad.
 */
export const LOW_LEVEL_BOOST = Object.freeze({ koScale: 0.03, damageScale: 0.015 });
export const LOW_LEVEL_FROM = 10;
export const LOW_LEVEL_TO = 60;
const BASE4 = ['fuerza', 'velocidad', 'resistencia', 'tecnica'];

/** Nivel medio de una pelea (stats ya mapeadas por mapStats). */
export function fightLevel(statsA = {}, statsB = {}) {
  let s = 0;
  for (const k of BASE4) s += (statsA[k] ?? 50) + (statsB[k] ?? 50);
  return s / 8;
}

/** Peso del refuerzo de nivel bajo (0..1). */
export function lowLevelWeight(level) {
  const t = (LOW_LEVEL_TO - level) / (LOW_LEVEL_TO - LOW_LEVEL_FROM);
  return Math.round(Math.max(0, Math.min(1, t)) * 1e4) / 1e4;
}
