// ORIGEN — contratos compartidos v0.2 (dueño: Motor). Cambios se anuncian en la sala.
// UNIDADES Y EJES: metros, mano derecha, +Y arriba. 1 bloque = 1 m (BLOCK_M).
// Frente local de todo esqueleto/criatura = +X. heading (yaw) en radianes alrededor de +Y;
// heading 0 mira a +X; dirección mundo = (cos h, 0, -sin h) (rotación estándar de Three alrededor de +Y).
// Sim a 60 Hz fijo (TICK_HZ).
// RAÍZ: la simulación (combat/mind) es dueña de root.pos y root.heading. Anim lee la raíz, puede
// SUAVIZAR el heading solo para la pose visual, y NUNCA devuelve root motion a la sim.
export const TICK_HZ = 60;
export const BLOCK_M = 1;
export const CONTRACTS_VERSION = '0.2';
export const headingDir = (h) => [Math.cos(h), 0, -Math.sin(h)];
export const CHUNK = Object.freeze({ SX: 16, SY: 64, SZ: 16 });

// IDs de bloque (u8). 0 = aire. Mundo puede agregar al final, nunca renumerar.
export const BLOCK = Object.freeze({ AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5, WATER: 6, SAND: 7, ORE: 8 });

/**
 * World (lo implementa Mundo en src/world/).
 * @typedef {Object} World
 * @property {number} seed
 * @property {(x:number,y:number,z:number)=>number} getBlock   coords mundo enteras; fuera de rango => AIR
 * @property {(x:number,y:number,z:number,id:number)=>boolean} setBlock  true si cambió; marca chunk sucio
 * @property {(cx:number,cz:number)=>Chunk} chunk   genera o devuelve el chunk
 * @property {()=>Iterable<Chunk>} chunks
 * @property {(origin:[number,number,number],dir:[number,number,number],maxDist:number)=>RaycastHit|null} raycast
 */
/** @typedef {{cx:number,cz:number,blocks:Uint8Array,dirty:boolean}} Chunk  index = x + SX*(z + SZ*y); bloque (x,y,z) ocupa [x,x+1)×[y,y+1)×[z,z+1) m */
/** @typedef {{pos:[number,number,number],normal:[number,number,number],block:number,dist:number}} RaycastHit */
export const chunkIndex = (x, y, z) => x + CHUNK.SX * (z + CHUNK.SZ * y);

// Skeleton3D (lo implementa Animador en src/anim/). Huesos humanos canónicos:
export const HUMAN_BONES = Object.freeze([
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
  'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR',
]);
/**
 * @typedef {Object} Skeleton3D
 * @property {string[]} bones                      nombres (HUMAN_BONES para humanos; fauna define los suyos)
 * @property {Object<string,string|null>} parent    hueso -> padre
 * @property {{pos:[number,number,number],heading:number}} root   SOLO LECTURA para anim: lo escribe la sim. pos = pelvis proyectada al suelo (m)
 * @property {number} visualHeading                 heading suavizado por anim (solo render; la sim no lo lee)
 * @property {Object<string,[number,number,number]>} pose     posiciones MUNDO en metros de cada joint (Combate: hitboxes; Arte: dibujo)
 */

// CombatEvent (lo emite Combate en src/combat/). Mismo espíritu que FIGHT_EVENTS de KAGE.
export const COMBAT_EVENT = Object.freeze({
  ACTION_START: 'actionStart', HIT: 'hit', BLOCK: 'block', DODGE: 'dodge', MISS: 'miss',
  KNOCKDOWN: 'knockdown', GETUP: 'getUp', SUBMISSION: 'submission', INJURY: 'injury', KO: 'ko',
});
/** @typedef {{type:string,tick:number,attacker?:number,target?:number,action?:string,zone?:string,damage?:number,point?:[number,number,number]}} CombatEvent */

/**
 * Creature (lo compone Motor; mind/combat de Combate, skeleton de Animador).
 * @typedef {Object} Creature
 * @property {number} id
 * @property {string} kind                 'human' | especie
 * @property {Skeleton3D} skeleton
 * @property {Object<string,number>} stats fuerza, velocidad, tecnica, resistencia, aguante, cardio, lucha
 * @property {Object<string,number>} needs comida, energia, animo
 * @property {Object} mind                 estado de Combate/mind (opaco para Motor)
 * @property {(dt:number,ctx:Object)=>void} update
 */
