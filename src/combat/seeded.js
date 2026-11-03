// createFight / simulateFight / replayFight con semilla de mundo. Envuelven core/index.js SIN tocarlo:
//   - 3er argumento NÚMERO  -> camino crudo de KAGE (idéntico bit a bit; es el que usan los tests de paridad).
//   - 3er argumento { worldSeed, x, y, z [, salt] } | { worldSeed, encounterId [, salt] } -> seed = fightSeed(...) (hash3 del mundo).
//     Con geometría 3D y lugar (x,y,z), el centro del ring se ubica en ese punto del mundo (spec.origin, bloques) salvo que ya traiga `origin`.
//     El resultado/pelea lleva además `worldSeed` y `location`|`encounterId`.
import * as core from './core/index.js';
import { resolveFightSeed } from './seed.js';

function prepare(seedArg, opts = {}) {
  const r = resolveFightSeed(seedArg);
  let o = opts;
  if (r.location) {
    const g = opts.geometry;
    if (g === '3d') o = { ...opts, geometry: { kind: '3d', origin: r.location } };
    else if (g && typeof g === 'object' && g.kind === '3d' && typeof g.bind !== 'function' && g.origin == null) o = { ...opts, geometry: { ...g, origin: r.location } };
  }
  return { r, o };
}
const tag = (obj, r) => {
  if (r.worldSeed == null) return obj;
  obj.worldSeed = r.worldSeed;
  if (r.location) obj.location = r.location; else obj.encounterId = r.encounterId;
  return obj;
};

/** createFight(p1, p2, seed | { worldSeed, x,y,z | encounterId, salt? }, opts) */
export function createFight(p1, p2, seed = 1, opts = {}) {
  const { r, o } = prepare(seed, opts);
  return tag(core.createFight(p1, p2, r.seed, o), r);
}
export function simulateFight(a, b, seed = 1, opts = {}) {
  const { r, o } = prepare(seed, opts);
  return tag(core.simulateFight(a, b, r.seed, o), r);
}
export function replayFight(a, b, seed, inputsOrResult, opts = {}) {
  const { r, o } = prepare(seed, opts);
  return tag(core.replayFight(a, b, r.seed, inputsOrResult, o), r);
}
