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
/** Suscribe a live.on('*') y enruta block/blocked. Devuelve la función para desuscribir. */
export function bindCombatEvents(live, anims) {
  const fn = (ev) => routeBlockEvent(ev, anims, live.ids ?? { a: 0, b: 1 });
  if (typeof live.on === 'function') return live.on('*', fn);
  return () => {};
}
