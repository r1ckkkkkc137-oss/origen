// combatBind.js — ronda 7: conecta los eventos de bloqueo de la sim con los animadores (liveAnim no reenvía eventos).
// Formato (Combate, confirmado): CombatEvent { type: 'block', src: 'block'|'parry'|'check'|'catch', attacker, target, action, zone,
//   power, point, guard?: { limb: 'glove'|'forearm'|'shin', side: 'L'|'R' } }. También se acepta type 'blocked' con los mismos campos.
//   attacker -> strikeBlocked(ev) (su golpe frena contra ese miembro), target/defender -> blockHit(ev) (la guardia cede, sin dolor).
//   Respaldo sin eventos: state.hurt.blocked === true en setState (ver animator3d.js).
// Uso (Motor): const la = createLiveAnimation(live, { createAnimator3D: pairedAnimatorFactory(createAnimator3D), clipMap: MOVE_CLIP, ... });
//              const off = bindCombatEvents(live, la.anims);   // off() para soltar
export function routeBlockEvent(ev, anims, ids = { a: 0, b: 1 }) {
  if (!ev || (ev.type !== 'block' && ev.type !== 'blocked')) return false;
  const side = (id) => (id === ids.a ? 'a' : id === ids.b ? 'b' : null);
  const at = side(ev.attacker), tg = side(ev.target ?? ev.defender) ?? (at === 'a' ? 'b' : at === 'b' ? 'a' : null);
  if (!at || !tg || !anims[at] || !anims[tg]) return false;
  anims[at].strikeBlocked?.(ev);   // primero el que golpea: elige el miembro (si no viene guard) y el que recibe lo usa
  anims[tg].blockHit?.(ev);
  return true;
}
// r8: después de block{src:'catch'} Combate derriba (takedown move 'kickCatch' -> CombatEvent knockdown action 'kickCatch', y el suelo en guard)
// o suelta (sin evento: A.action = null). Un sweep también suelta. Estos eventos terminan la pose de pierna atrapada en los dos animadores
// (el animador además la suelta solo al empezar el suelo, con un clip nuevo del pateador o por tiempo).
export function routeCatchEvent(ev, anims) {
  if (!ev) return false;
  const kc = ev.action === 'kickCatch' || ev.move === 'kickCatch';
  const why = ev.type === 'sweep' || ev.action === 'sweep' ? 'sweep' : kc && (ev.type === 'knockdown' || ev.type === 'takedown') ? 'takedown' : ev.type === 'release' || ev.type === 'catchRelease' ? 'release' : null;
  if (!why) return false;
  let any = false; for (const k of ['a', 'b']) if (anims[k] && anims[k].catchSt && anims[k].catchRelease) any = anims[k].catchRelease({ why }) || any;
  return any;
}
/** Suscribe a live.on('*') y enruta block/blocked (+ fin de la patada atrapada). Devuelve la función para desuscribir. */
export function bindCombatEvents(live, anims) {
  const fn = (ev) => { routeCatchEvent(ev, anims); return routeBlockEvent(ev, anims, live.ids ?? { a: 0, b: 1 }); };
  if (typeof live.on === 'function') return live.on('*', fn);
  return () => {};
}
