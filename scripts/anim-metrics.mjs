// Métricas de animación (ronda 3): hook, guardia, reacciones, KO, climb. Uso: node scripts/anim-metrics.mjs [hook|guard|hurt|ko|climb|all]
import { simulate } from '../src/anim/scenarios.js';
import { CLIPS } from '../src/anim/clips.js';

const D = 180 / Math.PI;
const sub = (a, b) => a.map((v, i) => v - b[i]); const len = (a) => Math.hypot(...a); const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const ang = (a, b, c) => Math.acos(Math.max(-1, Math.min(1, dot(sub(a, b), sub(c, b)) / len(sub(a, b)) / len(sub(c, b))))) * D;
const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
const unwrap = (a) => { for (let i = 1; i < a.length; i++) { while (a[i] - a[i - 1] > Math.PI) a[i] -= 2 * Math.PI; while (a[i] - a[i - 1] < -Math.PI) a[i] += 2 * Math.PI; } return a; };
const lineYaw = (P, a, b) => Math.atan2(P[b][2] - P[a][2], P[b][0] - P[a][0]);
export function rec(name, hz = 240, extra = {}) {
  const R = []; simulate(name, { hz, ...extra, onFrame: (t, sk, A) => R.push({ t, P: Object.fromEntries(Object.entries(sk.pose).map(([k, v]) => [k, v.slice()])), tips: Object.fromEntries(Object.entries(sk.tips).map(([k, v]) => [k, v.slice()])), fist: A.strike.fist.slice(), vis: sk.visualYaw, root: sk.root.pos.slice() }) });
  return R;
}
export const T0 = 1.5;
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
  const tHalf = (sig) => { const a0 = sig[0]; let m = 0; for (const v of sig) if (Math.abs(v - a0) > Math.abs(m)) m = v - a0; const i = sig.findIndex((v) => Math.abs(v - a0) >= 0.5 * Math.abs(m)); return w[i].t - T0; };
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
export const REACH_IDEAL = { jab: [1.10, 0.07], cross: [1.05, 0.07], hook: [0.70, 0.08], lowkick: [1.00, 0.07] };
export function pelvisReach(name) {
  const c = CLIPS[name], R = rec(name, 240); const r = R.find((x) => x.t >= T0 + c.impactT - 1e-9);
  const v = sub(r.fist, r.P.pelvis); const h = Math.hypot(v[0], v[2]); const fw = [Math.cos(r.vis), 0, -Math.sin(r.vis)];
  const [ideal, tol] = REACH_IDEAL[name];
  return { horiz: h, alongFacing: dot(v, fw), d3: len(v), ideal, tol, ok: Math.abs(h - ideal) <= tol, height: r.fist[1] - r.P.pelvis[1] };
}
if (import.meta.url === `file://${process.argv[1]}` && (which === 'all' || which === 'reach')) for (const n of Object.keys(REACH_IDEAL)) console.log('REACH', n, JSON.stringify(pelvisReach(n), (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
