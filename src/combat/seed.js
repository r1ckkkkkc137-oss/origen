// Semilla de pelea derivada del mundo: misma partida (worldSeed) + mismo lugar/encuentro => misma pelea.
// Se apoya en hash3 de src/shared/rng.js (hash espacial sin estado, orden-independiente). El RNG de la sim sigue siendo el
// sfc32 de KAGE (core/rng.js, necesario para la paridad bit a bit) y se siembra con el u32 que sale de acá.
import { hash3, hashSeed } from '../shared/rng.js';

const FIGHT_SALT = 0x46494754;                         // 'FIGT': separa el espacio de hashes de peleas del de generación de mundo
const u32 = (h) => Math.round(h * 4294967296) >>> 0;   // hash3 devuelve h/2^32 exacto
const asInt = (v) => (typeof v === 'number' ? v : hashSeed(v)) | 0;

const mix = (worldSeed, salt) => (asInt(worldSeed) ^ FIGHT_SALT ^ Math.imul(asInt(salt), 0x9e3779b1)) | 0;
const seedAt = (ws, x, y, z, salt) => u32(hash3(mix(ws, salt), Math.floor(x), Math.floor(y), Math.floor(z)));
const seedOf = (ws, id, salt) => u32(hash3(mix(ws, salt), asInt(id), hashSeed('encounter'), 0));

/**
 * Seed (u32) de una pelea, derivada del mundo.
 *   fightSeed(worldSeed, x, y, z [, salt])      lugar del encuentro, coords de mundo (bloques; Math.floor de cada una)
 *   fightSeed(worldSeed, encounterId [, salt])  id estable de encuentro (string o número)
 * `salt` (opcional, default 0) distingue revanchas / segundas peleas en el mismo sitio.
 * @param {number|string} worldSeed
 * @returns {number} u32 listo para createFight/simulateFight
 */
export function fightSeed(worldSeed, x, y, z, salt = 0) {
  if (typeof x === 'string' || y === undefined) return seedOf(worldSeed, x, y ?? 0);
  return seedAt(worldSeed, x, y, z, salt);
}

/**
 * Normaliza el 3er argumento de createFight/simulateFight/replayFight.
 *   número                                  -> seed crudo (KAGE; paridad bit a bit)
 *   { worldSeed, x, y, z, salt? }           -> fightSeed(worldSeed, x, y, z, salt)
 *   { worldSeed, encounterId }              -> fightSeed(worldSeed, encounterId)
 * @returns {{seed:number, worldSeed?:number|string, location?:[number,number,number], encounterId?:string|number}}
 */
export function resolveFightSeed(s) {
  if (s == null) return { seed: 1 };
  if (typeof s === 'number') return { seed: s >>> 0 };
  if (typeof s !== 'object' || s.worldSeed == null) throw new Error('resolveFightSeed: se espera número o { worldSeed, x,y,z | encounterId }');
  if (s.encounterId != null) return { seed: fightSeed(s.worldSeed, s.encounterId, s.salt ?? 0), worldSeed: s.worldSeed, encounterId: s.encounterId };
  if ([s.x, s.y, s.z].some((v) => !Number.isFinite(v))) throw new Error('resolveFightSeed: faltan x, y, z (o encounterId)');
  return { seed: fightSeed(s.worldSeed, s.x, s.y, s.z, s.salt), worldSeed: s.worldSeed, location: [s.x, s.y, s.z] };
}
