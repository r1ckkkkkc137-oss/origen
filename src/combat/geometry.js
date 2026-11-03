// Adaptador de geometría del núcleo de combate (src/combat/core). ÚNICO punto por donde el núcleo toca el espacio:
// posiciones, orientación, distancias, paredes del ring, separación mínima, knockback y huesos.
//
// El núcleo (core.js / resolve.js / ai.js / controllers.js) NO lee ni escribe `f.x`, `f.facing` ni `f.pos`:
// todo pasa por `F.geo` (una instancia de Geometry). La lógica de combate sigue siendo "1D" (alcance = distancia
// entre anclas, adelante/atrás, contra la pared); la geometría decide qué significa eso en el mundo.
//
// Unidades: la sim va en PX de KAGE (UNITS.PX_PER_M = 85 px/m, ring de radio/semiancho `cage` = 260 px). Geometry3D convierte en el
// borde a unidades de mundo de ORIGEN (1 bloque = BLOCK_M m; ver geometry3d.js) con una sola constante.
//
// Implementaciones:
//   Geometry2D (geometry2d.js): reproduce KAGE bit a bit (eje 1D, z = 0).  createGeometry('2d')
//   Geometry3D (geometry3d.js): peleadores en el plano XZ con heading, ring circular, esqueleto 3D. createGeometry('3d', opts)
//
// REGLA DE DETERMINISMO: la simulación (resultado de la pelea) sólo puede depender de las posiciones/headings
// raíz que maneja el adaptador, NUNCA de la pose animada (la animación es presentación). boneWorldPos/hurtboxes/
// contactPoint son de LECTURA para render/animación/VFX y no deben realimentar a la sim.

import { createGeometry2D } from './geometry2d.js';
import { createGeometry3D } from './geometry3d.js';

/**
 * @typedef {[number, number, number]} Vec3   [x,y,z] en las unidades del adaptador (geo.units: '2d' = px de KAGE, '3d' = METROS, como Skeleton3D)
 * @typedef {{a:Vec3, b:Vec3, radius:number, zone:'head'|'body'|'legs'|'armL'|'armR', bones:[string,string]}} Capsule  (unidades del adaptador)
 * @typedef {object} Fighter  runtime del núcleo (createRuntime). Sólo el adaptador toca sus campos de posición.
 *
 * @typedef {object} Geometry
 * @property {'2d'|'3d'} kind
 * @property {'px'|'m'} units                                          Unidad de lo que SALE hacia afuera (boneWorldPos, hurtboxes, contactPoint, tickExtras.pos). 3D: metros; `toBlocks`/`fromBlocks` convierten a bloques de mundo (BLOCK_M).
 * @property {(F:object)=>void} bind            Se llama una vez al crear la pelea (F.fighters ya existen).
 *
 * --- Colocación / orientación ---
 * @property {(A:Fighter,B:Fighter,startGap:number)=>void} place         Posiciones de inicio de round: A a la izquierda mirando a B, a startGap px.
 * @property {(f:Fighter)=>number} facingSign                            ±1: lado de la postura (qué brazo/pierna va adelante). NO es una dirección de mundo.
 * @property {(A:Fighter,B:Fighter)=>void} faceEachOther                 Orienta a ambos uno hacia el otro (sólo se llama de pie).
 * @property {(f:Fighter)=>number} axisX                                 Coordenada de arena firmada para tick.x (HUD/metrics). 2D: x. 3D: x de mundo.
 * @property {(f:Fighter)=>(object|null)} tickExtras                    Campos extra del tick de ese peleador (null en 2D, para no cambiar la forma del tick; {pos, heading} en 3D).
 *
 * --- Distancia ---
 * @property {(a:Fighter,b:Fighter)=>number} distance                    Distancia ancla–ancla (px) = lo que miden rangeMin/rangeMax de data/moves.js.
 *
 * --- Movimiento ---
 * @property {(f:Fighter,dx:number)=>void} moveAlong                     Mueve dx px a lo largo del facing (dx>0 = hacia el rival). Sin límite de pared.
 * @property {(f:Fighter,o:Fighter,px:number)=>void} orbit                Orbita/circula px (con signo = sentido). 2D: igual que moveAlong; 3D: tangencial alrededor del rival.
 * @property {(f:Fighter,px:number)=>void} applyKnockback                Empuje px hacia atrás (opuesto al facing) en este tick.
 * @property {(f:Fighter)=>void} clampToRing                             Devuelve al peleador dentro del ring.
 * @property {(f:Fighter,o:Fighter,mag:number)=>void} recenterPair       Desplaza a los DOS mag px hacia el centro del ring (pivot/circle contra la pared).
 *
 * --- Pared ---
 * @property {(f:Fighter)=>number} wallDistance                          px que le quedan hasta la pared (cage − |pos|).
 * @property {(f:Fighter)=>boolean} backToWall                           ¿le da la espalda a la pared (está retrocediendo hacia ella)?
 * @property {(f:Fighter,thresholdPx:number)=>boolean} cornered          backToWall y a ≤ thresholdPx de la pared.
 * @property {(f:Fighter,d:number,marginPx:number)=>boolean} exceedsWall ¿moverse d px por el facing lo deja a < marginPx de la pared (o fuera)?
 *
 * --- Separación y transiciones de fase ---
 * @property {(A:Fighter,B:Fighter,minGap:number)=>void} separate        De pie: si están a < minGap los separa (la pared tiene prioridad).
 * @property {(f:Fighter)=>any} save                                     Foto opaca de la posición (para golpes con pie plantado).
 * @property {(f:Fighter,snap:any)=>void} restore                        Restaura la foto.
 * @property {(A:Fighter,B:Fighter,minGap:number,lockA:boolean,lockB:boolean,snapA:any,snapB:any)=>void} separateLocked
 *           Separación tras restaurar a los que tienen el pie plantado (el otro absorbe el empuje).
 * @property {(top:Fighter,bottom:Fighter,margin:number)=>void} gather   Al caer al suelo: ambos al punto medio (a ≥ margin de la pared).
 * @property {(A:Fighter,B:Fighter,sepPx:number)=>void} standUp          Al levantarse/romper: centrados en el punto medio, separados sepPx.
 * @property {(A:Fighter,B:Fighter,halfGap:number)=>void} clinchPlace    Al entrar al clinch: cada uno a halfGap px del punto medio, de frente.
 *
 * --- Huesos / cajas de daño (SÓLO LECTURA; presentación) ---
 * @property {(f:Fighter,bone:string)=>Vec3} boneWorldPos                Posición de mundo de un hueso de HUMAN_BONES (los 16 joints KAGE + chest). 2D: px, z = 0; 3D: bloques.
 * @property {(f:Fighter)=>Capsule[]} hurtboxes                          Cápsulas de daño entre huesos (zonas head/body/legs/armL/armR).
 * @property {(attacker:Fighter,defender:Fighter,move:object)=>(Vec3|null)} contactPoint  Punto de contacto aproximado de un golpe (null en 2D).
 */

/**
 * Crea una geometría. spec: '2d' | '3d' | instancia Geometry | (opt)=>Geometry | { kind:'3d', skeleton, boneMap, origin }.
 * Un spec ausente = Geometry2D (comportamiento KAGE).
 * @param {string|object|Function|undefined} spec
 * @param {{cage:number}} opt  tuning de la pelea (usa cage)
 * @returns {Geometry}
 */
export function createGeometry(spec, opt) {
  if (spec == null || spec === '2d') return createGeometry2D(opt);
  if (spec === '3d') return createGeometry3D(opt);
  if (typeof spec === 'function') return spec(opt);
  if (typeof spec === 'object' && spec.kind === '3d' && typeof spec.bind !== 'function') return createGeometry3D(opt, spec);
  if (typeof spec === 'object' && typeof spec.bind === 'function') return spec;
  throw new Error('createGeometry: spec inválido');
}

export { createGeometry2D, createGeometry3D };
