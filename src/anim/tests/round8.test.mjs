// Ronda 8: mount a horcajadas (rodillas al piso con IK), codo de gnp en mount/side/guard, patada media sin atravesar la guardia,
// patada atrapada con pose propia, chequeo espinilla contra espinilla y penetración de todo el clip en peleas reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockMetrics, groundMetrics } from '../../../scripts/anim-metrics.mjs';
import { liveClipPen } from '../../../scripts/anim-live-contact.mjs';
import { CLIPS, HITSTOP } from '../clips.js';
import { COL, routeCatchEvent, bindCombatEvents } from '../index.js';
import { simulateDuel, simulateGround } from '../scenarios.js';
import { buildColliders, segPenetration, penetration, CONTACT } from '../contact.js';

const I3 = (w) => [-w[2], w[1], w[0]];
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const KNEE_FLOOR = 0.055 + 0.004;   // radio de la espinilla + piel

function groundPose(pos, strike = 'gnp_punch', at = 0.75, opts = {}) {
  let out = null;
  simulateGround(pos, strike, { ...opts, onFrame: (t, sa, sb, a) => {
    if (out || Math.abs(t - at) > 1 / 120) return;
    const P = sa.pose, cb = buildColliders(sb).slice(0, 8);
    const kneePen = ['L', 'R'].map((s) => penetration(cb, I3(P['knee' + s]), 0.06).pen);
    const legPen = Math.max(...['L', 'R'].flatMap((s) => [segPenetration(cb, I3(P['hip' + s]), I3(P['knee' + s]), CONTACT.thigh), segPenetration(cb, I3(P['knee' + s]), I3(P['foot' + s]), CONTACT.shin)]));
    const pel = P.pelvis, nk = P.neck || P.head;
    const lean = Math.atan2(Math.hypot(nk[0] - pel[0], nk[2] - pel[2]), nk[1] - pel[1]) * 180 / Math.PI;
    const bt = cb[1], mid = bt.a.map((v, k) => (v + bt.b[k]) / 2), pi = I3(pel);
    // lado de cada rodilla respecto del eje del torso del de abajo (producto cruz en XZ): a horcajadas = signos opuestos
    const ax = [bt.b[0] - bt.a[0], bt.b[2] - bt.a[2]], side = ['L', 'R'].map((s) => { const k = I3(P['knee' + s]); return Math.sign(ax[0] * (k[2] - mid[2]) - ax[1] * (k[0] - mid[0])); });
    out = { kneeY: [P.kneeL[1], P.kneeR[1]], kneePen, legPen, lean, pelY: pel[1], pelVsTorso: Math.hypot(pi[0] - mid[0], pi[2] - mid[2]), side, kneel: a.kneel.w };
  } });
  return out;
}

test('mount: a horcajadas, las dos rodillas en el piso (IK, sin atravesarlo) a los lados de la cadera del de abajo, pelvis sobre el abdomen, torso casi erguido', () => {
  for (const at of [0.5, 0.75]) {
    const g = groundPose('mount', 'gnp_punch', at);
    assert.ok(g.kneel > 0.99, `kneel ${g.kneel}`);
    for (const y of g.kneeY) assert.ok(Math.abs(y - KNEE_FLOOR) <= 0.006, `rodilla a ${y.toFixed(3)} (piso + radio = ${KNEE_FLOOR})`);
    assert.ok(g.side[0] * g.side[1] < 0, `rodillas a ambos lados: ${g.side}`);
    for (const p of g.kneePen) assert.ok(p <= 0, `rodilla dentro del de abajo ${p.toFixed(3)}`);
    assert.ok(g.legPen <= 0.02, `pierna en el de abajo ${g.legPen.toFixed(3)}`);
    assert.ok(g.pelVsTorso <= 0.15, `pelvis a ${g.pelVsTorso.toFixed(3)} del centro del torso de abajo`);
    assert.ok(g.lean <= 25, `inclinación ${g.lean.toFixed(0)}°`);
  }
});

test('mount sobre vóxeles: la rodilla sigue el piso real (escalón de 0,1 m bajo una rodilla, piso elevado)', () => {
  const bm = 0.1;
  const flat = groundPose('mount', 'gnp_punch', 0.75, { animOpts: { getBlock: (x, y) => y < 0, blockM: bm } });
  const up = groundPose('mount', 'gnp_punch', 0.75, { animOpts: { getBlock: (x, y) => y < 1, blockM: bm } });
  const step = groundPose('mount', 'gnp_punch', 0.75, { animOpts: { getBlock: (x, y, z) => y < 0 || (y === 0 && z < 0), blockM: bm } });
  for (const y of flat.kneeY) assert.ok(Math.abs(y - KNEE_FLOOR) <= 0.006, `plano ${y}`);
  for (const y of up.kneeY) assert.ok(Math.abs(y - (bm + KNEE_FLOOR)) <= 0.006, `elevado ${y}`);
  const ys = step.kneeY.slice().sort((a, b) => a - b);
  assert.ok(Math.abs(ys[0] - KNEE_FLOOR) <= 0.006 && Math.abs(ys[1] - (bm + KNEE_FLOOR)) <= 0.006, `escalón ${ys.map((v) => v.toFixed(3))}`);
});

test('guard/side/half/back: sin poses absurdas (rodillas en el piso, sin rodillas levantadas, piernas sin atravesar al de abajo, pelvis baja)', () => {
  for (const p of ['guard', 'side', 'half', 'back']) {
    const g = groundPose(p);
    assert.ok(g.kneel > 0.99, `${p}: kneel`);
    for (const y of g.kneeY) assert.ok(Math.abs(y - KNEE_FLOOR) <= 0.006, `${p}: rodilla a ${y.toFixed(3)}`);
    for (const k of g.kneePen) assert.ok(k <= 0, `${p}: rodilla dentro ${k.toFixed(3)}`);
    assert.ok(g.legPen <= 0.03, `${p}: pierna ${g.legPen.toFixed(3)}`);
    assert.ok(g.lean <= 60, `${p}: inclinación ${g.lean.toFixed(0)}°`);
    assert.ok(g.pelY >= 0.3 && g.pelY <= 0.6, `${p}: pelvis a ${g.pelY.toFixed(3)}`);
  }
});

test('codo de gnp en mount, side y desde la guardia: conecta (<= 0,02 m), pico de velocidad en el impacto y hit-stop', () => {
  for (const p of ['mount', 'side', 'guard', 'half']) {
    const m = groundMetrics(p, 'gnp_elbow');
    assert.ok(m.contact && m.contact.name === 'gnp_elbow' && m.contact.zone === 'head', `${p}: ${JSON.stringify(m.contact)}`);
    assert.ok(Math.abs(m.gapImpact) <= 0.02 && m.penMax <= 0.02 && m.segMax <= 0.02, `${p}: gap ${m.gapImpact.toFixed(3)} pen ${m.penMax.toFixed(3)} seg ${m.segMax.toFixed(3)}`);
    assert.ok(Math.abs(m.vPeakT - CLIPS.gnp_elbow.impactT) <= 1 / 60 + 1e-9, `${p}: pico a ${m.vPeakT.toFixed(3)} (impacto ${CLIPS.gnp_elbow.impactT.toFixed(3)})`);
    assert.ok(m.vImpact >= 10, `${p}: velocidad en el impacto ${m.vImpact.toFixed(1)} m/s`);
    assert.ok(m.hitStopMove / HITSTOP <= 0.15 * m.vImpact, `${p}: hit-stop ${m.hitStopMove.toFixed(3)} m en ${HITSTOP} s`);
  }
});

test('patada media: el muslo, la espinilla y el empeine no atraviesan antebrazo ni guante en ningún frame (<= 0,02 m), bloqueada o no, con guard explícito o no', () => {
  for (const b of [null, { at: 'impact' }, { at: 'impact', guard: { limb: 'forearm', side: 'L' } }]) {
    const m = blockMetrics('bodykick', b);
    assert.ok(m.guardSeg <= 0.02, `${JSON.stringify(b)}: guardSeg ${m.guardSeg.toFixed(3)}`);
    assert.ok(m.bodyPenMax <= 0.02, `${JSON.stringify(b)}: cuerpo ${m.bodyPenMax.toFixed(3)}`);
  }
});

test('bloqueos con guard explícito de Combate y chequeo espinilla contra espinilla: hueco <= 0,01 m', () => {
  const cases = [['jab', { limb: 'glove', side: 'R' }, COL.gloveR], ['cross', { limb: 'glove', side: 'L' }, COL.gloveL], ['hook', { limb: 'forearm', side: 'R' }, COL.forearmR],
    ['bodykick', { limb: 'forearm', side: 'L' }, COL.forearmL], ['highkick', { limb: 'forearm', side: 'L' }, COL.forearmL]];
  for (const [n, guard, col] of cases) {
    const m = blockMetrics(n, { at: 'impact', guard });
    assert.equal(m.blk, col, `${n}: miembro ${m.blk}`);
    assert.ok(Math.abs(m.blkGapMin) <= 0.01, `${n}: hueco ${m.blkGapMin.toFixed(3)}`);
  }
  for (const guard of [undefined, { limb: 'shin', side: 'L' }]) {
    const m = blockMetrics('lowkick', { at: 'impact', src: 'check', ...(guard ? { guard } : {}) });
    assert.equal(m.blk, COL.shinL, 'chequea con la espinilla L');
    assert.ok(Math.abs(m.blkGapMin) <= 0.01, `chequeo: hueco espinilla-espinilla ${m.blkGapMin.toFixed(3)}`);
    assert.ok(m.guardSeg <= 0.02 && m.bodyPenMax <= 0.02, `chequeo: ${m.guardSeg.toFixed(3)} / ${m.bodyPenMax.toFixed(3)}`);
  }
});

function catchRun(name, o = {}) {
  const R = { frames: [], blk: -1 }; let tC = null;
  simulateDuel(name, { block: { at: 'impact', src: 'catch', guard: { limb: 'glove', side: 'L' } }, tail: 1.2, onFrame: (t, sa, sb, a, b) => {
    if (b.catchSt && tC == null) { tC = t; if (a.contact.blk) R.blk = a.contact.blk.i; }
    if (tC == null) return;
    if (o.at != null && Math.abs(t - tC - o.at) < 1 / 120) routeCatchEvent(o.ev, { a, b });
    const ank = sa.pose.footR, cb = buildColliders(sb);
    const legIn = Math.max(...[0, 1, 6, 7].map((k) => Math.max(segPenetration([cb[k]], I3(sa.pose.kneeR), I3(ank), CONTACT.shin), segPenetration([cb[k]], I3(sa.pose.hipR), I3(sa.pose.kneeR), CONTACT.thigh))));
    R.frames.push({ dt: t - tC, kw: a.catchSt ? a.catchSt.w : 0, cw: b.catchSt ? b.catchSt.w : 0, why: b.catchSt ? b.catchSt.why : R.whyLast, hL: d3(sb.pose.handL, ank), hR: d3(sb.pose.handR, sa.pose.kneeR.map((v, k) => ank[k] + (v - ank[k]) * 0.45)), ankY: ank[1], footL: sa.pose.footL[1], legIn });
    if (b.catchSt && b.catchSt.why) R.whyLast = b.catchSt.why;
  } });
  return R;
}

test('patada atrapada: el pie entre el brazo L y el costado del que atrapa, sus manos en la pierna, el pateador en un pie; suelta por tiempo', () => {
  for (const n of ['bodykick', 'highkick']) {
    const R = catchRun(n);
    assert.equal(R.blk, COL.gloveL, `${n}: atrapa con el guante L`);
    const hold = R.frames.filter((f) => f.kw > 0.99 && f.cw > 0.99);
    assert.ok(hold.length >= 0.3 * 60, `${n}: sostiene ${hold.length} frames`);
    for (const f of hold) {
      assert.ok(f.hL <= 0.1 && f.hR <= 0.1, `${n}: manos a ${f.hL.toFixed(3)}/${f.hR.toFixed(3)} de la pierna`);
      assert.ok(f.ankY >= 0.8 && f.ankY <= 1.2, `${n}: tobillo a ${f.ankY.toFixed(2)} (cintura)`);
      assert.ok(f.footL <= (f.dt > 0.15 ? 0.09 : 0.13), `${n}: pie de apoyo a ${f.footL.toFixed(3)} (t ${f.dt.toFixed(3)})`);   // apoya en ~0,15 s
      assert.ok(f.legIn <= 0.02, `${n}: pierna dentro del que atrapa ${f.legIn.toFixed(3)}`);
    }
    assert.equal(R.whyLast, 'timeout'); const end = R.frames[R.frames.length - 1]; assert.ok(end.kw === 0 && end.cw === 0 && end.ankY < 0.2, 'suelta y baja el pie');
  }
});

test('patada atrapada: suelta según Combate (routeCatchEvent: derribo kickCatch / sweep / release) y bindCombatEvents lo enruta', () => {
  for (const [ev, why] of [[{ type: 'knockdown', action: 'kickCatch' }, 'takedown'], [{ type: 'sweep' }, 'sweep'], [{ type: 'release' }, 'release']]) {
    const R = catchRun('bodykick', { at: 0.2, ev });
    assert.equal(R.whyLast, why, JSON.stringify(ev));
    const rel = R.frames.find((f) => f.dt > 0.2 + 0.2 + 1 / 30); assert.ok(rel && rel.cw === 0, `${why}: soltada al terminar el fundido`);
  }
  assert.equal(routeCatchEvent({ type: 'knockdown', action: 'jab' }, {}), false, 'un derribo cualquiera no suelta');
  const calls = []; const an = { catchSt: {}, catchRelease: (i) => (calls.push(i.why), true) };
  const L = { ids: { a: 0, b: 1 }, fns: [], on(t, fn) { this.fns.push(fn); return () => {}; } };
  bindCombatEvents(L, { a: an, b: {} }); L.fns[0]({ type: 'takedown', move: 'kickCatch' }); assert.deepEqual(calls, ['takedown']);
});

test('peleas reales (seeds 3,7,8,36): todo el clip de cada golpe <= 0,02 m contra los 12 colisores del rival', () => {
  const r = liveClipPen({ seeds: [3, 7, 8, 36] });
  for (const n of ['jab', 'cross', 'hook', 'lowkick', 'bodykick', 'highkick', 'gnp_punch', 'gnp_body']) assert.ok(r.per[n] && r.per[n].n > 0, `${n} aparece`);
  for (const n in r.per) assert.ok(r.per[n].max <= 0.02, `${n}: ${r.per[n].max.toFixed(3)} ${JSON.stringify(r.over.filter((o) => o.name === n).slice(0, 2))}`);
});
