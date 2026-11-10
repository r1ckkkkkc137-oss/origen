// Interacción del jugador con el mundo: apuntar (raycast desde la cámara), cavar manteniendo (tiempo = dureza), talar árboles enteros
// (fellTree con dirección: cae lejos del jugador), poner bloques del inventario y recoger items del suelo. Todo en METROS salvo celdas.
// No es parte de la sim determinista de pelea; el mundo sí queda determinista dada la misma secuencia de acciones.
import { BLOCKS, IS_LOG, B } from '../world/index.js';
import { BLOCK_M } from '../shared/contracts.js';

export const REACH_M = 4.5;
export const DIG_SPEED = 2;            // dureza (s) / DIG_SPEED = segundos manteniendo
const PLACE_COOLDOWN = 0.22;

export function createInteraction(world, player, opts = {}) {
  const inv = new Map(opts.inventory ?? [[B.DIRT, 16], [B.STONE, 8]]);
  let sel = 0, aim = null, dig = null, cool = 0, lastNext = false;
  const order = () => [...inv.keys()].filter((id) => inv.get(id) > 0 && BLOCKS[id]?.solid);
  const add = (id, n = 1) => { if (id > 0 && BLOCKS[id]) inv.set(id, (inv.get(id) ?? 0) + n); };
  const solids = () => [{ minX: player.x - 0.3, maxX: player.x + 0.3, minY: player.y, maxY: player.y + 1.8, minZ: player.z - 0.3, maxZ: player.z + 0.3 }];
  return {
    inv, get aim() { return aim; }, get dig() { return dig; },
    get selected() { const o = order(); return o.length ? o[sel % o.length] : 0; },
    /**
     * @param {number} dt
     * @param {[number,number,number]} eye  ojo en metros
     * @param {[number,number,number]} dir  dirección de la mirada
     * @param {{dig:boolean, place:boolean, next:boolean}} act
     */
    update(dt, eye, dir, act) {
      for (const it of world.pickupItems([player.x, player.y + 0.4, player.z], 1.5)) add(it.id, it.count);
      aim = world.raycastM(eye, dir, REACH_M);
      cool = Math.max(0, cool - dt);
      if (act.next && !lastNext) sel++; lastNext = act.next;
      const events = [];
      if (act.dig && aim) {
        const [x, y, z] = aim.pos, k = `${x},${y},${z}`;
        if (!dig || dig.key !== k) dig = { key: k, pos: aim.pos, t: 0, need: (BLOCKS[aim.block]?.hardness ?? 1) / DIG_SPEED };
        dig.t += dt;
        if (dig.t >= dig.need) {
          if (IS_LOG[aim.block]) {
            const r = world.fellTree(x, y, z, { fromX: player.x / BLOCK_M, fromZ: player.z / BLOCK_M });
            if (r) events.push({ type: 'fell', pos: aim.pos, logs: r.logs });
          } else {
            const r = world.dig(x, y, z);
            if (r) { add(r.drop); events.push({ type: 'dig', pos: aim.pos, block: r.broken }); }
          }
          dig = null;
        }
      } else dig = null;
      if (act.place && aim && cool === 0) {
        const id = this.selected;
        if (id && world.place(aim.place[0], aim.place[1], aim.place[2], id, solids())) {
          inv.set(id, inv.get(id) - 1); cool = PLACE_COOLDOWN; events.push({ type: 'place', pos: aim.place, block: id });
        }
      }
      return events;
    },
  };
}
