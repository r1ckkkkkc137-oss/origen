// Modelo de peleador. Dos capas:
//  1) createFighter(): PERFIL inmutable (nombre, estilo, stats 0-100, atributos derivados, "tells" de hábito).
//     Es lo que Rick Motor construye desde el entrenamiento del tamagotchi. Reutilizable entre peleas.
//  2) createRuntime(): ESTADO mutable dentro de una pelea (posición, stamina, daño por zona, acción, etc.).
import { STYLES, STYLE_IDS } from '../data/styles.js';
import { MOVES, PX_PER_M } from '../data/moves.js';
import { createRng, hashSeed } from './rng.js';

// Los 7 stats de pelea (1..100). Los 4 primeros son los oficiales de contracts.STATS;
// mandibula, cardio y lucha se DERIVAN si no vienen (ver deriveMissingStats).
export const FIGHT_STATS = Object.freeze(['fuerza', 'velocidad', 'tecnica', 'resistencia', 'mandibula', 'cardio', 'lucha']);
export const STAT_KEYS = FIGHT_STATS;
// Bonus de lucha por estilo al derivarla (un luchador "sabe" luchar aunque sus 4 stats sean iguales).
export const LUCHA_STYLE_BONUS = Object.freeze({ wrestler: 6, bjj: 5, allRounder: 2, muayThai: 0, kickboxer: -2, brawler: -1, counterpuncher: -2, boxer: -3 });
// Alias aceptados en la entrada (por si Motor usa otros nombres).
const STAT_ALIASES = { aguante: 'mandibula', chin: 'mandibula', strength: 'fuerza', speed: 'velocidad', technique: 'tecnica', toughness: 'resistencia', grappling: 'lucha', wrestling: 'lucha' };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Fórmulas de derivación (si el stat no viene en stats ni en extra):
 *   mandibula = 0.7·resistencia + 0.3·fuerza
 *   cardio    = 0.65·resistencia + 0.35·velocidad
 *   lucha     = 0.4·fuerza + 0.35·tecnica + 0.25·resistencia + bonusEstilo (wrestler +12, bjj +10, allRounder +4,
 *               muayThai 0, brawler -2, kickboxer -4, counterpuncher -5, boxer -7)
 * Todo se recorta a 1..100.
 */
export function normalizeStats(stats = {}, style = 'allRounder', extra = {}) {
  const out = {};
  const given = {};
  for (const src of [stats, extra]) {
    for (const [k, v] of Object.entries(src ?? {})) {
      const key = STAT_ALIASES[k] ?? k;
      if (STAT_KEYS.includes(key) && Number.isFinite(+v)) given[key] = clamp(+v, 1, 100);
    }
  }
  for (const k of ['fuerza', 'velocidad', 'tecnica', 'resistencia']) out[k] = given[k] ?? 50;
  out.mandibula = given.mandibula ?? clamp(0.7 * out.resistencia + 0.3 * out.fuerza, 1, 100);
  out.cardio = given.cardio ?? clamp(0.65 * out.resistencia + 0.35 * out.velocidad, 1, 100);
  out.lucha = given.lucha ?? clamp(0.4 * out.fuerza + 0.35 * out.tecnica + 0.25 * out.resistencia + (LUCHA_STYLE_BONUS[style] ?? 0), 1, 100);
  for (const k of STAT_KEYS) out[k] = Math.round(out[k] * 100) / 100;
  return Object.freeze(out);
}

// Si el spec no trae estilo, se elige uno determinista según el perfil de stats (sin azar).
export function styleFromStats(st) {
  const f = st.fuerza ?? 50, v = st.velocidad ?? 50, r = st.resistencia ?? 50, t = st.tecnica ?? 50;
  const top = [['brawler', f * 1.1 + r * 0.4], ['boxer', v + t * 0.6], ['muayThai', r + t * 0.6], ['wrestler', f + r * 0.6], ['counterpuncher', t * 1.15 + v * 0.4], ['allRounder', (f + v + r + t) * 0.42]];
  top.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return top[0][0];
}

// Atributos derivados (multiplicadores) a partir de stats 0-100.
export function deriveAttributes(s, style = null) {
  const n = (k) => s[k] / 100;
  const pm = style?.powerMul ?? 1, cm = style?.chinMul ?? 1; // rasgos opcionales de estilo
  return Object.freeze({
    speedMul: 1.22 - 0.4 * n('velocidad'),                 // multiplica ticks de startup/recovery (menor = más rápido)
    power: (0.6 + 0.8 * n('fuerza')) * pm,                       // multiplica daño
    accuracy: 0.72 + 0.45 * n('tecnica'),                   // multiplica precisión
    reaction: Math.round(24 - 13 * (0.55 * n('velocidad') + 0.45 * n('tecnica'))), // ticks para leer un ataque
    headCap: 55 + 70 * n('mandibula'),                      // daño de cabeza tolerable
    chin: (0.55 + 0.9 * n('mandibula')) * cm,                    // resistencia al KO "flash"
    bodyCap: 70 + 70 * n('resistencia'),
    legsCap: 85 + 80 * n('resistencia'),
    armCap: 70 + 60 * n('resistencia'),             // brazos: bloqueos y llaves (formato Arte)
    staminaMax: 75 + 55 * n('cardio'),
    regen: (3.2 + 5.5 * n('cardio')) / 60,                  // stamina por tick en reposo
    moveSpeed: (1.4 + 1.6 * n('velocidad')) * PX_PER_M / 60, // px por tick
    grappling: n('lucha'),
    technique: n('tecnica'),
    recovery: 0.5 + 0.5 * n('resistencia'),                 // recuperación entre rounds / de aturdimientos
  });
}

// Hábitos explotables generados por seed: "tells". El rival puede descubrirlos y castigarlos.
function genTells(style, rng) {
  const favs = Object.entries(style.moveW).filter(([id, w]) => w >= 1 && MOVES[id]).map(([id]) => id).sort();
  const tells = {};
  const n = rng.chance(0.5) ? 2 : 1;
  for (let i = 0; i < n && favs.length; i++) {
    const id = favs[Math.floor(rng.next() * favs.length)];
    tells[id] = Math.round(rng.float(0.25, 0.6) * 100) / 100; // prob. de bajar la guardia tras ese golpe
  }
  return Object.freeze(tells);
}

/**
 * Crea el perfil de un peleador. Acepta un FighterSpec del contrato tal cual.
 * @param {{id?:string, name?:string, level?:number, style?:string, stats?:object, extra?:object,
 *          condition?:number, color?:string, seed?:number|string}} spec
 *   style: una de STYLE_IDS (boxer, muayThai, kickboxer, wrestler, bjj, brawler, counterpuncher, allRounder).
 *          Si falta: styleFromStats(stats).
 *   stats: { fuerza, velocidad, tecnica, resistencia } 1-100 (oficiales) + opcional { mandibula, cardio, lucha }.
 *   extra: overrides opcionales { mandibula, cardio, lucha } (alias: aguante/chin, wrestling/grappling).
 *   condition: 0.5..1.1 (necesidades del tamagotchi) -> escala la stamina inicial y algo de agudeza.
 *   seed: determina sus "tells" (hábitos explotables). Default: hash de id/nombre+estilo.
 */
export function createFighter(spec = {}) {
  if (isFighterProfile(spec)) return spec;
  const { name = 'Stickman', stats = {}, extra = {}, seed, id, level = 1, color } = spec;
  const style = spec.style && STYLES[spec.style] ? spec.style : styleFromStats(stats);
  const condition = clamp(Number.isFinite(+spec.condition) ? +spec.condition : 1, 0.5, 1.1);
  const st = STYLES[style];
  const s = normalizeStats(stats, st.id, extra);
  const fseed = seed ?? hashSeed((id ?? '') + ':' + name + ':' + st.id);
  const rng = createRng('fighter:' + fseed);
  return Object.freeze({
    kind: 'kage-fighter', id, name, level, color, condition, style: st.id, styleDef: st, stats: s, attr: deriveAttributes(s, st), seed: fseed,
    tells: genTells(st, rng),
    // Leve sesgo personal (variación entre dos peleadores del mismo estilo).
    quirks: Object.freeze({ aggression: rng.float(-0.12, 0.12), feint: rng.float(-0.06, 0.06), headHunter: rng.float(-0.25, 0.25), patience: rng.float(-0.1, 0.1) }),
  });
}

export function isFighterProfile(x) { return !!x && x.kind === 'kage-fighter'; }

export function randomStats(rng, base = 50, spread = 20) {
  const s = {};
  for (const k of ['fuerza', 'velocidad', 'tecnica', 'resistencia']) s[k] = clamp(Math.round(base + rng.gauss() * spread * 0.6), 5, 100);
  return s;
}

export { STYLE_IDS };

// Estado de pelea mutable.
/**
 * Stats EFECTIVOS de una pelea (relativos al rival, no absolutos):
 *   c = media de ambos peleadores en ese stat
 *   ef = 50 + (c-50)·levelKeep + (s-c)·spread + form
 * levelKeep < 1 hace que el NIVEL absoluto pese poco (10 vs 10 y 85 vs 85 pelean parecido; el balance de estilos no
 * depende del nivel), spread < 1 comprime la ventaja de stats (más sorpresas), form = "forma del día" en puntos.
 * eff = { center: {stat: media}, levelKeep, spread, form }. Sin eff devuelve los stats tal cual.
 */
export function effectiveStats(stats, eff) {
  if (!eff) return stats;
  const out = {};
  const lk = eff.levelKeep ?? 1, spread = eff.spread ?? 1, form = eff.form ?? 0;
  for (const k of STAT_KEYS) {
    const c = eff.center?.[k] ?? 50;
    const keep = typeof lk === 'number' ? lk : (lk[k] ?? 0);
    out[k] = Math.round(clamp(50 + (c - 50) * keep + (stats[k] - c) * spread + form, 1, 100) * 100) / 100;
  }
  return Object.freeze(out);
}

export function createRuntime(profile, id, eff = null) {
  const stats = effectiveStats(profile.stats, eff);
  const a = stats === profile.stats ? profile.attr : deriveAttributes(stats, profile.styleDef);
  return {
    id, profile, style: profile.styleDef, attr: a, stats,
    // La posición/orientación NO viven aquí: las posee el adaptador de geometría (src/combat/geometry*.js).
    stamina: a.staminaMax * Math.min(1, 0.55 + 0.45 * profile.condition), staminaMax: a.staminaMax,
    dmg: { head: 0, body: 0, legs: 0, armL: 0, armR: 0 },
    marks: { head: 'none', body: 'none', legs: 'none', armL: 'none', armR: 'none' }, // none|bruise|swelling|cut
    injuries: {},             // elbowL|elbowR|shoulderL|shoulderR|kneeL|kneeR → 'dislocated'|'broken'
    cutHead: 0, nose: 0, eye: 0, // 0..1 cortes faciales (formato Arte)
    cut: 0, gRun: 0, gLast: null,
    guard: 1,                 // 1 guardia alta y firme, 0 manos abajo
    guardDropUntil: -1,       // tick hasta el cual tiene la guardia baja por un "tell"
    momentum: 0,              // -1..1
    action: null,             // { move, t, startup, active, recovery, resolved, ... }
    intent: { dir: 0, until: 0 }, // movimiento continuo elegido por la IA
    nextDecision: 0,
    queue: [],                // combo pendiente
    rocked: 0,                // ticks aturdido
    down: 0,                  // ticks en la lona (knockdown)
    dazed: 0,                 // aturdido en el suelo tras knockdown
    feintBit: 0,              // tick hasta el cual "mordió" un amago (vulnerable)
    counterReady: 0,          // tick hasta el cual espera para contragolpear
    unanswered: 0,            // golpes limpios seguidos recibidos (para que el árbitro pare)
    lastHitT: -9999,
    tdFails: 0,
    mem: null,                // memoria de la IA (ver ai.js)
  };
}

// Condición física actual -> multiplicadores (fatiga degrada técnica, velocidad, potencia y defensa).
// Daño acumulado de piernas/cuerpo -> defensa y guardia (para que las patadas terminen peleas, no sólo sumen puntos).
const LEG_DEF = 0.1, BODY_DEF = 0.15, BODY_GUARD = 0.35;
/** Fatiga 0..1 para Arte/Motor (1 = agotado). Complemento de condition().stamina. */
export function fatigueOf(f) {
  return clamp(1 - f.stamina / f.staminaMax, 0, 1);
}

/** Daño por zona 0..1 (formato Arte): head/body/legs + armL/armR. */
export function damageOf(f) {
  const a = f.attr;
  const z = (v, cap) => clamp(v / Math.max(1e-6, cap), 0, 1);
  return {
    head: z(f.dmg.head, a.headCap),
    body: z(f.dmg.body, a.bodyCap),
    legs: z(f.dmg.legs, a.legsCap),
    armL: z(f.dmg.armL ?? 0, a.armCap ?? 100),
    armR: z(f.dmg.armR ?? 0, a.armCap ?? 100),
  };
}

/** Escala marca visual según ratio de zona: none → bruise → swelling → cut. */
export function escalateMark(f, zone, ratio) {
  const order = ['none', 'bruise', 'swelling', 'cut'];
  let want = 'none';
  if (ratio >= 0.75) want = 'cut';
  else if (ratio >= 0.45) want = 'swelling';
  else if (ratio >= 0.18) want = 'bruise';
  if (!f.marks) f.marks = {};
  const cur = f.marks[zone] ?? 'none';
  if (order.indexOf(want) > order.indexOf(cur)) f.marks[zone] = want;
}

export function condition(f) {
  const a = f.attr;
  const st = clamp(f.stamina / f.staminaMax, 0, 1);
  const fat = st >= 0.5 ? 1 : 0.55 + 0.9 * st;               // por debajo de 50% decae fuerte
  const legs = clamp(f.dmg.legs / a.legsCap, 0, 1.2);
  const legsF = Math.sqrt(Math.min(1, legs)); // las piernas se resienten pronto (cóncavo): las low kicks pesan desde temprano
  const body = clamp(f.dmg.body / a.bodyCap, 0, 1.2);
  const bodyF = Math.min(1, body); // hígado/costillas: baja la guardia y la defensa, y no recupera aire
  const head = clamp(f.dmg.head / a.headCap, 0, 1.2);
  const rocked = f.rocked > 0 ? 0.6 : 1;
  return {
    stamina: st,
    speed: (1 / fat) * (1 + 0.25 * legs) * (f.rocked > 0 ? 1.2 : 1),   // multiplica ticks
    accuracy: (0.75 + 0.25 * fat) * (1 - 0.15 * head) * (f.rocked > 0 ? 0.75 : 1),
    power: (0.7 + 0.3 * fat) * (1 - 0.2 * legsF) * (1 - 0.1 * body),
    defense: (0.65 + 0.35 * fat) * (1 - 0.25 * head) * (1 - LEG_DEF * legsF) * (1 - BODY_DEF * bodyF) * rocked, // piernas muertas: sin juego de pies
    mobility: (0.6 + 0.4 * fat) * (1 - 0.55 * legsF),
    regen: 1 - 0.45 * bodyF,
    guard: 1 - BODY_GUARD * bodyF,           // multiplica f.guard (core.tickUpkeep)
  };
}
