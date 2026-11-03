// Adaptador createLiveFight -> createAnimator3D (src/anim). Se INYECTA la fábrica del animador (no se importa src/anim desde combat):
//   const live = createLiveFight({...});  const la = createLiveAnimation(live, { createAnimator3D, getBlock: world.solidAt, blockM: BLOCK_M });
//   cada frame:  la.update(dt)  ->  { frame, skeletons:{a,b} }   (Skeleton3D del contrato, listos para humanView/Arte)
// La sim es dueña de pos/yaw (sólo se LEEN en el animador); lo único que se le pide a la animación es play(clip) en el momento justo.
// anim-r2: clips jab, cross, hook, lowkick (+ reacciones vía setState). Lo que no tiene clip propio usa el más parecido (aprox.).
export const CLIP_MAP = Object.freeze({ strike: 'jab', jab: 'jab', cross: 'cross', overhand: 'cross', hook: 'hook', uppercut: 'hook',
  lowKick: 'lowkick', calfKick: 'lowkick', bodyKick: 'lowkick', highKick: 'lowkick', teep: 'lowkick' });   // kind del movimiento -> clip disponible (override por move: opts.clipMap)
/** Lo que le falta a Animador para representar lo que la sim ya produce (state/eventos de createLiveFight). */
export const ANIM_GAPS = Object.freeze([
  'cross / hook / uppercut / overhand / body shots: sólo existe jab (mano izquierda); todos los golpes de mano salen como jab',
  'patadas (teep, low/body/high kick, calf), rodillas (flyingKnee, clinchKnee) y codos: sin clip; se muestran como jab (aprox.)',
  'clip por progreso: play(name) corre a tiempo real (jab 0.46 s, impacto 0.152 s); la sim da windup/active/recovery y moveSeconds. Pedir play(name,{speed}) o playAt(name, t) para sincronizar velocidad al stat y a la fase de la sim',
  'reacciones: hit-react por zona (state.hurt.zone: head|body|legs), rocked (aturdido), block/parry/check, dodge/slip, feint',
  'guardia con state.guard (0..1): hoy la guardia es fija; falta bajar/subir manos según guard',
  'derribos y suelo: takedown/sprawl/shoot, caída y levantarse (state.stance down/groundTop/groundBottom), KO (stance ko) y victoria (stance victory)',
  'clinch: entrada, underhook/tie, rodillas y codos de clinch (stance clinch)',
  'suelo: posiciones top/bottom (state.position + groundPos: guard|mount|side|back), pasada, sumisiones (sub, subProgress)',
  'locomoción: la guardia/caminar actual no distingue stepIn/stepOut/circle/pivot (state.loco.mode)',
]);

/**
 * @param {object} live  createLiveFight(...)
 * @param {{createAnimator3D:Function, getBlock?:Function, blockM?:number, seed?:number, clipMap?:object, impactT?:number}} opt
 */
export function createLiveAnimation(live, opt) {
  const { createAnimator3D } = opt;
  if (typeof createAnimator3D !== 'function') throw new Error('createLiveAnimation: falta opt.createAnimator3D');
  const clipMap = { ...CLIP_MAP, ...(opt.clipMap ?? {}) };
  const impactT = opt.impactT ?? 0.152;           // tiempo del clip 'jab' hasta el impacto (s)
  const anims = {}, pending = { a: null, b: null }, skeletons = {};
  let clock = 0;
  const seed = opt.seed ?? 1;
  ['a', 'b'].forEach((side, i) => {
    anims[side] = createAnimator3D({ seed: seed * 31 + i, getBlock: opt.getBlock, blockM: opt.blockM });
  });
  const clipFor = (move, kind) => clipMap[move] ?? clipMap[kind] ?? null;
  const sideOfId = (id) => (id === live.ids.a ? 'a' : id === live.ids.b ? 'b' : null);
  let skipFirst = true;

  function feed(dt) {
    const F = live.frame;
    // actionStart (y amago) -> programa el clip para que el impacto del clip caiga en el impacto de la sim (fin del windup)
    for (const ev of F.events) {
      if (ev.type !== 'actionStart') continue;
      const side = sideOfId(ev.attacker); if (!side) continue;
      const st = F.fighters[side].state;
      const clip = clipFor(ev.action, st.kind);
      if (!clip) continue;
      const iT = anims[side].clipInfo?.(clip)?.impactT ?? impactT;   // impacto propio de cada clip
      pending[side] = { clip, move: ev.action, at: clock + Math.max(0, st.windupSeconds - iT) };
    }
    for (const side of ['a', 'b']) {
      const p = pending[side];
      if (p && clock >= p.at) { if (F.fighters[side].state.move === p.move) anims[side].play(p.clip); pending[side] = null; }
    }
    for (const side of ['a', 'b']) {
      const f = F.fighters[side];
      anims[side].setState?.(f.state);              // hurt por zona, rocked, down/ko -> getUp, guard (cada frame)
      skeletons[side] = anims[side].update(dt, { pos: f.pos, yaw: f.yaw });
    }
  }
  const out = {
    live, anims, skeletons, gaps: ANIM_GAPS,
    /** update(dt): avanza la sim y el animador. dt = segundos de render. */
    update(dt, input) {
      const f = live.update(dt, input);
      clock += Math.max(0, dt);
      if (dt > 0 || skipFirst) { feed(dt > 0 ? dt : 1e-3); skipFirst = false; }
      return { frame: f, skeletons };
    },
    /** Tras live.restart(): re-ancla los animadores en las nuevas raíces. */
    restart(seed) { live.restart(seed); pending.a = pending.b = null; return out.update(1e-3); },
  };
  out.update(1e-3);   // esqueletos iniciales
  return out;
}
