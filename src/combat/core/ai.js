// IA de pelea por utilidad. Cada opción recibe un puntaje (personalidad del estilo + situación + lo que
// aprendió del rival) y se elige con softmax de temperatura baja: variedad con intención, no ruido.
import { MOVES, STAND_STRIKES, CLINCH_MOVES, GROUND_MOVES, TAKEDOWNS, POSITION_VALUE, PX_PER_M as U } from '../data/moves.js';
import { moveArea } from '../data/styles.js';
import { condition } from './fighter.js';
import { prowess, rel, subOffense, subDefense, dist, cornered, clamp, skill, reachable, stepInReach, STEP_BACK_PX, canUseMove, rw, reachableAI } from './resolve.js';

const ln = (x) => Math.log(Math.max(1e-4, x));
const moveWeight = (f, id) => (canUseMove(f, id) ? (f.style.moveW[id] ?? 0.3) : 0);

export const catOf = (m) => (m.kind === 'takedown' ? 'td' : m.kind === 'clinch' ? 'clinch' : m.zone);
const CATS = ['head', 'body', 'legs', 'td', 'clinch'];

// Seguimientos naturales cuando no hay combo de estilo que empiece con ese golpe.
const FOLLOW = {
  jab: ['cross', 'jab', 'lowKick', 'hook', 'doubleLeg'], cross: ['hook', 'lowKick', 'bodyHook', 'uppercut'],
  hook: ['cross', 'uppercut', 'lowKick'], uppercut: ['hook', 'cross'], bodyHook: ['hook', 'uppercut'],
  bodyCross: ['hook', 'cross'], overhand: ['hook', 'doubleLeg'], teep: ['jab', 'bodyKick'], lowKick: ['cross', 'jab'],
  calfKick: ['cross', 'jab'], bodyKick: ['cross', 'lowKick'], standElbow: ['hook', 'uppercut'],
};

export function initMemory() {
  const trans = {};
  for (const a of [...CATS, 'start']) { trans[a] = {}; for (const b of CATS) trans[a][b] = 1; }
  return {
    trans, lastOppCat: 'start',
    zone: { head: [1, 2.2], body: [1, 2], legs: [1.2, 2] }, // [conectados, lanzados] míos contra este rival (con prior)
    tells: {},           // golpe del rival -> veces que lo vi bajar la guardia después
    td: [1, 2],          // mis derribos [ok, intentos]
    oppTd: [1, 3],       // derribos del rival contra mí
    feint: [1, 2],       // amagos [mordidos, total]
    subFails: 0,
    dmgDealtStand: 0, dmgTakenStand: 0, dmgTakenGround: 0,
    oppWhiffs: 0, oppAggro: 0,
    jabRead: 0,          // memoria de patrón: jabs seguidos del rival (decae) -> contra por encima (cross/overhand)
  };
}

// ----------------------------------------------------------------------------
// Observación: actualiza el modelo del rival.
export function observe(F, self, info) {
  const m = self.mem;
  if (!m) return;
  switch (info.kind) {
    case 'oppAction': {
      const c = catOf(info.move);
      m.trans[m.lastOppCat][c] += 1;
      m.prevOppCat = m.lastOppCat;
      m.lastOppCat = c;
      m.oppAggro = m.oppAggro * 0.9 + 1;
      if (info.move.phase === 'stand' && info.move.kind === 'strike') m.jabRead = info.move.id === 'jab' ? m.jabRead * 0.9 + 1 : m.jabRead * 0.6;
      break;
    }
    case 'result': {
      const z = m.zone[info.move.zone];
      if (z && info.move.phase === 'stand') { z[1] += 1; if (info.res === 'hit') z[0] += 1; else if (info.res === 'block') z[0] += 0.3; }
      if (info.res === 'hit' && F.phase === 'stand') m.dmgDealtStand += info.dmg;
      break;
    }
    case 'hitBy':
      if (F.phase === 'stand' || F.phase === 'clinch') m.dmgTakenStand += info.dmg; else m.dmgTakenGround += info.dmg;
      break;
    case 'whiff':
      m.oppWhiffs++;
      // castigar el golpe al aire
      if (!self.action && self.down <= 0) self.nextDecision = Math.min(self.nextDecision, F.t + 1);
      self.punishUntil = F.t + (F.reach ? 22 : 14);
      break;
    case 'tdResult': m.td[1]++; if (info.ok) m.td[0]++; break;
    case 'tdAgainst': m.oppTd[1]++; if (info.ok) m.oppTd[0]++; break;
    case 'feint': m.feint[1]++; if (info.bit) m.feint[0]++; break;
    case 'tell': m.tells[info.move.id] = (m.tells[info.move.id] || 0) + 1; break;
    case 'subFail': m.subFails++; break;
    default: break;
  }
}

// Probabilidad estimada de que el rival haga 'cat' ahora (por su último patrón).
function predict(m, cat) {
  const row = m.trans[m.prevOppCat ?? 'start'];
  let tot = 0; for (const k in row) tot += row[k];
  return row[cat] / tot;
}

// Bonus de lectura: si el modelo predijo esta categoría, se defiende mejor.
export function readBonus(F, def, att, move) {
  const m = def.mem;
  if (!m) return 0;
  // predict usa la categoría ANTERIOR a esta acción (la actual ya fue registrada al empezar)
  const p = predict(m, catOf(move));
  let b = clamp((p - 0.22) * 1.6, -0.1, 0.45) * (0.4 + 0.6 * def.attr.technique);
  if (move.kind === 'takedown') b += 0.15 * clamp((m.oppTd[1] - 3) / 4, 0, 1); // ya lo vio disparar
  return b;
}

// ----------------------------------------------------------------------------
// Defensa reactiva cuando LEE el ataque.
export function chooseDefense(F, def, att, move) {
  const rng = F.aiRng[def.id];
  const s = def.style;
  if (move.kind === 'takedown') {
    const kneeW = s.shootCounter ?? (s.skill.kick > 1.05 || s.id === 'brawler' ? 0.22 + 0.1 * (s.moveW.flyingKnee ?? 0) : 0.04); // shootCounter: contra al shoot (rodilla/uppercut)
    return rng.chance(kneeW) ? 'knee' : 'sprawl';
  }
  const opts = [];
  const d = dist(F);
  const canStep = !cornered(F, def) && d > rw(F, move).rangeMax - 0.3 * U;
  if (move.zone === 'legs') {
    opts.push({ k: 'check', w: 0.5 + 1.2 * (s.skill.kick - 0.6) });
    if (canStep) opts.push({ k: 'step', w: 0.6 + 1.6 * Math.max(0, s.counter - 0.45) }); // el contragolpeador lee la patada y sale
    if (move.catchable) opts.push({ k: 'catch', w: 0.3 * s.td + 0.05 });
  } else if (move.zone === 'body') {
    opts.push({ k: 'block', w: 1.2 * s.skill.defense });
    if (canStep) opts.push({ k: 'step', w: 0.7 });
    if (move.catchable) opts.push({ k: 'catch', w: 0.4 * s.td + 0.2 * (s.skill.kick > 1.1 ? 1 : 0) + 0.05 });
  } else {
    opts.push({ k: 'block', w: 1.0 * s.skill.defense });
    if (move.arc === 'straight') opts.push({ k: 'parry', w: 0.7 * def.attr.technique * s.skill.defense });
    opts.push({ k: 'slip', w: 1.4 * Math.pow(s.skill.headMovement, 3) * (0.5 + s.counter) });
    if (canStep) opts.push({ k: 'step', w: 0.5 + (move.catchable ? 0.4 : 0) });
    if (move.catchable) opts.push({ k: 'catch', w: 0.15 * s.td });
  }
  return rng.weighted(opts).k;
}

// Elegir contragolpe tras defender.
export function pickCounter(F, D, A, how) {
  const rng = F.aiRng[D.id];
  const d = dist(F);
  const s = D.style;
  const opts = [];
  for (const id of STAND_STRIKES) {
    const m = MOVES[id];
    const w = s.moveW[id] ?? 0;
    if (w < 0.1 || m.startup > 16) continue;
    if (!reachableAI(F, m, d)) continue; // sólo si la punta del clip llega a la zona
    if (d < rw(F, m).rangeMin && cornered(F, D)) continue; // contra la reja no hay paso atrás
    let u = ln(w) + m.damage * 0.12 - m.startup * 0.06;
    if ((how === 'slip' || how === 'parry') && (m.arc === 'hook' || m.arc === 'upper' || id === 'cross')) u += 0.6;
    if (how === 'check' && (id === 'cross' || id === 'teep' || m.zone === 'legs')) u += 0.5;
    // leyó el jab repetido: contra por encima del jab (cross / overhand)
    if (A.action?.move === 'jab' && (D.mem?.jabRead ?? 0) >= 2 && (id === 'cross' || id === 'overhand')) u += 0.9;
    opts.push({ id, u });
  }
  if (!opts.length) return null;
  return rng.softmax(opts, (o) => o.u, 0.5).id;
}

export function onKnockdown(F, A, B) {
  const s = A.style;
  const rng = F.aiRng[A.id];
  const c = condition(A);
  // Los que tienen ground and pound se lanzan; algunos "lo dejan levantarse" (estilo Kengan).
  const p = clamp(0.45 + 0.4 * s.gnp + 0.2 * (A.attr.grappling - 0.5) - (c.stamina < 0.3 ? 0.3 : 0), 0.05, 0.97);
  return rng.chance(p) ? 'pounce' : 'wave';
}

export function groundCover(F, B) {
  const g = F.ground;
  const base = { guard: 0.4, half: 0.3, side: 0.22, mount: 0.15, back: 0.12 }[g.pos] ?? 0.2;
  if (g.bottom !== B) return 0.18; // el de arriba también se cubre de codos desde abajo
  return base * (0.6 + 0.6 * B.attr.technique) * (B.dazed > 0 ? 0.4 : 1);
}
export function groundPowerMul(F, A) {
  const g = F.ground;
  if (g.bottom === A) return 0.6;
  return { guard: 0.65, half: 0.85, side: 1.0, mount: 1.25, back: 0.85 }[g.pos] ?? 1;
}

// ----------------------------------------------------------------------------
// Situación de puntaje (aprox) para que el que va perdiendo arriesgue.
function scoreEdge(F, self, opp) {
  let e = 0;
  for (const r of F.roundStats) {
    const a = r[self.id], b = r[opp.id];
    e += (a.dmg + a.td * 5 + a.ctrl / 60 * 0.4 + a.kd * 15) - (b.dmg + b.td * 5 + b.ctrl / 60 * 0.4 + b.kd * 15);
  }
  return e;
}

function aggressionOf(F, self, opp, c) {
  const s = self.style;
  let ag = s.aggression + self.profile.quirks.aggression + self.momentum * 0.2;
  if (opp.rocked > 0 || opp.dazed > 0) ag += 0.5;
  if (self.rocked > 0) ag -= 0.45;
  ag -= (1 - c.stamina) * 0.35;
  if (F.round === F.opt.rounds) {
    const edge = scoreEdge(F, self, opp);
    if (edge < -10) ag += 0.3;
    else if (edge > 25) ag -= 0.1;
  }
  const co = condition(opp);
  if (co.stamina < 0.35) ag += 0.15;
  return clamp(ag, 0, 1.4);
}

function zoneValue(F, self, opp, zone) {
  const m = self.mem;
  const z = m.zone[zone];
  const avg = (m.zone.head[0] + m.zone.body[0] + m.zone.legs[0]) / (m.zone.head[1] + m.zone.body[1] + m.zone.legs[1]);
  const learned = Math.pow((z[0] / z[1]) / avg, 0.8);
  const co = condition(opp);
  let v = 1;
  const oLegs = Math.min(1, opp.dmg.legs / opp.attr.legsCap);
  // piernas tocadas = rival plantado: se busca la cabeza (KO) en vez de rematar solo la pierna
  if (zone === 'head') v = 1.0 + self.profile.quirks.headHunter + (opp.rocked > 0 ? 0.6 : 0) + F.opt.legsToHead * oLegs;
  if (zone === 'body') v = 0.9 + (co.stamina < 0.5 ? 0.3 : 0) + (opp.dmg.body / opp.attr.bodyCap) * 0.5;
  if (zone === 'legs') v = 0.85 + oLegs * F.opt.legsHunt + (opp.style.range > 1.05 ? 0.15 : 0);
  return v * learned;
}

// ----------------------------------------------------------------------------
// Decisión principal. Devuelve { kind: 'action'|'feint'|'move'|'wait', ... }
const KILL_HEAD = 2.0, KILL_BODY = 1.2;
// Ritmo y selección (IA pro): sesgo del jab, castigo en calma (reset tras intercambio), derribo sin setup, separación de derribos.
const JAB_BIAS = 2.2, CALM_PEN = 5.0, CALM_JAB = 3.0, TD_NOSETUP = 1.0, TD_GAP = 2000, FEINT_BIAS = 0.3, CALM_FEINT = -0.6, CLINCH_WAIT = 1.8;
const LONG_KICKS = new Set(['teep', 'lowKick', 'calfKick', 'bodyKick']);

export function decide(F, self, opp) {
  if (F.phase === 'ground') return decideGround(F, self, opp);
  if (F.phase === 'clinch') return decideClinch(F, self, opp);
  return decideStand(F, self, opp);
}

function decideStand(F, self, opp) {
  const rng = F.aiRng[self.id];
  const s = self.style;
  const m = self.mem;
  const c = condition(self);
  const co = condition(opp);
  const d = dist(F);
  const ag = aggressionOf(F, self, opp, c);
  const tec = self.attr.technique;
  const opts = [];
  const oppRecovering = opp.action && opp.action.t >= opp.action.startup + opp.action.active;
  const punishing = F.t < (self.punishUntil ?? -1) && (oppRecovering || (!!F.reach && !opp.action && opp.down <= 0)); // 3D: la ventana sigue abierta mientras el otro se recompone
  const oppLastMove = opp.lastMove;
  const exploitTell = F.t < opp.guardDropUntil && oppLastMove && (m.tells[oppLastMove] ?? 0) >= 2;
  const losingStand = m.dmgTakenStand > m.dmgDealtStand * 1.35 + 10;
  // Control de distancia con patadas (style.rangeKick 0..1): castiga al que entra y lo mantiene afuera.
  const rk = s.rangeKick ?? 0;
  const oppEntering = !opp.action && opp.intent?.dir > 0 && F.t < (opp.intent.until ?? 0);
  const oppJab = rw(F, MOVES.jab).rangeMax;
  const selfCornered = cornered(F, self);
  const oppCloseSpeed = oppEntering ? opp.attr.moveSpeed * condition(opp).mobility : 0;
  // Ritmo (tanteo / reset / ráfaga): tras un intercambio ambos se reacomodan (core.js fija calmUntil). En calma
  // casi no se tira: footwork, fintas sueltas y jab de medida; se rompe por castigo, rival tocado o lectura.
  const calm = F.t < (self.calmUntil ?? -1) && !punishing && !(opp.rocked > 0) && !exploitTell;
  const urgent = urgency(F, self);
  const wallGap = F.geo.wallDistance(self), backToWall = F.geo.backToWall(self);
  const nearCage = backToWall && wallGap < 45;
  const oppNearCage = F.geo.backToWall(opp) && F.geo.wallDistance(opp) < 60;
  const setupT = F.t < (self.feintFollow ?? -1) || F.t - (self.lastStrikeT ?? -9999) < 45;

  // ----- golpes -----
  for (const id of STAND_STRIKES) {
    const mv = MOVES[id];
    const w = (s.moveW[id] ?? 0.3);
    if (w < 0.02) continue;
    if (!reachableAI(F, mv, d, oppEntering)) continue; // ventana del clip (con paso adentro/atrás del startup)
    if (selfCornered && d < (mv.startup >= 12 ? rw(F, mv).rangeIdeal + 3 : rw(F, mv).rangeMin)) continue; // contra la reja no hay paso atrás y el rival presiona: lo lento quedaría 'jammed'
    // rival entrando: la distancia en el impacto será menor (patadas lentas quedaban 'jammed'): exigir que también llegue ahí
    if (oppEntering && !reachable(F, mv, d - oppCloseSpeed * Math.min(mv.startup, opp.intent.until - F.t) * 0.7)) continue;
    if (self.stamina < mv.stamina * 1.2) continue;
    const area = moveArea(mv);
    const ev = mv.damage * mv.accuracy * zoneValue(F, self, opp, mv.zone) * (1 + mv.ko * (opp.rocked > 0 ? 2 : 0.4)) / 6;
    let u = ln(w * skill(self, area)) + 1.1 * ev;
    if (d > rw(F, mv).rangeMax) u -= ((d - rw(F, mv).rangeMax) / stepInReach(mv)) * (mv.lunge ? 0.5 : 1.4); // hay que dar el paso: se ve venir
    else if (d < rw(F, mv).rangeMin) u -= ((rw(F, mv).rangeMin - d) / STEP_BACK_PX) * 1.2;              // encima: hay que recular
    u -= mv.stamina / (2 + 10 * c.stamina);                 // gestión de stamina
    if (punishing) u += 0.9 - mv.startup * 0.03;
    if (exploitTell && mv.zone === 'head' && mv.kind === 'strike') u += 1.6;
    if (mv.telegraph > 0.45) u -= 0.4 * (1 - ag);
    const longKick = rk > 0 && LONG_KICKS.has(id);
    if (longKick) {
      if (oppEntering) u += 1.3 * rk;                       // patada de parada al que entra
      if (d > oppJab) u += 0.5 * rk;                        // fuera del jab rival: la patada es gratis
      else if (!oppEntering) u -= 0.9 * rk;                 // dentro de su jab la patada se paga: puño o salir
    }
    // Instinto de cierre del pateador: rival con piernas/cuerpo rotos -> patada alta (no lo ve, no sale) o al hígado.
    if (rk > 0 && area === 'kick') {
      const oL = Math.min(1, opp.dmg.legs / opp.attr.legsCap), oB = Math.min(1, opp.dmg.body / opp.attr.bodyCap);
      if (mv.zone === 'head') u += KILL_HEAD * rk * Math.max(0, oL - 0.35 + 0.5 * (oB - 0.35));
      else if (mv.zone === 'body') u += KILL_BODY * rk * Math.max(0, oB - 0.3);
    }
    if (!punishing && !(opp.rocked > 0) && !exploitTell && !(longKick && oppEntering) && F.t >= opp.feintBit) u -= F.opt.tempoCost * (1.2 - ag); // costo de tempo: no tirar por tirar
    if (id === 'jab') u += JAB_BIAS + (s.jabBias ?? 0);          // el jab mide, abre y marca el ritmo
    if (id === self.lastMove) u -= s.noRepeat ?? 0.5;              // no repetir el mismo golpe suelto
    if (exploitTell && id === 'highKick' && MOVES[oppLastMove]?.limb?.startsWith('foot')) u += 0.8; // bajó la mano al patear -> patada alta
    if (calm) u -= id === 'jab' ? CALM_JAB : CALM_PEN * (1 - 0.4 * urgent);
    opts.push({ kind: 'action', move: id, u, exploit: exploitTell && mv.zone === 'head', punish: punishing });
  }

  // ----- derribos -----
  const myW = prowess(self, 'wrestling');
  const estOppW = 0.5 * prowess(opp, 'wrestling') + 0.5 * (1 - m.td[0] / m.td[1]) * 0.9; // mezcla de "lo que ve" y lo que aprendió
  for (const id of TAKEDOWNS) {
    const mv = MOVES[id];
    if (!reachable(F, mv, d)) continue;
    if (self.stamina < mv.stamina * 1.4) continue;
    let u = ln(s.td * 2.6 * skill(self, 'wrestling') + 0.005) + 2.2 * rel(myW, estOppW);
    if (opp.rocked > 0) u += 0.7;
    if (losingStand) u += 0.6 * (myW > 0.55 ? 1 : 0.3);
    if (oppRecovering && opp.action && MOVES[opp.action.move]?.limb?.startsWith('foot')) u += 0.6;
    // Rendimiento decreciente: cada derribo fallado/sprawleado pesa más, y cada intento de la pelea un poco.
    u -= self.tdFails * 0.5 * (1.25 - 0.5 * tec) + 0.5 * (F.stats[self.id]?.tdAtt ?? 0);
    u -= (1 - c.stamina) * 1.2;
    if (F.t - (self.lastTdT ?? -9999) < TD_GAP) u -= 2.0;    // anti-spam
    if (id === 'singleLeg') u -= 0.2;
    // derribo con preparación (golpe o finta antes): sin setup se ve venir
    if (!setupT && !(opp.rocked > 0) && !oppRecovering) u -= TD_NOSETUP * (s.tdSetup ?? 1);
    if (calm) u -= CALM_PEN;
    opts.push({ kind: 'action', move: id, u });
  }
  // ----- clinch -----
  if (d < 1.0 * U && s.clinch > 0.04) {
    let u = ln(s.clinch * 2.2 * skill(self, 'clinch')) + (losingStand ? 0.4 : 0) + (self.rocked > 0 ? 1.0 : 0) - (F.t - (self.lastClinchT ?? -9999) < 300 ? 1 : 0);
    if (c.stamina < 0.45) u += 0.6;                                   // cansado: amarrar
    if (losingStand && (opp.style.rangeKick ?? 0) + (opp.style.td < 0.2 ? 0.5 : 0) > 0.4) u += 0.4; // frenar al striker que le gana afuera
    if (calm) u -= 1.5;
    opts.push({ kind: 'action', move: 'clinchEntry', u });
  }
  // ----- amago -----
  // Finta con seguimiento ya decidido: la de derribo (cambio de nivel) abre arriba, la de golpe abre el shoot/cuerpo.
  if (d < 1.6 * U && s.feint + self.profile.quirks.feint > 0.03) {
    // en tanteo la finta es para leer la reacción (sin seguimiento); en ráfaga lleva su golpe/derribo
    const fol = calm ? (reachable(F, MOVES.jab, d) ? { variant: s.td > 0.3 && rng.chance(0.5) ? 'takedown' : 'strike', move: rng.chance(0.85) ? 'jab' : null } : null) : feintFollow(F, self, opp, d, rng);
    if (fol) {
      const bite = m.feint[0] / m.feint[1];
      opts.push({ kind: 'feint', variant: fol.variant, follow: fol.move, u: ln((s.feint + self.profile.quirks.feint) * 2.6) + 1.2 * (bite - 0.4) + FEINT_BIAS - (self.lastWasFeint ? 1.5 : 0) + (calm ? CALM_FEINT : 0) });
    }
  }
  // ----- distancia -----
  // si el rival le gana a distancia larga (patadas a la pierna), acortar: cortarle el ring al pateador
  const kickedOut = (opp.style.rangeKick ?? 0) > 0 && opp.style.range > s.range ? Math.min(1, self.dmg.legs / self.attr.legsCap) * 0.5 : 0;
  const pref = s.range + F.opt.neutralGap + (self.rocked > 0 ? 0.5 : 0) - kickedOut;
  const err = d / U - pref;
  // avanzar (detrás del jab: el que presiona entra) / cortar el ángulo si el rival está cerca de la reja
  const adv = 2.2 * err + 1.0 * ag - 0.5 + (cornered(F, opp) && ag > 0.5 ? 0.3 : 0) + (nearCage ? 0.6 : 0);
  if (oppNearCage && ag > 0.4) opts.push({ kind: 'move', dir: 1, foot: 'cutAngle', u: adv + 0.3 + 0.6 * ag, ticks: rng.int(10, 18) });
  else opts.push({ kind: 'move', dir: 1, foot: 'advance', u: adv, ticks: rng.int(8, 18) });
  // retroceder (el pateador no se deja meter en distancia de puños); contra la reja no se recula: se pivotea
  const back = (rk > 0 && d < oppJab - 4 && !nearCage ? 0.8 * rk : 0) - 2.2 * err + 0.9 * (1 - ag) - 0.7 + (self.rocked > 0 ? 1.4 : 0) + (c.stamina < 0.3 ? 0.4 : 0);
  if (nearCage) opts.push({ kind: 'move', dir: -1, foot: 'pivot', u: back + 0.8 + 1.0 * rk + (selfCornered ? 0.8 : 0), ticks: rng.int(16, 24), orbitDir: rng.chance(0.75) ? 1 : -1 });
  else opts.push({ kind: 'move', dir: -1, foot: 'retreat', u: back - (backToWall && wallGap < 90 ? 1.0 : 0), ticks: rng.int(8, 16) });
  // rebote (stepIn/stepOut): ritmo en la distancia, más en tanteo
  if (Math.abs(err) < 0.4) {
    const bounce = -0.6 + 0.4 * tec + (calm ? 0.9 : 0) + (s.bounce ?? 0);
    opts.push({ kind: 'move', dir: 1, foot: 'stepIn', u: bounce + 0.3 * err * -1, ticks: rng.int(5, 8), next: rng.int(6, 11) });
    if (!nearCage) opts.push({ kind: 'move', dir: -1, foot: 'stepOut', u: bounce + 0.3 * err, ticks: rng.int(5, 8), next: rng.int(6, 11) });
  }
  // circular: se orbita al rival a media distancia (el que lee el combate se mueve de lado, no sólo atrás/adelante)
  if (Math.abs(err) < 0.5 && !nearCage) opts.push({ kind: 'move', dir: -1, foot: 'circle', u: -0.3 + 0.5 * tec + 0.5 * (1 - ag) + 0.4 * rk + (calm ? 0.6 : 0), ticks: rng.int(14, 26), orbitDir: rng.chance(0.75) ? 1 : -1 });
  // esperar / contragolpear (paciencia)
  opts.push({ kind: 'wait', u: ln(0.25 + s.counter * 1.6) + 0.6 * (1 - ag) + self.profile.quirks.patience + (c.stamina < 0.35 ? 0.6 : 0) - Math.abs(err) * 1.5 + 0.5 + (calm ? 0.5 : 0), ticks: rng.int(12, 34) });

  if (F.reach) distanceIQ(F, self, opp, opts, { d, c, co, ag, calm, punishing, oppRecovering, oppJab, nearCage, rng });

  const temp = 0.75 - 0.35 * tec;
  const pick = rng.softmax(opts, (o) => o.u, temp);
  if (pick.kind === 'action') {
    const mv = MOVES[pick.move];
    let combo = [];
    if (mv.kind === 'strike' && rng.chance(s.combo * (0.5 + 0.5 * c.stamina) + (opp.rocked > 0 ? 0.3 : 0))) combo = buildCombo(F, self, pick.move, rng);
    return { kind: 'action', move: pick.move, combo, exploit: pick.exploit, punish: pick.punish };
  }
  return pick;
}

// IA de distancia (sólo 3D: F.reach). Cada peleador estima si le conviene entrar: stamina y daño propios contra los
// del rival, guardia del rival, y si el estilo del otro es más largo. Entra detrás de una finta (no caminando a pelo
// dentro del jab rival), castiga al que se sobreextiende (golpe al aire en recovery) y, si no le conviene, sale o gira.
export function entryEdge(self, opp, c, co) {
  const dmg = (x) => Math.min(1, (x.dmg.head / x.attr.headCap + x.dmg.body / x.attr.bodyCap + 0.5 * x.dmg.legs / x.attr.legsCap) / 2.5);
  return clamp(1.1 * (c.stamina - co.stamina) + 1.4 * (dmg(opp) - dmg(self)) + 0.9 * (0.75 - (opp.guard ?? 0.75))
    + (opp.rocked > 0 ? 0.8 : 0) - (self.rocked > 0 ? 0.8 : 0) + 0.6 * (self.attr.moveSpeed / Math.max(1e-3, opp.attr.moveSpeed) - 1), -1.5, 1.5);
}
function distanceIQ(F, self, opp, opts, k) {
  const { d, ag, calm, punishing, oppRecovering, oppJab, nearCage } = k;
  const edge = entryEdge(self, opp, k.c, k.co);
  self.entryEdge = edge;
  const myJab = rw(F, MOVES.jab);
  const outside = d > myJab.rangeMax;                    // fuera de mi jab: para pegar hay que entrar
  const inOppRange = d <= oppJab + 4;                    // dentro del jab rival
  const oppReady = !opp.action && opp.down <= 0 && !oppRecovering && F.t >= (opp.feintBit ?? -1);
  const overext = punishing || (oppRecovering && opp.action && opp.action.result === 'miss');
  for (const o of opts) {
    if (o.kind === 'move' && o.dir > 0) {
      o.u += 0.7 * edge;
      // entrar caminando a pelo, con el rival listo y la guardia arriba, se paga: mejor detrás de una finta
      if (outside && oppReady && !overext) o.u -= 0.4 * clamp(opp.guard ?? 0.7, 0, 1);
      if (overext) o.u += 2.2;                           // se sobreextendió: cerrar ya
    } else if (o.kind === 'move' && o.dir < 0) {
      o.u -= 0.6 * edge;
      if (inOppRange && oppReady && edge < -0.2 && !nearCage) o.u += 0.6 * -edge; // no me conviene estar acá
    } else if (o.kind === 'wait') {
      if (inOppRange && oppReady && edge < 0.3) o.u -= 0.8;   // quieto en su jab sin ventaja: lo peor
    } else if (o.kind === 'feint') {
      if (!calm && outside && d < 1.6 * U) o.u += 0.7 + 0.4 * Math.max(0, edge) + 0.3 * ag; // la finta cubre la entrada
    } else if (o.kind === 'action' && MOVES[o.move].kind === 'strike') {
      if (overext) o.u += 1.6 - 0.04 * MOVES[o.move].startup; // castigo: lo rápido primero
      else if (F.t < (self.feintFollow ?? -1)) o.u += 0.4;  // la finta abrió: tirar ya
    }
  }
  if (overext && !opts.some((o) => o.kind === 'action' && MOVES[o.move].kind === 'strike' && o.punish)) {
    opts.push({ kind: 'move', dir: 1, foot: 'stepIn', u: 1.5 + 0.5 * ag, ticks: 6, next: 3 }); // sin golpe a mano: paso adentro y re-decidir
  }
}

// Urgencia 0..1: último round y perdiendo de pie (o muy atrás en daño) -> menos pausas, más volumen.
export function urgency(F, self) {
  if (F.round < F.opt.rounds) return 0;
  const m = self.mem;
  if (!m) return 0;
  const behind = m.dmgTakenStand - m.dmgDealtStand;
  return clamp(behind / 25, 0, 1);
}

// Elige la finta y su golpe/derribo de seguimiento (alcanzable desde la distancia actual).
function feintFollow(F, self, opp, d, rng) {
  const s = self.style;
  const tdOk = s.td > 0.25 && self.stamina > 12 && F.t - (self.lastTdT ?? -9999) >= TD_GAP;
  const tds = tdOk ? TAKEDOWNS.filter((id) => reachable(F, MOVES[id], d)) : [];
  // finta de derribo -> golpe arriba (la guardia baja); finta de golpe -> shoot o al cuerpo/pierna
  const high = ['cross', 'overhand', 'hook', 'highKick', 'jab'].filter((id) => (s.moveW[id] ?? 0.3) >= 0.25 && reachableAI(F, MOVES[id], d));
  const low = ['bodyKick', 'lowKick', 'bodyHook', 'bodyCross', 'calfKick', 'cross'].filter((id) => (s.moveW[id] ?? 0.3) >= 0.25 && reachableAI(F, MOVES[id], d));
  const tdFeint = s.td > 0.15 && high.length && rng.chance(0.3 + 0.6 * s.td);
  if (tdFeint) return { variant: 'takedown', move: rng.weighted(high.map((id) => ({ id, w: s.moveW[id] ?? 0.3 }))).id };
  if (tds.length && rng.chance(Math.min(0.85, 0.2 + s.td))) return { variant: 'strike', move: tds[0] };
  if (low.length) return { variant: 'strike', move: rng.weighted(low.map((id) => ({ id, w: s.moveW[id] ?? 0.3 }))).id };
  if (high.length) return { variant: 'strike', move: high[0] };
  return null;
}

// Combo reactivo: el siguiente golpe se ajusta a lo que hizo el rival con el anterior.
//  bloqueó arriba -> al cuerpo; esquivó / se fue -> gancho o uppercut; conectó -> sigue a la cabeza.
const TO_BODY = { cross: 'bodyCross', hook: 'bodyHook', jab: 'bodyCross', highKick: 'bodyKick' };
const TO_ARC = { cross: 'hook', jab: 'hook', bodyCross: 'uppercut' };
const LONGER = ['cross', 'jab', 'lowKick', 'bodyKick', 'calfKick', 'highKick'];
export function adaptNext(F, self, next, prev) {
  const rng = F.aiRng[self.id];
  const s = self.style;
  const ok = (id) => id && MOVES[id] && canUseMove(self, id) && (s.moveW[id] ?? 0.3) >= 0.25 && (MOVES[id].kind !== 'strike' || reachableAI(F, MOVES[id], dist(F), true, self));
  if (prev.result === 'block' && MOVES[next]?.zone === 'head' && ok(TO_BODY[next]) && rng.chance(0.55)) return TO_BODY[next];
  if (prev.result === 'dodge' && ok(TO_ARC[next]) && rng.chance(0.5)) return TO_ARC[next];
  // el rival se fue de la distancia: la mano/patada larga sigue la cadena (no se tira al aire)
  if (MOVES[next]?.kind === 'strike' && !ok(next)) {
    const alt = LONGER.filter((id) => id !== prev.move && ok(id));
    if (alt.length) return rng.weighted(alt.map((id) => ({ id, w: s.moveW[id] ?? 0.3 }))).id;
  }
  return next;
}

function buildCombo(F, self, first, rng) {
  const s = self.style;
  const tdOk = F.t - (self.lastTdT ?? -9999) >= TD_GAP;
  const fits = s.combos.filter((c) => c[0] === first && (tdOk || !c.some((id) => MOVES[id].kind === 'takedown')) && c.every((id) => canUseMove(self, id)));
  if (fits.length && rng.chance(0.75)) return fits[Math.floor(rng.next() * fits.length)].slice(1);
  const out = [];
  let cur = first;
  const len = rng.chance(0.3 + 0.5 * s.combo) ? (rng.chance(s.combo) ? 3 : 2) : 1;
  for (let i = 0; i < len; i++) {
    const nx = (FOLLOW[cur] ?? []).filter((id) => canUseMove(self, id) && (s.moveW[id] ?? 0.3) >= 0.3 && (MOVES[id].kind === 'strike' || (s.td > 0.2 && tdOk)));
    if (!nx.length) break;
    cur = rng.weighted(nx.map((id) => ({ id, w: s.moveW[id] ?? 0.3 }))).id;
    out.push(cur);
    if (MOVES[cur].kind !== 'strike') break;
  }
  return out;
}

function decideClinch(F, self, opp) {
  const rng = F.aiRng[self.id];
  const s = self.style;
  const c = condition(self);
  const opts = [];
  const myC = prowess(self, 'clinch'), opC = prowess(opp, 'clinch');
  for (const id of CLINCH_MOVES) {
    const mv = MOVES[id];
    if (self.stamina < mv.stamina * 1.2 && id !== 'breakClinch') continue;
    let u;
    if (mv.kind === 'strike') {
      const w = id === 'clinchKneeHead' ? (s.skill.clinch > 1.15 ? 1.3 : 0.4) : id === 'clinchElbow' ? (s.moveW.standElbow ?? 0.3) + 0.2 : id === 'dirtyUppercut' ? (s.moveW.uppercut ?? 0.5) : 1;
      u = ln(w * skill(self, 'clinch')) + mv.damage * mv.accuracy / 6 - mv.stamina / (2 + 10 * c.stamina) + (opp.rocked > 0 ? 0.6 : 0);
    } else if (mv.kind === 'takedown') {
      u = ln(s.td * 2.4 * skill(self, 'wrestling') + 0.02) + 2 * rel(prowess(self, 'wrestling'), prowess(opp, 'wrestling')) - self.tdFails * 0.15 - (F.t - (self.lastTdT ?? -9999) < TD_GAP ? 1.5 : 0);
    } else {
      u = ln(0.3 + (1 - s.clinch) * 1.2) + 1.5 * rel(opC, myC) + (self.rocked > 0 ? -0.5 : 0);
    }
    opts.push({ kind: 'action', move: id, u });
  }
  opts.push({ kind: 'wait', u: CLINCH_WAIT + (c.stamina < 0.3 ? 0.8 : 0) + (self.rocked > 0 ? 0.8 : 0), ticks: rng.int(18, 40) }); // pelea de manos/underhooks entre golpes
  return rng.softmax(opts, (o) => o.u, 0.7 - 0.3 * self.attr.technique);
}

function decideGround(F, self, opp) {
  const rng = F.aiRng[self.id];
  const s = self.style;
  const g = F.ground;
  const top = g.top === self;
  const c = condition(self);
  const opts = [];
  const myG = prowess(self, 'ground'), opG = prowess(opp, 'ground');
  for (const id of GROUND_MOVES) {
    const mv = MOVES[id];
    if (mv.side !== (top ? 'top' : 'bottom') || !mv.pos.includes(g.pos)) continue;
    if (self.stamina < mv.stamina && mv.kind !== 'escape') continue;
    let u;
    if (mv.kind === 'strike') {
      u = ln((top ? s.gnp * 2 + 0.2 : 0.35) * (id === 'gnpElbow' ? 0.8 + (s.moveW.standElbow ?? 0.3) : 1)) + mv.damage * mv.accuracy / 5
        + (opp.dazed > 0 ? 1.4 : 0) + (opp.dmg.head / opp.attr.headCap) * 0.8;
    } else if (mv.kind === 'sub') {
      const edge = subOffense(self, mv) - subDefense(opp);
      u = ln(s.sub * 3 * skill(self, 'subs') + 0.04) + 3 * edge - self.mem.subFails * 0.3 - (1 - c.stamina) * 1.2 + (opp.dazed > 0 ? 0.6 : 0);
      if (id === 'rnc') u += 1.0;
      else if (id === 'heelHook' || id === 'kneeBar') u -= 0.28; // clips ok; frena spam T12 (SUB≤35% wins)
      else if (id === 'guillotine' || id === 'armTriangle') u -= 0.12; // clips listos (6926792); peer-normal (antes −1.2)
      // Instinto de cierre: rival cansado o golpeado se expone (cualquier estilo va por la sumisión desde arriba/espalda).
      const hurt = Math.max(0, 0.6 - condition(opp).stamina) + 0.8 * Math.min(1, opp.dmg.head / opp.attr.headCap) + (opp.dazed > 0 ? 0.4 : 0);
      u += F.opt.subInstinct * hurt * (top || g.pos === 'back' ? 1 : 0.5);
    } else if (id === 'pass') {
      u = ln(0.4 + (1 - s.gnp) * 0.8 + s.sub * 0.6) + 2 * rel(myG, opG) + (g.exposed > F.t ? 0.8 : 0) - (POSITION_VALUE[g.pos] >= 3 ? 0.4 : 0);
    } else if (id === 'takeBack') {
      u = ln(0.15 + s.sub * 0.8) + 2 * rel(myG, opG) + (g.exposed > F.t ? 1.4 : 0);
    } else if (id === 'disengage') {
      const striker = 1 - Math.min(1, skill(self, 'ground'));
      u = ln(0.03 + striker * 1.3 * (1 - s.td)) + opp.style.groundBottomOk * 1.0 + 1.5 * rel(opG, myG);
    } else if (id === 'sweep') {
      u = ln(0.35 + s.groundBottomOk * 0.8) + 2 * rel(myG, opG);
    } else if (id === 'getUp') {
      u = ln(0.45 + (1 - s.groundBottomOk) * 1.3) + (g.pos === 'guard' ? 0.2 : g.pos === 'half' ? 0 : -0.5) + 1.5 * rel(prowess(self, 'wrestling'), prowess(opp, 'wrestling')) + (c.stamina - 0.5) * 0.8 - 0.3 * Math.min(4, self.getUpFails || 0) - 0.8 * (opp.style.topControl ?? 0);
    } else if (id === 'shrimp') {
      u = ln(1.2) + (POSITION_VALUE[g.pos] - 2) * 0.5 - 0.3 * Math.min(4, self.getUpFails || 0);
    } else u = -2;
    if (id === self.gLast) u -= 0.7 * Math.max(0, self.gRun - 1); // no repetir el mismo intento en loop (getUp/shrimp/pass)
    opts.push({ kind: 'action', move: id, u });
  }
  opts.push({ kind: 'wait', u: ln(top ? 0.35 : 0.15) + (c.stamina < 0.3 ? 1 : 0) + (self.gRun >= 3 ? 0.8 : 0), ticks: rng.int(8, 18) });
  const pick = rng.softmax(opts, (o) => o.u, 0.7 - 0.3 * self.attr.technique);
  const key = pick.kind === 'action' ? pick.move : null;
  if (key && key === self.gLast) self.gRun++;
  else if (key) { self.gLast = key; self.gRun = 1; }
  return pick;
}
