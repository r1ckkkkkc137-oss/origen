// Métricas de animación (ronda 3): hook, guardia, reacciones, KO, climb. Uso: node scripts/anim-metrics.mjs [hook|guard|hurt|ko|climb|all]
import { simulate, simulateDuel, simulateGround, GROUND_ZONE, DUEL_DIST, FOOTWORK_SEGS, HURT_FORCE } from '../src/anim/scenarios.js';
import { buildColliders, segPenetration, penetration, sdist, CONTACT } from '../src/anim/contact.js';
import { CLIPS, HITSTOP } from '../src/anim/clips.js';
import '../src/anim/animator3d.js';

const D = 180 / Math.PI;
const sub = (a, b) => a.map((v, i) => v - b[i]); const len = (a) => Math.hypot(...a); const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const ang = (a, b, c) => Math.acos(Math.max(-1, Math.min(1, dot(sub(a, b), sub(c, b)) / len(sub(a, b)) / len(sub(c, b))))) * D;
const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
const unwrap = (a) => { for (let i = 1; i < a.length; i++) { while (a[i] - a[i - 1] > Math.PI) a[i] -= 2 * Math.PI; while (a[i] - a[i - 1] < -Math.PI) a[i] += 2 * Math.PI; } return a; };
const lineYaw = (P, a, b) => Math.atan2(P[b][2] - P[a][2], P[b][0] - P[a][0]);
export function rec(name, hz = 240, extra = {}) {
  const R = []; simulate(name, { hz, ...extra, onFrame: (t, sk, A) => R.push({ t, P: Object.fromEntries(Object.entries(sk.pose).map(([k, v]) => [k, v.slice()])), tips: Object.fromEntries(Object.entries(sk.tips).map(([k, v]) => [k, v.slice()])), fist: A.strike.fist.slice(), vis: sk.visualYaw, root: sk.root.pos.slice(), ct: A.clip ? A.clipT : -1, cn: A.clip ? A.clipMode.name : '' }) });
  return R;
}
export const T0 = 1.5;
// instante en que una señal con carga cruza el punto medio entre el extremo de la carga (lo opuesto al golpe) y el extremo del golpe
// ronda 5: iEnd (opcional) = índice del impacto: el golpe va de la carga al valor EN EL IMPACTO (con una carga grande, el extremo global puede ser la carga)
export function halfCross(sig, ts, frac = 0.5, iEnd = -1) {
  const a0 = sig[0]; let m = 0, im = 0; sig.forEach((v, i) => { if (Math.abs(v - a0) > Math.abs(m)) { m = v - a0; im = i; } });
  if (iEnd >= 0) { im = iEnd; m = sig[im] - a0; }
  let lo = a0, il = 0; for (let i = 0; i < im; i++) if ((sig[i] - lo) * Math.sign(m) < 0) { lo = sig[i]; il = i; }
  const tgt = lo + (sig[im] - lo) * frac; for (let i = il; i <= im; i++) if ((sig[i] - tgt) * Math.sign(m) >= 0) return ts[i];
  return ts[im];
}
const f2 = (v) => (+v).toFixed(2), f1 = (v) => (+v).toFixed(1);

// torso: ángulo de la columna (pelvis -> base del cuello) respecto de la vertical, y la inclinación hacia adelante (en el plano de la mirada)
export function torsoAngle(r) {
  const v = sub(r.P.neck, r.P.pelvis); const fwd = [Math.cos(r.vis), 0, -Math.sin(r.vis)];
  const lean = Math.atan2(dot(v, fwd), v[1]) * D, tot = Math.acos(v[1] / len(v)) * D;
  const hv = sub(r.tips.face, r.P.neck); return { lean, tot, headFwd: dot(hv, fwd), chinToChest: len(sub(r.tips.face, r.P.neck)) };
}
export function hookMetrics(name = 'hook', side = 'L') {
  const R = rec(name), c = CLIPS[name], w = R.filter((r) => r.t >= T0 - 0.05 && r.t <= T0 + c.duration + 0.02);
  const sh = 'shoulder' + side, el = 'elbow' + side, ha = 'hand' + side;
  const elbow = w.map((r) => ang(r.P[sh], r.P[el], r.P[ha]));
  const iImp = w.findIndex((r) => r.t >= T0 + c.impactT - 1e-9), iLoad = w.findIndex((r) => r.t >= T0 + (c.lock ? c.lock.tLoad : c.phases[0].t0) - 1e-9);
  const strike0 = w.findIndex((r) => r.t >= T0 + c.phases[1].t0 - 1e-9), strike1 = w.findIndex((r) => r.t >= T0 + c.phases[1].t1);
  const seg = elbow.slice(iLoad, iImp + 1);
  const fwdOf = (r) => [Math.cos(r.vis), 0, -Math.sin(r.vis)], rgtOf = (r) => [Math.sin(r.vis), 0, Math.cos(r.vis)];
  const reach = w.map((r) => { const m = mid(r.P.shoulderL, r.P.shoulderR); return Math.hypot(r.fist[0] - m[0], r.fist[2] - m[2]); });
  const reach3 = w.map((r) => len(sub(r.fist, mid(r.P.shoulderL, r.P.shoulderR))));
  const reachShoulder = w.map((r) => len(sub(r.fist, r.P[sh])));
  const lat = w.map((r) => { const m = mid(r.P.shoulderL, r.P.shoulderR), v = sub(r.fist, m); return dot(v, rgtOf(r)); }), fw = w.map((r) => { const m = mid(r.P.shoulderL, r.P.shoulderR), v = sub(r.fist, m); return dot(v, fwdOf(r)); });
  const hip = unwrap(w.map((r) => lineYaw(r.P, 'hipL', 'hipR'))), shy = unwrap(w.map((r) => lineYaw(r.P, 'shoulderL', 'shoulderR')));
  const sp = w.map((r, i) => i ? len(sub(r.fist, w[i - 1].fist)) * 240 : 0);
  const rng = (a) => Math.max(...a) - Math.min(...a);
  // ronda 4: con carga (wind-up) la señal primero va al revés; el cruce se mide entre el extremo de la carga y el extremo del golpe (después de la carga)
  const tHalf = (sig) => halfCross(sig, w.map((r) => r.t - T0), 0.5, iImp);
  const fk = sp.indexOf(Math.max(...sp));
  // pops a 60 Hz
  const R60 = rec(name, 60).filter((r) => r.t >= T0 - 0.05 && r.t <= T0 + c.duration + 0.02); const pops = {}; for (let i = 1; i < R60.length; i++) for (const k in R60[i].P) pops[k] = Math.max(pops[k] || 0, len(sub(R60[i].P[k], R60[i - 1].P[k])));
  return { elbowMin: Math.min(...elbow), elbowMax: Math.max(...elbow), elbowLoadToImpact: [Math.min(...seg), Math.max(...seg)], elbowImpact: elbow[iImp],
    reachMax: Math.max(...reach), reachImpact: reach[iImp], reach3Impact: reach3[iImp], reachShoulderImpact: reachShoulder[iImp], reachShoulderMax: Math.max(...reachShoulder), latImpact: lat[iImp], fwdImpact: fw[iImp],
    hipRot: rng(hip) * D, shRot: rng(shy) * D, tHip: tHalf(hip), tSh: tHalf(shy), tFistPeak: w[fk].t - T0, fistPeak: sp[fk], fistImpact: sp[iImp], popElbow: pops[el], popHand: pops[ha], popPelvis: pops.pelvis, popHead: pops.head, popMax: Math.max(...Object.values(pops)), strike: [w[strike0].t - T0, w[strike1].t - T0] };
}
export function guardMetrics() {
  const R = rec('guard', 60); const w = R.filter((r) => r.t > 1.0 && r.t < 3.5); const o = w.map(torsoAngle);
  const av = (k) => o.reduce((s, x) => s + x[k], 0) / o.length;
  return { lean: av('lean'), leanMin: Math.min(...o.map((x) => x.lean)), leanMax: Math.max(...o.map((x) => x.lean)), tot: av('tot'), headFwd: av('headFwd'), chin: av('chinToChest') };
}
export function rangeOf(name, t0, t1, hz = 240) { const R = rec(name, hz).filter((r) => r.t >= t0 && r.t <= t1); return R; }
export function popsOf(name, t0, t1, hz = 60) { const R = rec(name, hz).filter((r) => r.t >= t0 && r.t <= t1); const p = {}; for (let i = 1; i < R.length; i++) for (const k in R[i].P) p[k] = Math.max(p[k] || 0, len(sub(R[i].P[k], R[i - 1].P[k]))); return p; }

const which = process.argv[2] || 'all';
const fm = (o) => JSON.stringify(o, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (which === 'all' || which === 'hook') { const m = hookMetrics('hook'); console.log('HOOK', JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Array.isArray(v) ? v.map(f2) : f2(v)])), null, 1)); }
  if (which === 'all' || which === 'guard') console.log('GUARD', JSON.stringify(guardMetrics()));
}

// ---- reacciones / KO / climb (ronda 3)
export function hurtMetrics(label, t0) {
  const R = rec('hurt', 240), base = rec('guard', 240);
  const w = R.filter((r) => r.t >= t0 - 0.05 && r.t <= t0 + 0.7);
  const idle = (r) => base[Math.min(base.length - 1, Math.round(r.t * 240))];
  const kneeAng = (r, s) => ang(r.P['hip' + s], r.P['knee' + s], r.P['foot' + s]);
  const fwd = (r) => [Math.cos(r.vis), 0, -Math.sin(r.vis)];
  const headBack = Math.max(...w.map((r) => { const b = idle(r); return dot(sub(b.tips.face, r.tips.face), fwd(r)); }));
  const headPitch = Math.max(...w.map((r) => { const v = sub(r.tips.headTop, r.P.head), f = fwd(r); return -Math.atan2(dot(v, f), v[1]) * D; }));
  const pelvisDrop = Math.max(...w.map((r) => idle(r).P.pelvis[1] - r.P.pelvis[1]));
  const kL = Math.min(...w.map((r) => kneeAng(r, 'L'))), kR = Math.min(...w.map((r) => kneeAng(r, 'R'))), k0L = kneeAng(w[0], 'L'), k0R = kneeAng(w[0], 'R');
  const pel = (r) => sub(r.P.pelvis, [r.root[0], 0, r.root[2]]);
  const side = Math.max(...w.map((r) => Math.abs(dot(sub(r.P.pelvis, idle(r).P.pelvis), [Math.sin(r.vis), 0, Math.cos(r.vis)]))));
  const fw2 = (r) => [Math.cos(r.vis), 0, -Math.sin(r.vis)];
  const pitchOf = (v, r) => Math.atan2(dot(v, fw2(r)), v[1]) * D;   // + = hacia adelante
  const headRel = w.map((r) => pitchOf(sub(r.tips.headTop, r.P.head), r) - pitchOf(sub(r.P.neck, r.P.pelvis), r));
  const headRel0 = headRel[0];
  const p = popsOf('hurt', t0 - 0.05, t0 + 0.7);
  return { headRelChestRange: [Math.min(...headRel) - headRel0, Math.max(...headRel) - headRel0], headBack, headPitchMax: headPitch, pelvisDrop, kneeL: [k0L, kL], kneeR: [k0R, kR], pelvisSide: side, popMax: Math.max(...Object.values(p)), popHead: p.head, popKneeL: p.kneeL, popPelvis: p.pelvis };
}
export function koMetrics() {
  const R = rec('ko', 240).filter((r) => r.t >= 1.0 && r.t <= 3.0);
  const ky = R.map((r) => r.P.kneeR[1]), kl = R.map((r) => r.P.kneeL[1]);
  const base = rec('guard', 240)[240 * 1];
  const f = R.findIndex((r) => r.P.kneeR[1] === Math.max(...ky));
  const p = popsOf('ko', 1.0, 3.0);
  const relY = R.map((r) => r.P.kneeR[1] - r.P.hipR[1]);
  return { kneeRMax: Math.max(...ky), kneeRMaxT: R[f].t - 1.0, kneeRFinal: ky.at(-1), kneeLMax: Math.max(...kl), kneeRrelHipMax: Math.max(...relY), kneeRFinalRelHip: relY.at(-1), popMax: Math.max(...Object.values(p)), popKneeR: p.kneeR };
}
export function climbMetrics() {
  const p = popsOf('climb1m', 3.62, 3.6 + 1.95, 60);
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +(v * 100).toFixed(2)]));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const fm = (o) => JSON.stringify(o, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v);
  if (which === 'all' || which === 'hurt') { console.log('HURT_HEAD', fm(hurtMetrics('head', 1.0))); console.log('HURT_LEGS', fm(hurtMetrics('legs', 4.0))); console.log('HURT_BODY', fm(hurtMetrics('body', 2.5))); }
  if (which === 'all' || which === 'ko') console.log('KO', fm(koMetrics()));
  if (which === 'all' || which === 'climb') console.log('CLIMB pops cm/frame', fm(climbMetrics()));
}

// Alcance contra la tabla de Combate (src/combat/data/reach3d.js): punta del puño/espinilla en impactT respecto de la PELVIS (horizontal y 3D)
// ronda 5 (Rick): jab y cross a 1,0±0,05 pelvis-pelvis (Combate los lanza ~0,95 m y separa >= 0,80 m fuera del clinch)
export const REACH_IDEAL = { jab: [1.00, 0.05], cross: [1.00, 0.05], hook: [0.86, 0.06], lowkick: [1.00, 0.07] };
export function pelvisReach(name) {
  const c = CLIPS[name], R = rec(name, 240); const r = R.find((x) => x.t >= T0 + c.impactT - 1e-9);
  const v = sub(r.fist, r.P.pelvis); const h = Math.hypot(v[0], v[2]); const fw = [Math.cos(r.vis), 0, -Math.sin(r.vis)];
  const [ideal, tol] = REACH_IDEAL[name];
  return { horiz: h, alongFacing: dot(v, fw), d3: len(v), ideal, tol, ok: Math.abs(h - ideal) <= tol, height: r.fist[1] - r.P.pelvis[1] };
}
if (import.meta.url === `file://${process.argv[1]}` && (which === 'all' || which === 'reach')) for (const n of Object.keys(REACH_IDEAL)) console.log('REACH', n, JSON.stringify(pelvisReach(n), (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));

// ---- ronda 4: gancho abierto (húmero), alcance desde la raíz (= pelvis de la sim), velocidades y frames por fase
const fwdV = (r) => [Math.cos(r.vis), 0, -Math.sin(r.vis)], lftV = (r) => [-Math.sin(r.vis), 0, -Math.cos(r.vis)];   // izquierda del peleador (mundo)
export function hookArmMetrics(name = 'hook') {
  const c = CLIPS[name], R = rec(name, 240); const r = R.find((x) => x.cn === name && x.ct >= c.impactT - 1e-9), P = r.P;
  const hum = sub(P.elbowL, P.shoulderL), fore = sub(P.handL, P.elbowL), down = sub(P.pelvis, P.neck);
  const angV = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / len(a) / len(b)))) * D;
  const f = fwdV(r), l = lftV(r);
  const head = [r.root[0] + 0.70 * f[0], 1.50, r.root[2] + 0.70 * f[2]];   // cabeza de un rival a 0,70 m (pelvis-pelvis), altura de guardia
  const toHead = sub(head, P.shoulderL);
  return {
    abduction: angV(hum, down), humerusElev: Math.asin(hum[1] / len(hum)) * D, humerusVsFacing: angV(hum, f), humerusVsRivalHead: angV(hum, toHead),
    elbow: ang(P.shoulderL, P.elbowL, P.handL), forearmElev: Math.asin(fore[1] / len(fore)) * D,
    elbowBesideFist: dot(sub(P.elbowL, r.fist), l), elbowBehindFist: dot(sub(r.fist, P.elbowL), f),
    fistLateralFromRootLine: dot(sub(r.fist, r.root), l), fistHeight: r.fist[1], elbowMinusShoulderY: P.elbowL[1] - P.shoulderL[1],
  };
}
export function rootReach(name) {
  const c = CLIPS[name], R = rec(name, 240); const r = R.find((x) => x.cn === name && x.ct >= c.impactT - 1e-9);
  const v = sub(r.fist, r.root), w = sub(r.fist, r.P.pelvis); const [ideal, tol] = REACH_IDEAL[name];
  const h = Math.hypot(v[0], v[2]);
  return { rootHoriz: h, pelvisHoriz: Math.hypot(w[0], w[2]), pelvisFwd: dot(sub(r.P.pelvis, r.root), fwdV(r)), ideal, tol, ok: Math.abs(h - ideal) <= tol, tipHeight: r.fist[1] };
}
// velocidad de la punta (puño / espinilla) a 60 Hz (lo que se ve) y 240 Hz; pico en la ventana del golpe y en el frame del impacto
export function strikeSpeed(name) {
  const c = CLIPS[name], out = {};
  for (const hz of [60, 240]) {
    const R = rec(name, hz).filter((r) => r.t >= T0 - 1e-9 && r.t <= T0 + c.duration + 1e-9);
    const sp = R.map((r, i) => i ? len(sub(r.fist, R[i - 1].fist)) * hz : 0);
    const iImp = R.findIndex((r) => r.cn === name && r.ct >= c.impactT - 1e-9);   // primer frame cuyo tiempo de CLIP llegó al impacto
    let k = 0; for (let i = 0; i <= iImp; i++) if (sp[i] > sp[k]) k = i;
    out['peak' + hz] = sp[k]; out['peakClipT' + hz] = R[k].ct; out['atImpact' + hz] = sp[iImp];
  }
  const ph = c.phases.map((p) => `${p.name} ${Math.round(p.t0 * 60)}–${Math.round(p.t1 * 60)}`);
  return { ...out, impactT: c.impactT, impactFrame: +(c.impactT * 60).toFixed(2), duration: c.duration, frames: +(c.duration * 60).toFixed(2), phases: ph.join(' | ') };
}
if (import.meta.url === `file://${process.argv[1]}`) {

  if (which === 'all' || which === 'r4' || which === 'hookarm') console.log('HOOK_ARM', fm(hookArmMetrics()));
  if (which === 'all' || which === 'r4' || which === 'reach') for (const n of Object.keys(REACH_IDEAL)) console.log('ROOT_REACH', n, fm(rootReach(n)));
  if (which === 'all' || which === 'r4' || which === 'speed') for (const n of Object.keys(REACH_IDEAL)) console.log('SPEED', n, fm(strikeSpeed(n)));
}

// ---- ronda 4 (steering 2): retroceso por fuerza y juego de pies
// desplazamiento horizontal máximo (m) de cara, pecho (cuello) y pelvis respecto de la guardia quieta en los 0.6 s siguientes a cada golpe de HURT_FORCE
export function forceMetrics() {
  const R = rec('hurtForce', 60), base = rec('guard', 60)[120];
  const hz = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  return HURT_FORCE.map((h) => {
    const w = R.filter((r) => r.t >= h.t && r.t <= h.t + 0.6);
    const mx = (f) => Math.max(...w.map(f));
    let pop = 0; for (let i = 1; i < w.length; i++) for (const k in w[i].P) pop = Math.max(pop, len(sub(w[i].P[k], w[i - 1].P[k])));
    return { zone: h.zone, dmg: h.dmg, power: h.dmg / 16, face: mx((r) => hz(r.tips.face, base.tips.face)), chest: mx((r) => hz(r.P.neck, base.P.neck)), pelvis: mx((r) => hz(r.P.pelvis, base.P.pelvis)), pelvisDrop: mx((r) => base.P.pelvis[1] - r.P.pelvis[1]), popMax: pop };
  });
}
// por tramo de FOOTWORK: react = s hasta que despega el primer pie, footLag = s desde que la raíz se detiene hasta que el último pie queda plantado
// (ventana hasta el tramo siguiente), liftBouts = despegues en el tramo, y pops máximos (m/frame a 60 Hz) de pies/pelvis en toda la secuencia
export function locoMetrics() {
  const F = []; simulate('footwork', { hz: 60, onFrame: (t, sk, A) => F.push({ t, pel: sk.pose.pelvis.slice(), fl: sk.pose.footL.slice(), fr: sk.pose.footR.slice(), pl: A.feet.every((f) => f.planted) }) });
  const out = { segs: [] };
  FOOTWORK_SEGS.forEach(([t0, d], si) => {
    const te = t0 + d, tn = si + 1 < FOOTWORK_SEGS.length ? FOOTWORK_SEGS[si + 1][0] : te + 1.2;
    const w = F.filter((r) => r.t >= te && r.t < tn), last = w[w.length - 1];
    const seg = F.filter((r) => r.t >= t0 && r.t < tn);
    let steps = 0; for (let i = 1; i < seg.length; i++) if (!seg[i].pl && seg[i - 1].pl) steps++;
    const first = seg.find((r) => !r.pl);
    const fl = w.find((r) => r.pl && w.filter((q) => q.t >= r.t).every((q) => q.pl));
    out.segs.push({ t0, react: first ? first.t - t0 : null, footLag: fl ? fl.t - te : tn - te, liftBouts: steps });
  });
  let pf = 0, pp = 0; for (let i = 1; i < F.length; i++) { pf = Math.max(pf, len(sub(F[i].fl, F[i - 1].fl)), len(sub(F[i].fr, F[i - 1].fr))); pp = Math.max(pp, len(sub(F[i].pel, F[i - 1].pel))); }
  out.popFoot = pf; out.popPelvis = pp; out.footLagMean = out.segs.reduce((a, s) => a + s.footLag, 0) / out.segs.length;
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (which === 'all' || which === 'r4' || which === 'force') for (const m of forceMetrics()) console.log('FORCE', fm(m));
  if (which === 'all' || which === 'r4' || which === 'loco') console.log('LOCO', JSON.stringify(locoMetrics(), (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
}

// finta de gancho vs gancho/jab: cuánto carga cadera y hombros (giro de la línea de caderas/hombros, °), cuánto sube/abre el codo L y cuánto
// viaja el puño L hacia ADELANTE (un jab lo manda ~0.4 m al frente; la finta no debe), + pops del cambio hook -> feint_hook en vivo
export function feintMetrics(name = 'feint_hook', t0 = 1.5, t1 = 2.1) {
  const R = rec(name, 60).filter((r) => r.t >= t0 - 1e-6 && r.t <= t1), b = R[0];
  const lineYaw = (a, c) => Math.atan2(a[0] - c[0], a[2] - c[2]) * D;
  const hips = (r) => lineYaw(r.P.hipL, r.P.hipR), sh = (r) => lineYaw(r.P.shoulderL, r.P.shoulderR);
  const wrap = (x) => ((x + 540) % 360) - 180;
  const fwd = [1, 0, 0], side = [0, 0, -1];
  let pop = 0; for (let i = 1; i < R.length; i++) for (const k in R[i].P) pop = Math.max(pop, len(sub(R[i].P[k], R[i - 1].P[k])));
  const fistFwd = R.map((r) => dot(sub(r.tips.fistL ?? r.P.handL, b.tips.fistL ?? b.P.handL), fwd));
  return {
    hipLoadDeg: Math.max(...R.map((r) => Math.abs(wrap(hips(r) - hips(b))))), shoulderLoadDeg: Math.max(...R.map((r) => Math.abs(wrap(sh(r) - sh(b))))),
    elbowRise: Math.max(...R.map((r) => r.P.elbowL[1] - b.P.elbowL[1])), elbowOut: Math.max(...R.map((r) => dot(sub(r.P.elbowL, b.P.elbowL), side) * -1)),
    fistFwdMax: Math.max(...fistFwd), backToGuard: R.find((r, i) => i > 6 && R.slice(i).every((q) => len(sub(q.P.handL, b.P.handL)) < 0.04))?.t - t0, popMax: pop,
  };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (which === 'all' || which === 'r4' || which === 'feint') { console.log('FEINT feint_hook', fm(feintMetrics())); console.log('FEINT switch(hook->feint)', fm(feintMetrics('feintSwitch'))); console.log('FEINT ref hook', fm(feintMetrics('hook', 1.5, 2.1))); console.log('FEINT ref jab', fm(feintMetrics('jab', 1.5, 2.1))); }
}

// ---- ronda 5: KO sin "arrodillado erguido". Inclinación del torso (pelvis→cuello vs vertical, °) desde que la pelvis baja de 0,55 m
// (rodillas en el suelo) hasta el final; componentes atrás/costado (m del cuello respecto de la pelvis, marco de la mirada) en ese instante.
export function koTiltMetrics() {
  const R = rec('ko', 60).filter((r) => r.t >= 1.0 && r.t <= 3.0);
  const tilt = (r) => { const v = sub(r.P.neck, r.P.pelvis); return Math.acos(v[1] / len(v)) * D; };
  const i0 = R.findIndex((r) => r.P.pelvis[1] < 0.55);
  const w = R.slice(i0), tl = w.map(tilt), k = tl.indexOf(Math.min(...tl));
  const f = fwdV(R[0]), l = lftV(R[0]), v0 = sub(w[0].P.neck, w[0].P.pelvis);
  let minY = 9, minJ = ''; for (const r of R) for (const j in r.P) if (r.P[j][1] < minY) { minY = r.P[j][1]; minJ = j; }
  return { kneelT: R[i0].t - 1.0, tiltAtKneel: tl[0], tiltMinAfterKneel: tl[k], tiltMinT: w[k].t - 1.0, backAtKneel: -dot(v0, f), sideAtKneel: dot(v0, l), tiltMaxStanding: Math.max(...R.slice(0, i0).map(tilt)), minJointY: minY, minJoint: minJ };
}
if (import.meta.url === `file://${process.argv[1]}` && (which === 'all' || which === 'r5' || which === 'ko')) console.log('KO_TILT', fm(koTiltMetrics()));

// ---- ronda 6: duelo (contacto). Profundidad "a través" = distancia de la punta al primer contacto en el rayo hombro/cadera->punta.
const I3 = (w) => [-w[2], w[1], w[0]];
function duelRec(name, o) {
  const R = [];
  simulateDuel(name, { ...o, onFrame: (t, sa, sb, a, b) => {
    const cols = buildColliders(sb), kick = CLIPS[name].tip === 'kickR', s = kick ? 'R' : CLIPS[name].tip;
    const O = I3(kick ? sa.pose.hipR : sa.pose['shoulder' + s]), T = I3(a.strike.fist), rt = kick ? CONTACT.shinTip : CONTACT.fist;
    const M = I3(kick ? sa.pose.kneeR : sa.pose['elbow' + s]);
    let tun = Math.max(segPenetration(cols, O, M, rt), segPenetration(cols, M, T, rt));
    if (kick) { const An = I3(sa.pose.footR), To = I3(sa.tips.toeR); tun = Math.max(tun, segPenetration(cols, T, An, rt), segPenetration(cols, An, To, 0.035)); }   // r7: tobillo y empeine tampoco entran   // por segmentos: hombro->codo->nudillos / cadera->rodilla->espinilla
    R.push({ t, ct: a.clip ? a.clipT : -1, cn: a.clip ? a.clipMode.name : '', seg: tun, pen: Math.max(0, penetration(cols, T, rt).pen),
      P: Object.fromEntries(Object.entries(sa.pose).map(([k, v]) => [k, v.slice()])), PB: Object.fromEntries(Object.entries(sb.pose).map(([k, v]) => [k, v.slice()])),
      fist: a.strike.fist.slice(), root: sa.root.pos.slice(), rootB: sb.root.pos.slice(), vis: sa.visualYaw, ev: a.events.filter((e) => e.type === 'contact').map((e) => ({ ...e })), ek: a.clipMode.entryK ?? 0, corr: Math.hypot(...a.contact.d) });
  } });
  return R;
}
const maxJump = (R, key, skip = []) => { let m = 0, who = ''; for (let i = 1; i < R.length; i++) for (const k in R[i][key]) { if (skip.includes(k)) continue; const d = len(sub(R[i][key][k], R[i - 1][key][k])); if (d > m) { m = d; who = k; } } return { m, who }; };
export function duelMetrics(name, o = {}) {
  const c = CLIPS[name], dist = o.dist ?? DUEL_DIST[name];
  const B = duelRec(name, { ...o, dist, link: false }), L = duelRec(name, { ...o, dist, link: true });
  const win = (R) => R.filter((r) => r.cn === name);
  const iImp = (R) => R.findIndex((r) => r.cn === name && r.ct >= c.impactT - 1e-9);
  const kk = c.tip === 'kickR', ib = iImp(B), il = iImp(L), s = kk ? 'R' : c.tip;
  let corrJump = 0, corrWho = '';
  for (let i = 1; i < L.length; i++) for (const k in L[i].P) { const d = len(sub(sub(L[i].P[k], B[i].P[k]), sub(L[i - 1].P[k], B[i - 1].P[k]))); if (d > corrJump) { corrJump = d; corrWho = k; } }
  const strikeJ = kk ? ['kneeR', 'footR'] : ['hand' + s, 'elbow' + s];
  const ev = L.flatMap((r) => r.ev)[0] || null, iev = ev ? L.findIndex((r) => r.ev.length) : -1;
  const hz = 60, sp = (R, i) => len(sub(R[i].fist, R[i - 1].fist)) * hz;
  const rr = (r) => Math.hypot(r.rootB[0] - r.root[0], r.rootB[2] - r.root[2]);
  const pp = (r) => Math.hypot(r.PB.pelvis[0] - r.P.pelvis[0], r.PB.pelvis[2] - r.P.pelvis[2]);
  const out = {
    dist, before: { segImpact: B[ib].seg, segMax: Math.max(...win(B).map((r) => r.seg)), penImpact: B[ib].pen },
    after: { segImpact: L[il].seg, segMax: Math.max(...win(L).map((r) => r.seg)), penImpact: L[il].pen, penMax: Math.max(...win(L).map((r) => r.pen)), corrImpact: L[il].corr, corrMax: Math.max(...win(L).map((r) => r.corr)) },
    contact: ev ? { zone: ev.zone, clipT: ev.clipT, early: ev.early, rootDist: rr(L[iev]), pelvisDist: pp(L[iev]) } : null,
    rootDistImpact: rr(L[il]), pelvisDistImpact: pp(L[il]), entryK: L[il].ek,
    corrJump, corrWho, jumpOther: maxJump(L, 'P', strikeJ).m, jumpOtherWho: maxJump(L, 'P', strikeJ).who, jumpOtherBefore: maxJump(B, 'P', strikeJ).m, jumpStrikeSideBefore: Math.max(...strikeJ.map((k) => { let m = 0; for (let i = 1; i < B.length; i++) m = Math.max(m, len(sub(B[i].P[k], B[i - 1].P[k]))); return m; })), jumpStrikeSide: Math.max(...strikeJ.map((k) => { let m = 0; for (let i = 1; i < L.length; i++) m = Math.max(m, len(sub(L[i].P[k], L[i - 1].P[k]))); return m; })),
    jumpDefender: maxJump(L, 'PB').m, jumpDefenderWho: maxJump(L, 'PB').who,
    speedImpact60: sp(L, il), speedImpact60Before: sp(B, ib),
    reachRoot: Math.hypot(B[ib].fist[0] - B[ib].root[0], B[ib].fist[2] - B[ib].root[2]),
  };
  if (name === 'hook') {
    const P = L[il].P, r = L[il], hum = sub(P.elbowL, P.shoulderL), down = sub(P.pelvis, P.neck), f = fwdV(r);
    const angV = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / len(a) / len(b)))) * D;
    out.L = { abduction: angV(hum, down), humerusVsFacing: angV(hum, f), elbow: ang(P.shoulderL, P.elbowL, P.handL), elbowMinusShoulderY: P.elbowL[1] - P.shoulderL[1] };
    out.reachRootLinked = Math.hypot(r.fist[0] - r.root[0], r.fist[2] - r.root[2]);
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}` && (which === 'all' || which === 'r6' || which === 'duel')) {
  for (const n of ['jab', 'cross', 'hook', 'lowkick']) console.log('DUEL', n, fm(duelMetrics(n)));
  console.log('DUEL hook closeTo0.70', fm(duelMetrics('hook', { closeTo: 0.70 })));
  console.log('DUEL hook power1', fm(duelMetrics('hook', { power: 1 })));
}

// ---- ronda 7: suelo (ground and pound). Métricas de un golpe de suelo con el rival tendido (simulateGround).
//  gapImpact: distancia superficie-punta al blanco (cabeza/torso) en el frame del impacto (<0 = penetra)
//  penMax / segMax: penetración máx. de la punta / del segmento distal en todo el golpe contra los colisores de CUERPO (0..7) del de abajo
//  vPeakT: instante del pico de velocidad de la punta (sin los 2 primeros frames); headFloorMin: min(y_centro_cabeza - r) del de abajo
//  bounce: cuánto baja la cabeza respecto del reposo durante hurt_ground y cuánto vuelve a subir (rebote)
export function groundMetrics(pos = 'mount', strike = 'gnp_punch', o = {}) {
  const cl = CLIPS[strike], I = (w) => [-w[2], w[1], w[0]], elb = cl.tip === 'elbowR', rt = elb ? CONTACT.elbow : CONTACT.fist;
  const zoneCol = (GROUND_ZONE[strike] || 'head') === 'head' ? 0 : 1;
  const m = { pos, strike, gapImpact: null, penMax: 0, segMax: 0, vPeak: 0, vPeakT: 0, vImpact: 0, headFloorMin: Infinity, headRest: null, headLow: Infinity, headAfter: -Infinity, contact: null, tipJump: 0 };
  let pf = null, t0 = null;
  simulateGround(pos, strike, { ...o, onFrame: (t, sa, sb, a, b) => {
    const hc = sb.pose.head[1] + (sb.tips.headTop[1] - sb.pose.head[1]) * CONTACT.headC - CONTACT.head;
    m.headFloorMin = Math.min(m.headFloorMin, hc);
    if (b.clip && b.clipMode.name === 'hurt_ground') { m.headLow = Math.min(m.headLow, hc); if (b.clipT > 0.12) m.headAfter = Math.max(m.headAfter, hc); }
    else if (!b.clip && t > 0.9 && m.headLow === Infinity) m.headRest = hc;
    if (!(a.clip && a.clipMode.name === strike)) { pf = null; return; }
    const cols = buildColliders(sb).slice(0, 8), f = I(a.strike.fist), T = a.clipT;
    const P = I(elb ? sa.pose.shoulderR : sa.pose['elbow' + (cl.tip === 'L' ? 'L' : 'R')]);
    m.penMax = Math.max(m.penMax, penetration(cols, f, rt).pen); m.segMax = Math.max(m.segMax, segPenetration(cols, P, f, rt));
    if (pf && T > 2 / 60 + 1e-9) { const v = Math.hypot(f[0] - pf[0], f[1] - pf[1], f[2] - pf[2]) * 60; if (v > m.vPeak) { m.vPeak = v; m.vPeakT = T; } if (Math.abs(T - cl.impactT) < 1 / 120) m.vImpact = v; m.tipJump = Math.max(m.tipJump, v / 60); }
    if (Math.abs(T - cl.impactT) < 1 / 120) { const c = cols[zoneCol]; m.gapImpact = sdist(c, f) - rt; }
    if (m.tImp == null && T >= cl.impactT - 1e-9) { m.tImp = t; m.fImp = f; }   // r8: hit-stop: cuánto se mueve la punta en HITSTOP (tiempo de pared)
    if (m.tImp != null && t <= m.tImp + HITSTOP + 1e-9) m.hitStopMove = Math.max(m.hitStopMove || 0, Math.hypot(f[0] - m.fImp[0], f[1] - m.fImp[1], f[2] - m.fImp[2]));
    if (!m.contact && a.contact.last && a.contact.last.name === strike) m.contact = { ...a.contact.last };
    pf = f;
  } });
  m.bounce = m.headRest == null ? null : { down: m.headRest - m.headLow, up: m.headAfter - m.headLow };
  return m;
}

// ---- ronda 7: patadas media/alta en duelo enlazado. thighMax: penetración del muslo (cadera->rodilla, r 0,06) en el cuerpo del rival;
//  vPeakT vs impactT (pico de velocidad de la espinilla), hitStopMove: cuánto se mueve la punta durante el hit-stop, kneeChamber/kneeImpact (°),
//  pivot: giro del pie de apoyo (rad), penImpact/segImpact/segMax como duelMetrics (cuerpo del rival 0..7).
export function kickMetrics(name, o = {}) {
  const c = CLIPS[name], I3 = (w) => [-w[2], w[1], w[0]];
  const m = { name, thighMax: 0, vPeak: 0, vPeakT: 0, vImpact: 0, hitStopMove: 0, kneeChamber: 180, kneeImpact: 0, pivot: 0, penImpact: 0, segImpact: 0, segMax: 0, contact: null, defClips: new Set() };
  let pf = null, yaw0 = null, pin0 = null;
  simulateDuel(name, { ...o, onFrame: (t, sa, sb, a, b) => {
    if (b.clip) m.defClips.add(b.clipMode.name);
    if (!(a.clip && a.clipMode.name === name)) { pf = null; return; }
    const cols = buildColliders(sb).slice(0, 8), T = a.clipT, P = sa.pose, f = I3(a.strike.fist);
    m.thighMax = Math.max(m.thighMax, segPenetration(cols, I3(P.hipR), I3(P.kneeR), 0.06));
    const seg = Math.max(segPenetration(cols, I3(P.kneeR), f, CONTACT.shinTip), segPenetration(cols, f, I3(P.footR), CONTACT.shinTip));
    m.segMax = Math.max(m.segMax, seg);
    const kn = ang(P.hipR, P.kneeR, P.footR);
    if (T < c.impactT - 0.03) m.kneeChamber = Math.min(m.kneeChamber, kn);
    const fy = a.feetWorld()[0].yaw; if (yaw0 == null) yaw0 = fy; m.pivot = Math.max(m.pivot, Math.abs(fy - yaw0));
    if (pf && T > 2 / 60) { const v = len(sub(f, pf)) * 60; if (v > m.vPeak) { m.vPeak = v; m.vPeakT = T; } }
    if (Math.abs(T - c.impactT) < 1 / 120) { m.kneeImpact = kn; m.penImpact = Math.max(0, penetration(cols, f, CONTACT.shinTip).pen); m.segImpact = seg; m.vImpact = pf ? len(sub(f, pf)) * 60 : 0; pin0 = f; }
    if (pin0 && T > c.impactT && T <= c.impactT + HITSTOP + 1e-9) m.hitStopMove = Math.max(m.hitStopMove, len(sub(f, pin0)));
    if (!m.contact && a.contact.last && a.contact.last.name === name) m.contact = { ...a.contact.last };
    pf = f;
  } });
  m.defClips = [...m.defClips];
  return m;
}
// bloqueo en duelo: distancia superficie-punta al miembro de guardia elegido (blkGap) mínima en la ventana impacto..+hit-stop+1 frame,
// clips del defensor (sin hurt_*), y si el golpe NO bloqueado atraviesa los guantes/antebrazos (guardSeg).
// r8: distancia superficie-superficie entre dos cápsulas (muestreo 25x25)
export function capGap(A, B) {
  let best = Infinity;
  for (let i = 0; i <= 24; i++) { const u = i / 24, p = [0, 1, 2].map((k) => A.a[k] + (A.b[k] - A.a[k]) * u);
    for (let j = 0; j <= 24; j++) { const v = j / 24, q = [0, 1, 2].map((k) => B.a[k] + (B.b[k] - B.a[k]) * v); const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - A.r - B.r; if (d < best) best = d; } }
  return best;
}
export function blockMetrics(name, block = null, o = {}) {
  const c = CLIPS[name], I3 = (w) => [-w[2], w[1], w[0]], kick = c.tip === 'kickR', rt = kick ? CONTACT.shinTip : CONTACT.fist;
  const m = { name, block, blk: -1, blkGapMin: Infinity, guardSeg: 0, bodyPenMax: 0, defClips: new Set(), events: [] };
  simulateDuel(name, { ...o, block: block ? { ...block } : null, onFrame: (t, sa, sb, a, b) => {
    if (b.clip) m.defClips.add(b.clipMode.name);
    for (const e of a.events) if (e.type === 'blocked' || e.type === 'contact') m.events.push(e.type + (e.blocked ? ':blocked' : '') + (e.limb ? ':' + e.limb + e.side : ''));
    if (a.caught && a.contact.blk && m.blk < 0) m.blk = a.contact.blk.i;   // r8: atrapada: el clip de la patada se corta (lo sostiene catchLayer); queda el guante que atrapa
    if (!(a.clip && a.clipMode.name === name)) return;
    const cols = buildColliders(sb), f = I3(a.strike.fist), T = a.clipT, P = sa.pose;
    const blk = a.contact.blk && a.contact.blk.clip === a.clip ? a.contact.blk.i : -1; if (blk >= 0) m.blk = blk;
    m.bodyPenMax = Math.max(m.bodyPenMax, penetration(cols.slice(0, 8), f, rt).pen);
    const O = I3(kick ? P.kneeR : P['elbow' + c.tip]), G = cols.slice(8); m.guardSeg = Math.max(m.guardSeg, segPenetration(G, O, f, rt));
    if (kick) m.guardSeg = Math.max(m.guardSeg, segPenetration(G, f, I3(P.footR), rt), segPenetration(G, I3(P.hipR), I3(P.kneeR), 0.06));   // toda la pierna: muslo, espinilla y empeine
    if (m.tI == null && T >= c.impactT - 1e-9) m.tI = t;   // r8: ventana en tiempo de pared (la patada bloqueada rebota: el clip va hacia atrás)
    if (blk >= 0 && m.tI != null && t <= m.tI + HITSTOP + 1 / 60 + 1e-9) {
      // r8: chequeo = espinilla contra espinilla: distancia superficie-superficie entre la espinilla R del que patea y la que chequea (no la punta)
      const g = cols[blk].limb === 'shin' ? capGap(buildColliders(sa)[5], cols[blk]) : sdist(cols[blk], f) - rt;
      m.blkGapMin = Math.min(m.blkGapMin, g); m.blkGapLo = Math.min(m.blkGapLo ?? Infinity, g);
    }
  } });
  m.defClips = [...m.defClips];
  return m;
}
