// Ronda 7: patadas media/alta con clips propios, bloqueo (guantes/antebrazos como colisores, evento block de Combate) y ground and pound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kickMetrics, blockMetrics, groundMetrics } from '../../../scripts/anim-metrics.mjs';
import { liveContact } from '../../../scripts/anim-live-contact.mjs';
import { CLIPS, HITSTOP } from '../clips.js';
import { createAnimator3D, pairAnimators, MOVE_CLIP, bindCombatEvents, routeBlockEvent, BODYKICK, HIGHKICK, KICK_TICKS, GNP_PUNCH, GNP_ELBOW, COL, guardIndex } from '../index.js';
import { simulateDuel, simulateGround, DUEL_DIST } from '../scenarios.js';
import { buildColliders, CONTACT } from '../contact.js';
import { CLIP_MAP } from '../../combat/liveAnim.js';
import { MOVES } from '../../combat/data/moves.js';

const KM = { bodykick: kickMetrics('bodykick'), highkick: kickMetrics('highkick') };

test('patadas media/alta: clips propios enganchados a los moves de la sim (bodyKick/highKick), tiempos de la sim', () => {
  for (const [n, mv] of [['bodykick', 'bodyKick'], ['highkick', 'highKick']]) {
    const c = CLIPS[n]; assert.ok(c && c.tip === 'kickR', n);
    assert.equal(MOVE_CLIP[mv], n); assert.ok(MOVES[mv], `${mv} existe en src/combat`);
    const [s, a, r] = KICK_TICKS[n], m = MOVES[mv];
    assert.deepEqual([m.startup, m.active, m.recovery], [s, a, r], `${n}: ticks = sim`);
    assert.ok(Math.abs(c.impactT - s / 60) < 1e-9 && Math.abs(c.duration - (s + a + r) / 60) < 1e-9);
    assert.equal(c.aim.zone, n === 'bodykick' ? 'body' : 'head');
  }
  assert.notEqual(BODYKICK, CLIPS.lowkick); assert.notEqual(HIGHKICK, CLIPS.lowkick);
  assert.equal(CLIP_MAP.bodyKick, 'lowkick', 'liveAnim (src/combat, sin tocar) sigue pidiendo lowkick: lo remapea el animador');
});

test('liveAnim sin clipMap: play("lowkick") con state.move bodyKick/highKick -> clip propio, impacto donde liveAnim lo agendó', () => {
  for (const [mv, n] of [['bodyKick', 'bodykick'], ['highKick', 'highkick']]) {
    const A = createAnimator3D({ seed: 1 }); for (let i = 0; i < 20; i++) A.update(1 / 60, { pos: [0, 0, 0], yaw: 0 });
    A.setState({ move: mv, kind: 'strike' }); A.play('lowkick');
    assert.equal(A.clipMode.name, n);
    let tImp = null; for (let i = 1; i < 60 && tImp == null; i++) { A.update(1 / 60, { pos: [0, 0, 0], yaw: 0 }); if (A.events.some((e) => e.type === 'impact')) tImp = i / 60; }
    assert.ok(Math.abs(tImp - CLIPS.lowkick.impactT) <= 1 / 60 + 1e-9, `${n}: impacto a ${tImp} (lowkick ${CLIPS.lowkick.impactT})`);
  }
  // mismo frame (liveAnim llama play antes de setState): el remapeo se corrige con el state nuevo
  const B = createAnimator3D({ seed: 2 }); for (let i = 0; i < 20; i++) B.update(1 / 60, { pos: [0, 0, 0], yaw: 0 });
  B.setState({ move: 'calfKick' }); B.play('lowkick'); assert.equal(B.clipMode.name, 'lowkick'); B.setState({ move: 'highKick' }); assert.equal(B.clipMode.name, 'highkick');
});

test('cadena cinética de la patada: rodilla cargada (< 70°) -> pierna extendida en el impacto (> 140°), pivote del pie de apoyo (> 70°)', () => {
  for (const n of ['bodykick', 'highkick']) {
    const m = KM[n];
    assert.ok(m.kneeChamber < 70, `${n}: rodilla cargada ${m.kneeChamber.toFixed(0)}°`);
    assert.ok(m.kneeImpact > 140, `${n}: rodilla en el impacto ${m.kneeImpact.toFixed(0)}°`);
    assert.ok(m.pivot > 70 * Math.PI / 180, `${n}: pivote ${(m.pivot * 180 / Math.PI).toFixed(0)}°`);
  }
});

test('patadas en duelo enlazado: contacto con la zona (costillas/cabeza), penetración <= 0,02 m, el muslo no atraviesa', () => {
  for (const n of ['bodykick', 'highkick']) {
    const m = KM[n];
    assert.ok(m.contact && m.contact.zone === (n === 'bodykick' ? 'body' : 'head') && Math.abs(m.contact.early) < 1 / 60 + 1e-6, `${n}: ${JSON.stringify(m.contact)}`);
    assert.ok(m.penImpact <= 0.02 && m.segImpact <= 0.02 && m.segMax <= 0.02, `${n}: punta ${m.penImpact.toFixed(3)} espinilla ${m.segImpact.toFixed(3)}/${m.segMax.toFixed(3)}`);
    assert.ok(m.thighMax <= 0.02, `${n}: muslo ${m.thighMax.toFixed(3)}`);
    assert.ok(m.defClips.includes(n === 'bodykick' ? 'hurt_body' : 'hurt_head'));
  }
});

test('patadas: pico de velocidad de la espinilla EN el impacto (±1 frame) y hit-stop (la punta queda clavada)', () => {
  for (const n of ['bodykick', 'highkick']) {
    const m = KM[n], I = CLIPS[n].impactT;
    assert.ok(Math.abs(m.vPeakT - I) <= 1 / 60 + 1e-9, `${n}: pico ${m.vPeak.toFixed(1)} m/s a ${m.vPeakT.toFixed(3)} (impacto ${I.toFixed(3)})`);
    assert.ok(m.vImpact > 9, `${n}: ${m.vImpact.toFixed(1)} m/s en el impacto`);
    assert.ok(m.hitStopMove < 0.09, `${n}: la punta se mueve ${m.hitStopMove.toFixed(3)} m en el hit-stop (${HITSTOP}s; sólo acompaña al rival)`);
  }
});

test('colisores de guardia: guantes y antebrazos del rival (12 colisores), índice por guard {limb, side}', () => {
  const A = createAnimator3D({ seed: 3 }), sk = A.update(1 / 60, { pos: [0, 0, 0], yaw: 0 }), cols = buildColliders(sk);
  assert.equal(cols.length, 12);
  for (const [k, limb, side] of [[COL.gloveL, 'glove', 'L'], [COL.gloveR, 'glove', 'R'], [COL.forearmL, 'forearm', 'L'], [COL.forearmR, 'forearm', 'R']]) {
    assert.equal(cols[k].limb, limb); assert.equal(cols[k].side, side); assert.ok(cols[k].guard); assert.equal(guardIndex({ limb, side }), k);
  }
  assert.equal(guardIndex({ limb: 'shin', side: 'L' }), COL.shinL); assert.equal(guardIndex(undefined), -1);
  assert.equal(cols[COL.gloveL].r, CONTACT.glove); assert.equal(cols[COL.forearmR].r, CONTACT.forearm);
});

test('jab bloqueado: el puño frena en el guante (sin guard: el más cercano a la trayectoria), la guardia cede, sin dolor en la cabeza', () => {
  for (const at of ['impact', 0.08]) {
    const m = blockMetrics('jab', { at });
    assert.ok(m.blk === COL.gloveL || m.blk === COL.gloveR || m.blk === COL.forearmL || m.blk === COL.forearmR, `blk ${m.blk}`);
    assert.ok(m.blkGapMin <= 0.01, `at ${at}: gap al guante ${m.blkGapMin.toFixed(3)}`);
    assert.ok(m.bodyPenMax <= 0.005 && m.guardSeg <= 0.01, `no atraviesa: cuerpo ${m.bodyPenMax.toFixed(3)} guardia ${m.guardSeg.toFixed(3)}`);
    assert.ok(m.defClips.includes('block_hit') && !m.defClips.some((c) => c.startsWith('hurt_')), m.defClips.join(','));
    assert.ok(m.events.some((e) => e.startsWith('blocked:')));
  }
  // guard explícito (rama siguiente de Combate): ese miembro es el colisor objetivo
  const g = blockMetrics('jab', { at: 'impact', guard: { limb: 'forearm', side: 'R' } });
  assert.equal(g.blk, COL.forearmR); assert.ok(g.blkGapMin <= 0.015, g.blkGapMin.toFixed(3));
});

test('golpe NO bloqueado: pasa entre/alrededor de los guantes sin atravesarlos (jab, cross, gancho que rodea la guardia) y hay dolor', () => {
  for (const n of ['jab', 'cross', 'hook']) {
    const m = blockMetrics(n, null);
    assert.equal(m.blk, -1); assert.ok(m.guardSeg <= 0.01, `${n}: atraviesa la guardia ${m.guardSeg.toFixed(3)}`);
    assert.ok(m.defClips.includes('hurt_head'), `${n}: ${m.defClips}`);
  }
});

test('bloqueos de cross/gancho/patadas y chequeo: frena contra el miembro (espinilla contra espinilla en el chequeo)', () => {
  for (const [n, b, lim] of [['cross', { at: 'impact' }, 0.01], ['hook', { at: 'impact' }, 0.01], ['highkick', { at: 'impact' }, 0.01], ['bodykick', { at: 'impact' }, 0.01], ['lowkick', { at: 'impact', src: 'check' }, 0.04]]) {
    const m = blockMetrics(n, b);
    assert.ok(m.blk >= 0 && m.blkGapMin <= lim, `${n}: miembro ${m.blk} gap ${m.blkGapMin.toFixed(3)} (<= ${lim})`);
    assert.ok(!m.defClips.some((c) => c.startsWith('hurt_')), `${n}: ${m.defClips}`);
    if (b.src === 'check') { assert.ok(m.blk === COL.shinL || m.blk === COL.shinR); assert.ok(m.defClips.some((c) => c.startsWith('check_hit'))); }
  }
});

test('respaldo state.hurt.blocked: sin reacción de dolor y el que golpea frena en la guardia', () => {
  const { a, b } = simulateDuel('jab', { hurtBlocked: true });
  assert.ok(b.lastBlock && b.lastBlock.name === 'block_hit'); assert.ok(!b.lastReact, 'sin react de dolor');
  assert.ok(a.contact.last && a.contact.last.blocked, JSON.stringify(a.contact.last));
});

test('bindCombatEvents: enruta block/blocked de live.on("*") (attacker -> strikeBlocked, target -> blockHit); patada atrapada marcada', () => {
  const calls = []; const mk = (s) => ({ strikeBlocked: (ev) => calls.push(s + ':strike:' + ev.src), blockHit: (ev) => calls.push(s + ':hit:' + ev.src) });
  const L = { ids: { a: 7, b: 9 }, fns: [], on(t, fn) { this.fns.push([t, fn]); return () => { this.fns = []; }; } };
  const off = bindCombatEvents(L, { a: mk('a'), b: mk('b') });
  for (const [, fn] of L.fns) { fn({ type: 'block', src: 'parry', attacker: 9, target: 7 }); fn({ type: 'hit', attacker: 7, target: 9 }); fn({ type: 'blocked', src: 'check', attacker: 7, defender: 9 }); }
  assert.deepEqual(calls, ['b:strike:parry', 'a:hit:parry', 'a:strike:check', 'b:hit:check']);
  off(); assert.equal(L.fns.length, 0);
  assert.equal(routeBlockEvent({ type: 'block', attacker: 3, target: 4 }, { a: mk('a'), b: mk('b') }), false, 'ids desconocidos: nada');
  // patada atrapada: el pie va a las manos (guante), la pose de pierna atrapada queda PENDIENTE
  const m = blockMetrics('highkick', { at: 'impact', src: 'catch' }); assert.equal(m.blk, COL.gloveL);
});

const GM = {};
for (const s of ['gnp_punch', 'gnp_elbow', 'gnp_body']) for (const p of ['mount', 'guard', 'side']) GM[s + ':' + p] = groundMetrics(p, s);

test('ground and pound: puño a la cabeza en mount/guard/side y al torso; para en la superficie (penetración <= 0,02)', () => {
  for (const s of ['gnp_punch', 'gnp_body']) for (const p of ['mount', 'guard', 'side']) {
    const m = GM[s + ':' + p];
    assert.ok(m.contact && m.contact.zone === (s === 'gnp_body' ? 'body' : 'head'), `${s} ${p}: ${JSON.stringify(m.contact)}`);
    assert.ok(Math.abs(m.gapImpact) <= 0.01, `${s} ${p}: gap ${m.gapImpact.toFixed(3)}`);
    assert.ok(m.penMax <= 0.02 && m.segMax <= 0.02, `${s} ${p}: ${m.penMax.toFixed(3)}/${m.segMax.toFixed(3)}`);
    assert.ok(Math.abs(m.vPeakT - CLIPS[s].impactT) <= 1 / 60 + 1e-9, `${s} ${p}: pico de velocidad a ${m.vPeakT.toFixed(3)}`);
  }
});

test('ground and pound: CODO (la punta es el codo) en mount y side (las posiciones de gnpElbow en la sim), para en la superficie', () => {
  assert.equal(GNP_ELBOW.tip, 'elbowR'); assert.deepEqual(MOVES.gnpElbow.pos.filter((x) => x !== 'half').sort(), ['mount', 'side']);
  for (const p of ['mount', 'side']) {
    const m = GM['gnp_elbow:' + p];
    assert.ok(m.contact && m.contact.zone === 'head', `${p}: ${JSON.stringify(m.contact)}`);
    assert.ok(m.gapImpact <= 0.01 && m.penMax <= 0.02 && m.segMax <= 0.02, `${p}: gap ${m.gapImpact.toFixed(3)} pen ${m.penMax.toFixed(3)} seg ${m.segMax.toFixed(3)}`);
  }
});

test('ground and pound: la cabeza del que recibe rebota contra el suelo sin atravesarlo', () => {
  for (const p of ['mount', 'guard', 'side']) {
    const m = GM['gnp_punch:' + p];
    assert.ok(m.headFloorMin >= -0.001, `${p}: cabeza ${m.headFloorMin.toFixed(3)} m bajo el suelo`);
    assert.ok(m.bounce && m.bounce.down > 0.05 && m.bounce.up > 0.05, `${p}: rebote ${JSON.stringify(m.bounce)}`);
  }
  assert.ok(GM['gnp_punch:mount'].headFloorMin < 0.02, 'en mount la cabeza llega a tocar el suelo (frena en la superficie)');
});

test('suelo: capa por stance groundTop/groundBottom + groundPos; liveAnim sin clipMap ("jab") -> gnp_punch/gnp_elbow', () => {
  const { a, b } = simulateGround('mount', 'gnp_punch', { viaPlay: 'jab', tail: 0.1 });
  assert.equal(a.ground.role, 'top'); assert.equal(b.ground.role, 'bottom'); assert.ok(a.gndW > 0.99 && b.gndW > 0.99);
  assert.ok(a.contact.last && a.contact.last.name === 'gnp_punch');
  const e = groundMetrics('mount', 'gnp_elbow', { viaPlay: 'jab' }); assert.ok(e.contact && e.contact.name === 'gnp_elbow' && e.penMax <= 0.02);
  assert.equal(GNP_PUNCH.tip, 'R');
});

test('pelea real con suelo y bloqueos (seeds 3,7,8,36): patadas propias, gnp con contacto, cabeza nunca bajo el suelo, <= 0,02 en el impacto', () => {
  const r = liveContact({ seeds: [3, 7, 8, 36], maxFrames: 60 * 400 });
  for (const n of ['bodykick', 'highkick', 'gnp_punch', 'gnp_body']) { const p = r.per[n]; assert.ok(p && p.n > 0 && p.contacts > 0, `${n}: ${JSON.stringify(p)}`); }
  for (const n in r.per) assert.ok(r.per[n].penImpactMax <= 0.02, `${n}: ${r.per[n].penImpactMax.toFixed(3)}`);
  assert.ok(!r.per.lowkick.sims.includes('bodyKick') && !r.per.lowkick.sims.includes('highKick'), r.per.lowkick.sims);
  assert.ok(r.blocks > 0 && r.groundFrames > 0); assert.ok(r.headFloorMin >= -0.001, `cabeza ${r.headFloorMin}`);
});

test('patadas media/alta NO bloqueadas: la pierna entera (muslo, espinilla, empeine) no atraviesa guantes/antebrazos del rival (<= 0,05 m; ceden o la pierna los rodea al recoger); la media de derecha se bloquea con el brazo L', () => {
  for (const n of ['bodykick', 'highkick']) {
    const m = blockMetrics(n, null);
    assert.ok(m.guardSeg <= 0.05, `${n}: guardSeg ${m.guardSeg.toFixed(3)}`);
    const b = blockMetrics(n, { at: 'impact' });
    assert.ok(b.events.some((e) => /blocked:(forearm|glove)L/.test(e)), `${n}: ${b.events.join(' ')}`);
  }
});
