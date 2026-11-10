// Ronda 6: contacto en peleas reales (createLiveFight + createLiveAnimation). Uso: node scripts/anim-live-contact.mjs [peleas=6] [nolink]
// Con `pairedAnimatorFactory()` como createAnimator3D (lo que haría Motor). Por golpe: distancia raíz–raíz y pelvis–pelvis en el impacto,
// penetración de la punta y profundidad "a través" (segmentos hombro->codo->nudillos / cadera->rodilla->espinilla) contra el rival.
import { createLiveFight, createLiveAnimation } from '../src/combat/index.js';
import { createAnimator3D, pairedAnimatorFactory } from '../src/anim/index.js';
import { buildColliders, segPenetration, penetration, CONTACT } from '../src/anim/contact.js';

const I3 = (w) => [-w[2], w[1], w[0]];
const STRIKES = new Set(['jab', 'cross', 'hook', 'lowkick']);
export function liveContact({ fights = 6, link = true, seeds = null, maxFrames = 60 * 90 } = {}) {
  const per = {}; let hurtPower = 0, hurtTotal = 0;
  const list = seeds || Array.from({ length: fights }, (_, k) => k + 1);
  for (const seed of list) {
    const live = createLiveFight({ seed });
    const la = createLiveAnimation(live, { createAnimator3D: link ? pairedAnimatorFactory() : createAnimator3D, seed });
    const open = { a: null, b: null };
    for (let i = 0; i < maxFrames && !live.done; i++) {
      la.update(1 / 60);
      for (const [s, o] of [['a', 'b'], ['b', 'a']]) {
        const A = la.anims[s], B = la.anims[o], st = live.frame.fighters[o].state;
        if (st.hurt && st.hurt.age === 0) { hurtTotal++; if (st.hurt.power != null) hurtPower++; }
        const name = A.clip ? A.clipMode.name : '';
        const mapped = STRIKES.has(name) ? name : null;
        if (!mapped) { if (open[s]) { (per[open[s].name] ||= []).push(open[s]); open[s] = null; } continue; }
        if (!open[s] || open[s].name !== mapped || A.clipT < open[s].lastT - 1e-6) { if (open[s]) (per[open[s].name] ||= []).push(open[s]); open[s] = { name: mapped, sim: live.frame.fighters[s].state.move, segMax: 0, penMax: 0, imp: null, contact: false, lastT: 0 }; }
        const R = open[s]; R.lastT = A.clipT;
        const sk = A.skeleton, ob = B.skeleton, cols = buildColliders(ob), kick = mapped === 'lowkick', side = kick ? 'R' : A.clip.tip;
        const O = I3(kick ? sk.pose.hipR : sk.pose['shoulder' + side]), M = I3(kick ? sk.pose.kneeR : sk.pose['elbow' + side]), T = I3(A.strike.fist), rt = kick ? CONTACT.shinTip : CONTACT.fist;
        const tun = Math.max(segPenetration(cols, O, M, rt), segPenetration(cols, M, T, rt)), pen = Math.max(0, penetration(cols, T, rt).pen);
        R.segMax = Math.max(R.segMax, tun); R.penMax = Math.max(R.penMax, pen);
        if (A.events.some((e) => e.type === 'contact')) R.contact = true;
        if (!R.imp && A.clipT >= A.clip.impactT - 1e-9) {
          const ra = sk.root.pos, rb = ob.root.pos;
          R.imp = { rootDist: Math.hypot(ra[0] - rb[0], ra[2] - rb[2]), pelvisDist: Math.hypot(sk.pose.pelvis[0] - ob.pose.pelvis[0], sk.pose.pelvis[2] - ob.pose.pelvis[2]), seg: tun, pen, entryK: A.clipMode.entryK ?? 0 };
        }
      }
    }
  }
  const med = (a) => { const b = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
  const out = {};
  for (const n in per) {
    const L = per[n].filter((r) => r.imp);
    out[n] = { n: L.length, contacts: L.filter((r) => r.contact).length, rootDistMed: med(L.map((r) => r.imp.rootDist)), rootDistMin: Math.min(...L.map((r) => r.imp.rootDist)), rootDistMax: Math.max(...L.map((r) => r.imp.rootDist)),
      pelvisDistMed: med(L.map((r) => r.imp.pelvisDist)), penImpactMax: Math.max(...L.map((r) => r.imp.pen)), segImpactMax: Math.max(...L.map((r) => r.imp.seg)), penWinMax: Math.max(...L.map((r) => r.penMax)), segWinMax: Math.max(...L.map((r) => r.segMax)),
      entryKMed: med(L.map((r) => r.imp.entryK)), sims: [...new Set(L.map((r) => r.sim))].join('/') };
  }
  return { per: out, hurtTotal, hurtPower };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const fights = +(process.argv[2] || 6), link = process.argv[3] !== 'nolink';
  const r = liveContact({ fights, link });
  console.log(JSON.stringify(r, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v, 1));
}
