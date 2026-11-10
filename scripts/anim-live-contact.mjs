// Ronda 6: contacto en peleas reales (createLiveFight + createLiveAnimation). Uso: node scripts/anim-live-contact.mjs [peleas=6] [nolink]
// Con `pairedAnimatorFactory()` como createAnimator3D (lo que haría Motor). Por golpe: distancia raíz–raíz y pelvis–pelvis en el impacto,
// penetración de la punta y profundidad "a través" (segmentos hombro->codo->nudillos / cadera->rodilla->espinilla) contra el rival.
import { createLiveFight, createLiveAnimation } from '../src/combat/index.js';
import { createAnimator3D, pairedAnimatorFactory, bindCombatEvents, MOVE_CLIP, CLIPS } from '../src/anim/index.js';
import { buildColliders, segPenetration, penetration, CONTACT } from '../src/anim/contact.js';

const I3 = (w) => [-w[2], w[1], w[0]];
const STRIKES = new Set(['jab', 'cross', 'hook', 'lowkick', 'bodykick', 'highkick', 'gnp_punch', 'gnp_elbow', 'gnp_body']);   // r7: + patadas media/alta y suelo
export function liveContact({ fights = 6, link = true, seeds = null, maxFrames = 60 * 90, clipMap = null, bind = true } = {}) {
  const per = {}; let hurtPower = 0, hurtTotal = 0, blocks = 0, blockedHurt = 0, headFloorMin = Infinity, groundFrames = 0;
  const list = seeds || Array.from({ length: fights }, (_, k) => k + 1);
  for (const seed of list) {
    const live = createLiveFight({ seed });
    const la = createLiveAnimation(live, { createAnimator3D: link ? pairedAnimatorFactory() : createAnimator3D, seed, ...(clipMap ? { clipMap } : {}) });
    const off = bind ? bindCombatEvents(live, la.anims) : null;
    if (bind) live.on('block', () => { blocks++; });
    const open = { a: null, b: null };
    for (let i = 0; i < maxFrames && !live.done; i++) {
      la.update(1 / 60);
      for (const s of ['a', 'b']) { const A = la.anims[s]; if (A.ground && A.ground.role === 'bottom') { groundFrames++; const sk = A.skeleton; headFloorMin = Math.min(headFloorMin, sk.pose.head[1] + (sk.tips.headTop[1] - sk.pose.head[1]) * CONTACT.headC - CONTACT.head - sk.root.pos[1]); } if (A.lastReact && A.blockedAt >= 0 && A.lastReact.at === undefined) {} }
      for (const [s, o] of [['a', 'b'], ['b', 'a']]) {
        const A = la.anims[s], B = la.anims[o], st = live.frame.fighters[o].state;
        if (st.hurt && st.hurt.age === 0) { hurtTotal++; if (st.hurt.power != null) hurtPower++; }
        const name = A.clip ? A.clipMode.name : '';
        const mapped = STRIKES.has(name) ? name : null;
        if (!mapped) { if (open[s]) { (per[open[s].name] ||= []).push(open[s]); open[s] = null; } continue; }
        if (!open[s] || open[s].name !== mapped || A.clipT < open[s].lastT - 1e-6) { if (open[s]) (per[open[s].name] ||= []).push(open[s]); open[s] = { name: mapped, sim: live.frame.fighters[s].state.move, segMax: 0, penMax: 0, imp: null, contact: false, lastT: 0 }; }
        const R = open[s]; R.lastT = A.clipT;
        const sk = A.skeleton, ob = B.skeleton, cols = buildColliders(ob).slice(0, 8), tip = CLIPS[mapped].tip, kick = tip === 'kickR', elb = tip === 'elbowR', side = kick || elb ? 'R' : tip;
        const O = I3(kick ? sk.pose.hipR : sk.pose['shoulder' + side]), M = I3(kick ? sk.pose.kneeR : sk.pose['elbow' + side]), T = I3(A.strike.fist), rt = kick ? CONTACT.shinTip : elb ? CONTACT.elbow : CONTACT.fist;
        const tun = elb ? segPenetration(cols, O, M, rt) : Math.max(segPenetration(cols, O, M, rt), segPenetration(cols, M, T, rt)), pen = Math.max(0, penetration(cols, T, rt).pen);
        R.segMax = Math.max(R.segMax, tun); R.penMax = Math.max(R.penMax, pen);
        if (A.events.some((e) => e.type === 'contact')) R.contact = true;
        if (!R.imp && A.clipT >= A.clip.impactT - 1e-9) {
          const ra = sk.root.pos, rb = ob.root.pos;
          R.imp = { rootDist: Math.hypot(ra[0] - rb[0], ra[2] - rb[2]), pelvisDist: Math.hypot(sk.pose.pelvis[0] - ob.pose.pelvis[0], sk.pose.pelvis[2] - ob.pose.pelvis[2]), seg: tun, pen, entryK: A.clipMode.entryK ?? 0 };
        }
      }
    }
    if (off) off();
  }
  const med = (a) => { const b = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
  const out = {};
  for (const n in per) {
    const L = per[n].filter((r) => r.imp);
    out[n] = { n: L.length, contacts: L.filter((r) => r.contact).length, rootDistMed: med(L.map((r) => r.imp.rootDist)), rootDistMin: Math.min(...L.map((r) => r.imp.rootDist)), rootDistMax: Math.max(...L.map((r) => r.imp.rootDist)),
      pelvisDistMed: med(L.map((r) => r.imp.pelvisDist)), penImpactMax: Math.max(...L.map((r) => r.imp.pen)), segImpactMax: Math.max(...L.map((r) => r.imp.seg)), penWinMax: Math.max(...L.map((r) => r.penMax)), segWinMax: Math.max(...L.map((r) => r.segMax)),
      entryKMed: med(L.map((r) => r.imp.entryK)), sims: [...new Set(L.map((r) => r.sim))].join('/') };
  }
  return { per: out, hurtTotal, hurtPower, blocks, groundFrames, headFloorMin };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const fights = +(process.argv[2] || 6), link = process.argv[3] !== 'nolink', seeds = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
  const r = liveContact({ fights, link, seeds, clipMap: process.argv.includes('clipmap') ? MOVE_CLIP : null });
  console.log(JSON.stringify(r, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v, 1));
}

// ---- r8: penetración de TODO el clip (no sólo la ventana del impacto) en peleas reales, contra los 12 colisores del rival
//  (cabeza, torso, muslos, espinillas, cuello, hombros, guantes, antebrazos). Segmentos: hombro->codo (OM), codo->punta (MT),
//  y en patadas cadera->rodilla (r 0,06), rodilla->espinilla, espinilla->pie (TF). Devuelve por golpe { n, max, over } y la lista > thr.
export function liveClipPen({ seeds = [3, 7, 8, 36], frames = 60 * 400, thr = 0.02 } = {}) {
  const out = [], per = {};
  for (const seed of seeds) {
    const live = createLiveFight({ seed });
    const la = createLiveAnimation(live, { createAnimator3D: pairedAnimatorFactory(), seed, clipMap: MOVE_CLIP });
    const off = bindCombatEvents(live, la.anims); const open = {};
    const close = (s) => { const R = open[s]; if (!R) return; const p = (per[R.name] ||= { n: 0, max: 0, over: 0 }); p.n++; p.max = Math.max(p.max, R.v); if (R.v > thr) { p.over++; out.push(R); } open[s] = null; };
    for (let i = 0; i < frames && !live.done; i++) {
      la.update(1 / 60);
      for (const [s, o] of [['a', 'b'], ['b', 'a']]) {
        const A = la.anims[s], B = la.anims[o]; const name = A.clip ? A.clipMode.name : '';
        if (!STRIKES.has(name)) { close(s); continue; }
        if (!open[s] || open[s].name !== name || A.clipT < open[s].lt - 1e-6) { close(s); open[s] = { seed, i, name, v: 0, lt: 0 }; }
        const R = open[s]; R.lt = A.clipT;
        const sk = A.skeleton, cols = buildColliders(B.skeleton), tip = CLIPS[name].tip, kick = tip === 'kickR', elb = tip === 'elbowR', side = kick || elb ? 'R' : tip;
        const O = I3(kick ? sk.pose.hipR : sk.pose['shoulder' + side]), M = I3(kick ? sk.pose.kneeR : sk.pose['elbow' + side]), T = I3(A.strike.fist), rt = kick ? CONTACT.shinTip : elb ? CONTACT.elbow : CONTACT.fist;
        const F = kick ? I3(sk.pose.footR) : null;
        for (let k = 0; k < 12; k++) {
          const C = [cols[k]], segs = [['OM', segPenetration(C, O, M, kick ? 0.06 : rt)], ['MT', elb ? 0 : segPenetration(C, M, T, rt)]];
          if (kick) segs.push(['TF', segPenetration(C, T, F, rt)]);
          for (const [sn, v] of segs) if (v > R.v) Object.assign(R, { v, seg: sn, col: k, t: +(A.clipT - A.clip.impactT).toFixed(3) });
        }
      }
    }
    close('a'); close('b'); off();
  }
  return { per, over: out.sort((a, b) => b.v - a.v) };
}
