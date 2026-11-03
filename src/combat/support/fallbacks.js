// Fallbacks de Engine para que el juego SIEMPRE arranque aunque anim/fight/render
// no existan todavía o fallen. Implementan los contratos de src/shared/contracts.js.
// Son deliberadamente simples: los módulos reales de cada Rick los reemplazan.
import { JOINTS, ACTIONS, FIGHT_EVENTS, TICK_RATE, UNITS, emptyPose } from '../kage-contracts.js';
import { createRng } from './rng.js';

// ─────────────────────────── ANIM fallback ───────────────────────────
// Escala 1.5 => ~150 px pies→cabeza = UNITS.FIGHTER_HEIGHT (mismo tamaño que el rig de src/anim).
const FBS = 1.5;
const L = { spine: 22 * FBS, neck: 22 * FBS, head: 12 * FBS, upper: 17 * FBS, fore: 16 * FBS, thigh: 23 * FBS, shin: 23 * FBS };
const dir = (a) => ({ x: Math.sin(a), y: Math.cos(a) }); // a=0 abajo, a=π/2 adelante, a=π arriba
const add = (p, a, len) => { const d = dir(a); return { x: p.x + d.x * len, y: p.y + d.y * len }; };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Curva de golpe: sube rápido, sostiene, vuelve. t en s, dur total en s. */
function strikeCurve(t, dur) {
  const u = t / dur;
  if (u < 0.35) return ease(u / 0.35);
  if (u < 0.55) return 1;
  return 1 - ease((u - 0.55) / 0.45);
}

/** Ángulos objetivo por acción. */
function targetAngles(action, at, t, vx, breath) {
  // lean: inclinación de torso (+ adelante). Brazos: [upper, fore]. Piernas: [thigh, shin].
  const g = {
    lean: 0.08, armL: [0.55, 2.55], armR: [0.85, 2.35],
    legF: [0.35, -0.05], legB: [-0.3, -0.05], head: 0, spin: 0,
  };
  const b = Math.sin(t * 2 * Math.PI * breath) * 0.04;
  g.armL[0] += b; g.armR[0] += b; g.lean += b * 0.5;
  switch (action) {
    case ACTIONS.IDLE:
      g.lean = 0.02 + b; g.armL = [0.15 + b, 0.3]; g.armR = [0.2 + b, 0.35];
      g.legF = [0.15, 0]; g.legB = [-0.12, 0];
      break;
    case ACTIONS.WALK: {
      const ph = t * Math.PI * 2 * 1.8 * Math.sign(vx || 1);
      g.legF = [0.35 + Math.sin(ph) * 0.35, -0.1 - Math.max(0, Math.cos(ph)) * 0.4];
      g.legB = [-0.3 - Math.sin(ph) * 0.35, -0.1 - Math.max(0, -Math.cos(ph)) * 0.4];
      break;
    }
    case ACTIONS.JAB: {
      const k = strikeCurve(at, 0.3);
      g.armR = [lerp(0.85, 1.6, k), lerp(2.35, 1.58, k)]; g.lean = 0.08 + 0.1 * k;
      break;
    }
    case ACTIONS.CROSS: {
      const k = strikeCurve(at, 0.43);
      g.armL = [lerp(0.55, 1.62, k), lerp(2.55, 1.6, k)]; g.lean = 0.08 + 0.25 * k;
      g.legB = [-0.3 - 0.15 * k, -0.05];
      break;
    }
    case ACTIONS.KICK: {
      const k = strikeCurve(at, 0.56);
      g.legF = [lerp(0.35, 1.5, k), lerp(-0.05, 1.55, k)]; g.lean = 0.08 - 0.35 * k;
      g.armL = [0.4, 2.2]; g.armR = [0.3 + 0.5 * k, 1.8];
      break;
    }
    case ACTIONS.HIT: {
      const k = 1 - ease(at / 0.25);
      g.lean = 0.08 - 0.45 * k; g.head = -0.5 * k; g.armL = [0.3, 1.5]; g.armR = [0.6 - 0.8 * k, 1.2];
      break;
    }
    case ACTIONS.BLOCK:
      g.armL = [1.05, 2.95]; g.armR = [1.15, 2.95]; g.lean = 0.0;
      break;
    case ACTIONS.DODGE: {
      const k = strikeCurve(at, 0.2);
      g.lean = 0.08 - 0.5 * k; g.legF = [0.6, -0.6 * k]; g.legB = [-0.1, -0.7 * k];
      break;
    }
    case ACTIONS.KO:
      g.armL = [1.8, 2.2]; g.armR = [2.4, 2.6]; g.legF = [0.4, 0.1]; g.legB = [-0.1, 0.2];
      g.lean = -0.2; g.spin = -ease(at / 0.6) * Math.PI / 2;
      break;
    case ACTIONS.VICTORY: {
      const w = Math.sin(t * 6) * 0.1;
      g.armL = [2.7 + w, 3.0]; g.armR = [2.9 - w, 3.1]; g.lean = -0.05;
      break;
    }
    case ACTIONS.EAT:
      g.armR = [0.9, 3.0 + Math.sin(t * 8) * 0.15]; g.lean = 0.15;
      break;
    case ACTIONS.TRAIN: {
      const k = Math.abs(Math.sin(t * 5));
      g.armR = [lerp(0.85, 1.6, k), lerp(2.35, 1.6, k)]; g.armL = [lerp(1.6, 0.55, k), lerp(1.6, 2.55, k)];
      break;
    }
    // v2: grappling/suelo (aproximaciones; anim real las reemplaza)
    case ACTIONS.CLINCH:
      g.armL = [1.5, 2.1]; g.armR = [1.6, 2.0]; g.lean = 0.35; g.head = 0.2;
      break;
    case ACTIONS.SHOOT: {
      const k = strikeCurve(at, 0.5);
      g.lean = 0.2 + 0.9 * k; g.armL = [1.2, 1.7]; g.armR = [1.3, 1.6];
      g.legF = [0.9 * k + 0.35, -1.2 * k]; g.legB = [-0.5 - 0.3 * k, -0.2];
      break;
    }
    case ACTIONS.SPRAWL:
      g.lean = 1.1; g.armL = [1.2, 1.2]; g.armR = [1.1, 1.1]; g.legF = [-0.6, 0]; g.legB = [-0.9, 0];
      break;
    case ACTIONS.GROUND_TOP:
      g.lean = 0.9; g.armL = [0.6 + Math.abs(Math.sin(t * 7)) * 0.8, 1.2]; g.armR = [0.9, 0.9];
      g.legF = [1.6, -1.5]; g.legB = [1.4, -1.4];
      break;
    case ACTIONS.GROUND_BOTTOM:
    case ACTIONS.SUB:
      g.spin = -Math.PI / 2; g.lean = 0; g.armL = [2.0, 2.4]; g.armR = action === ACTIONS.SUB ? [1.6, 2.8] : [2.2, 2.6];
      g.legF = [1.2, -1.0]; g.legB = [1.0, -1.2];
      break;
    case ACTIONS.GET_UP:
      g.spin = -(1 - ease(at / 0.8)) * Math.PI / 2; g.legF = [0.6, -0.6]; g.legB = [-0.2, -0.4];
      break;
    case ACTIONS.FEINT: {
      const k = strikeCurve(at, 0.25) * 0.4;
      g.armR = [lerp(0.85, 1.6, k), lerp(2.35, 1.58, k)]; g.lean = 0.08 + 0.15 * k;
      break;
    }
    default: break; // GUARD o desconocida
  }
  return g;
}

function buildPose(g) {
  const p = emptyPose();
  const lean = g.lean;
  p.pelvis = { x: 0, y: 0 };
  p.spine = add(p.pelvis, Math.PI - lean, L.spine);
  p.neck = add(p.spine, Math.PI - lean * 1.2, L.neck);
  p.head = add(p.neck, Math.PI - lean - g.head, L.head);
  p.shoulderL = { ...p.neck }; p.shoulderR = { ...p.neck };
  p.elbowL = add(p.shoulderL, g.armL[0], L.upper); p.handL = add(p.elbowL, g.armL[1], L.fore);
  p.elbowR = add(p.shoulderR, g.armR[0], L.upper); p.handR = add(p.elbowR, g.armR[1], L.fore);
  p.hipL = { x: -1.5 * FBS, y: 0 }; p.hipR = { x: 1.5 * FBS, y: 0 };
  // R = pierna adelantada (lead), L = trasera
  p.kneeR = add(p.hipR, g.legF[0], L.thigh); p.footR = add(p.kneeR, g.legF[0] + g.legF[1], L.shin);
  p.kneeL = add(p.hipL, g.legB[0], L.thigh); p.footL = add(p.kneeL, g.legB[0] + g.legB[1], L.shin);
  if (g.spin) {
    const c = Math.cos(g.spin), s = Math.sin(g.spin);
    for (const j of JOINTS) { const { x, y } = p[j]; p[j] = { x: x * c - y * s, y: x * s + y * c }; }
  }
  return p;
}

/** Contrato anim: createRig(opts) => Rig */
export function createRig(opts = {}) {
  const rng = createRng(opts.seed ?? 1);
  return {
    fallback: true,
    scale: opts.scale ?? 1,
    breath: 0.22 + rng.range(-0.03, 0.03),
    angles: null,
    pose: buildPose(targetAngles(ACTIONS.IDLE, 0, 0, 0, 0.22)),
  };
}

/** Contrato anim: updateRig(rig, dt, input) => Pose. Suaviza hacia la pose objetivo (determinista). */
export function updateRig(rig, dt, input) {
  const tgt = targetAngles(input.action, input.actionT ?? 0, input.t ?? 0, input.vx ?? 0, rig.breath);
  const fast = [ACTIONS.JAB, ACTIONS.CROSS, ACTIONS.KICK, ACTIONS.HIT].includes(input.action);
  const k = 1 - Math.exp(-dt * (fast ? 40 : 14));
  if (!rig.angles) rig.angles = structuredCloneAngles(tgt);
  const a = rig.angles;
  a.lean = lerp(a.lean, tgt.lean, k); a.head = lerp(a.head, tgt.head, k);
  a.spin = [ACTIONS.KO, ACTIONS.GET_UP].includes(input.action) ? tgt.spin : lerp(a.spin, tgt.spin, k);
  for (const key of ['armL', 'armR', 'legF', 'legB']) {
    a[key][0] = lerp(a[key][0], tgt[key][0], k); a[key][1] = lerp(a[key][1], tgt[key][1], k);
  }
  rig.pose = buildPose(a);
  return rig.pose;
}
const structuredCloneAngles = (g) => ({ ...g, armL: [...g.armL], armR: [...g.armR], legF: [...g.legF], legB: [...g.legB] });

// ─────────────────────────── FIGHT fallback ───────────────────────────
// Implementa las TRES funciones del contrato fight v2: createFight/tickFight (en vivo) y simulateFight.
// Unidades px (UNITS). Usa las 7 stats; si llega un FighterSpec con 4, deriva las que faltan.
const MOVES = {
  jab:   { action: ACTIONS.JAB,   impact: 8,  total: 18, range: 78, dmg: 4, stam: 0.05, limb: 'handR', target: 'head' },
  cross: { action: ACTIONS.CROSS, impact: 12, total: 26, range: 82, dmg: 7, stam: 0.09, limb: 'handL', target: 'head' },
  kick:  { action: ACTIONS.KICK,  impact: 16, total: 34, range: 98, dmg: 9, stam: 0.12, limb: 'footR', target: 'body' },
};
const ARENA = UNITS.ARENA_HALF_WIDTH;
const DEFAULT_MAX_TICKS = TICK_RATE * 45;

/** Stats del spec con las 7 claves (deriva mandibula/cardio/lucha si faltan). */
function fullStats(st = {}) {
  const n = (k, d) => (Number.isFinite(st[k]) ? st[k] : d);
  const s = { fuerza: n('fuerza', 10), velocidad: n('velocidad', 10), tecnica: n('tecnica', 10), resistencia: n('resistencia', 10) };
  s.mandibula = n('mandibula', s.resistencia); s.cardio = n('cardio', s.resistencia); s.lucha = n('lucha', (s.fuerza + s.tecnica) / 2);
  return s;
}

/** Contrato fight: createFight(p1, p2, seed) => Fight (opaco). */
export function createFight(specA, specB, seed = 1, opts = {}) {
  const rng = createRng(seed);
  const mk = (spec, x) => {
    const s = fullStats(spec?.stats);
    const maxHp = Math.round(70 + s.resistencia * 1.2 + s.mandibula * 0.8);
    return { spec, s, x, hp: maxHp, maxHp, stamina: 1, action: ACTIONS.GUARD, actionStart: 0, busyUntil: 0, cooldown: 20 + rng.int(0, 20), move: null, impactAt: -1, facing: 1 };
  };
  return {
    fallback: true, seed: seed >>> 0, rng, tick: -1, acc: 0,
    maxTicks: opts.maxTicks ?? DEFAULT_MAX_TICKS,
    F: { a: mk(specA, -140), b: mk(specB, 140) },
    winner: null, reason: null, endTick: -1, done: false, frame: null,
  };
}

/** Contrato fight: tickFight(fight, dt, input?) => FightFrame. Avanza round(dt*TICK_RATE) ticks (mín. 1). */
export function tickFight(fight, dt = 1 / TICK_RATE, _input) {
  const n = Math.max(1, Math.round(dt * TICK_RATE));
  let events = [];
  for (let i = 0; i < n && !fight.done; i++) events = events.concat(stepOnce(fight));
  fight.frame = { ...fight.frame, events };
  return fight.frame;
}

function stepOnce(fight) {
  const { F, rng } = fight;
  const tick = ++fight.tick;
  const events = [];
  const setAction = (f, action, busy = 0) => { if (f.action !== action) { f.action = action; f.actionStart = tick; } f.busyUntil = tick + busy; };
  const snap = (f) => ({ x: Math.round(f.x * 100) / 100, hp: Math.max(0, Math.round(f.hp * 10) / 10), maxHp: f.maxHp, stamina: Math.round(f.stamina * 1000) / 1000, action: f.action, actionT: (tick - f.actionStart) / TICK_RATE, facing: f.facing });

  for (const id of ['a', 'b']) {
    const me = F[id], other = id === 'a' ? 'b' : 'a', foe = F[other];
    me.facing = me.x <= foe.x ? 1 : -1;
    if (me.action === ACTIONS.KO || me.action === ACTIONS.VICTORY) continue;
    const s = me.s;
    me.stamina = Math.min(1, me.stamina + 0.0025 * (1 + s.cardio / 40));
    if (me.cooldown > 0) me.cooldown--;
    const dist = Math.abs(foe.x - me.x);

    if (me.move && tick === me.impactAt) {
      const mv = me.move;
      if (dist > mv.range + 8) {
        events.push({ tick, type: FIGHT_EVENTS.WHIFF, actor: id, limb: mv.limb, target: mv.target });
      } else if (foe.action !== ACTIONS.KO) {
        const fs = foe.s;
        const canReact = tick >= foe.busyUntil;
        const pBlock = canReact ? 0.12 + fs.tecnica / 220 : 0;
        const pDodge = canReact ? Math.max(0.03, 0.08 + fs.velocidad / 260 - s.velocidad / 400) : 0;
        const r = rng.next();
        const power = mv.dmg * (0.6 + s.fuerza / 25) * (0.75 + 0.25 * me.stamina + 0.1 * (s.tecnica / 30));
        if (r < pDodge) {
          setAction(foe, ACTIONS.DODGE, 12);
          foe.x -= foe.facing * 14;
          events.push({ tick, type: FIGHT_EVENTS.DODGE, actor: other, limb: mv.limb, target: mv.target });
        } else if (r < pDodge + pBlock) {
          const dmg = power * 0.15;
          foe.hp -= dmg;
          setAction(foe, ACTIONS.BLOCK, 10);
          foe.x -= foe.facing * 6;
          events.push({ tick, type: FIGHT_EVENTS.BLOCK, actor: other, limb: mv.limb, target: mv.target, power, damage: dmg, hitstop: 2 });
        } else {
          const dmg = power * rng.range(0.85, 1.15) * (1.15 - fs.mandibula / 400);
          foe.hp -= dmg;
          setAction(foe, ACTIONS.HIT, 14);
          foe.move = null; foe.impactAt = -1;
          foe.x -= foe.facing * (8 + dmg);
          events.push({ tick, type: FIGHT_EVENTS.HIT, actor: id, limb: mv.limb, target: mv.target, power, damage: dmg, hitstop: Math.round(3 + dmg / 2), angle: me.facing > 0 ? 0 : Math.PI });
          if (foe.hp <= 0) {
            foe.hp = 0;
            setAction(foe, ACTIONS.KO, 0);
            events.push({ tick, type: FIGHT_EVENTS.KO, actor: id, target: other });
            fight.winner = id; fight.reason = 'ko'; fight.endTick = tick + 100;
          }
        }
      }
      me.move = null;
    }
    if (fight.winner === id) { if (tick >= me.busyUntil) setAction(me, ACTIONS.VICTORY); continue; }
    if (tick < me.busyUntil) continue;

    const reach = 85;
    if (dist > reach) {
      me.x += me.facing * (55 + s.velocidad * 1.6) / TICK_RATE;
      setAction(me, ACTIONS.WALK);
    } else if (me.cooldown <= 0 && me.stamina > 0.1) {
      const roll = rng.next();
      if (roll < 0.06 + s.tecnica / 1000) {
        setAction(me, ACTIONS.FEINT, 14); me.cooldown = 10;
        events.push({ tick, type: FIGHT_EVENTS.FEINT, actor: id });
      } else {
        const key = dist > 82 ? 'kick' : roll < 0.5 ? 'jab' : roll < 0.8 ? 'cross' : 'kick';
        const mv = MOVES[key];
        me.move = mv; me.impactAt = tick + mv.impact;
        me.stamina = Math.max(0, me.stamina - mv.stam);
        me.cooldown = mv.total + rng.int(6, 30) - Math.round(s.velocidad / 6);
        me.action = ''; setAction(me, mv.action, mv.total);
        events.push({ tick, type: FIGHT_EVENTS.STRIKE, actor: id, limb: mv.limb, target: mv.target, power: mv.dmg, time: tick / TICK_RATE });
      }
    } else {
      if (dist < 55) me.x -= me.facing * 0.8;
      setAction(me, ACTIONS.GUARD);
    }
    me.x = Math.max(-ARENA, Math.min(ARENA, me.x));
  }
  const ended = (fight.endTick >= 0 && tick >= fight.endTick) || tick >= fight.maxTicks - 1;
  if (ended) {
    fight.done = true;
    if (!fight.winner) {
      const ra = F.a.hp / F.a.maxHp, rb = F.b.hp / F.b.maxHp;
      if (Math.abs(ra - rb) < 0.02) { fight.winner = null; fight.reason = 'draw'; }
      else { fight.winner = ra > rb ? 'a' : 'b'; fight.reason = 'decision'; }
      events.push({ tick, type: FIGHT_EVENTS.DECISION, actor: fight.winner ?? 'a', winner: fight.winner });
    }
    events.push({ tick, type: FIGHT_EVENTS.FIGHT_END, actor: fight.winner ?? 'a', winner: fight.winner, reason: fight.reason });
  }
  fight.frame = { tick, a: snap(F.a), b: snap(F.b), events, done: fight.done, winner: fight.done ? fight.winner : undefined, reason: fight.done ? fight.reason : undefined };
  return events;
}

/** Contrato fight: simulateFight(a, b, seed) => FightResult. Puro y determinista (= createFight + tickFight hasta done). */
export function simulateFight(specA, specB, seed = 1, opts = {}) {
  const fight = createFight(specA, specB, seed, opts);
  const ticks = [], events = [];
  while (!fight.done) {
    const fr = tickFight(fight, 1 / TICK_RATE);
    ticks.push({ tick: fr.tick, a: fr.a, b: fr.b });
    for (const e of fr.events) events.push(e);
  }
  return { seed: seed >>> 0, tickRate: TICK_RATE, ticks, events, winner: fight.winner, reason: fight.reason, fallback: true };
}

// ─────────────────────────── RENDER fallback ───────────────────────────
const BG = { menu: '#0e0f13', room: '#15131a', gym: '#121619', fight: '#16110f', result: '#0f1214' };

/** Contrato render: drawBackground(ctx, scene, view) */
export function drawBackground(ctx, scene, view) {
  const { w, h } = view;
  ctx.fillStyle = BG[scene] ?? '#0e0f13';
  ctx.fillRect(0, 0, w, h);
  const gy = groundY(h);
  ctx.fillStyle = 'rgba(239,230,212,0.05)';
  ctx.fillRect(0, gy, w, h - gy);
  ctx.strokeStyle = 'rgba(239,230,212,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
}

export const groundY = (h) => Math.round(h * UNITS.FLOOR_Y_RATIO);

const BONES = [
  ['pelvis', 'spine'], ['spine', 'neck'],
  ['neck', 'elbowL'], ['elbowL', 'handL'], ['neck', 'elbowR'], ['elbowR', 'handR'],
  ['pelvis', 'kneeL'], ['kneeL', 'footL'], ['pelvis', 'kneeR'], ['kneeR', 'footR'],
];

/** Contrato render: drawFighter(ctx, pose, opts) */
export function drawFighter(ctx, pose, opts) {
  const { x, y, facing = 1, scale = 1, color = '#efe6d4', flash = 0 } = opts;
  const P = (j) => [x + pose[j].x * facing * scale, y + pose[j].y * scale];
  ctx.save();
  ctx.strokeStyle = flash > 0 ? '#ffffff' : color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 4.5 * FBS * scale;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [a, b] of BONES) { const pa = P(a), pb = P(b); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); }
  ctx.stroke();
  const [hx, hy] = P('head');
  ctx.beginPath(); ctx.arc(hx, hy, 9 * FBS * scale, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
