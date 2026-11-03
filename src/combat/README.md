# src/combat — núcleo de combate KAGE + geometría 2D/3D (ORIGEN)

Dueño: Combate. Núcleo KAGE (`f40b47d`, congelado) sin tocar; sólo ve el espacio por `F.geo`.

## Layout
```
core/            núcleo KAGE (ex src/fight): core, resolve, ai, controllers, fighter, events, metrics, tuning, rng(sfc32) + tests + sim.mjs
data/            moves.js, styles.js (ex src/data)
kage-contracts.js  subconjunto verbatim de los contratos de KAGE que usa el núcleo (NO es src/shared/contracts.js de Motor)
geometry.js      contrato JSDoc de Geometry + createGeometry(opt)
geometry2d.js    Geometry2D: idéntica a KAGE f40b47d (bit a bit), px
geometry3d.js    Geometry3D: plano XZ + yaw, ring circular, cápsulas; salida en metros ([x,y,z]); point de eventos en bloques
pose.js          pose procedural, HUMAN_PARENT, KAGE_TO_HUMAN, ZONE_OF (HUMAN_BONES del contrato)
events.js        traductor KAGE FIGHT_EVENTS -> CombatEvent del contrato
index.js         API pública del módulo
digest.js, golden/parity56.json, scripts/{parity-full,make-golden,dist-3d-vs-2d}.mjs, support/ (sólo tests)
```

## Elegir geometría (`opts.geometry` en `createFight/simulateFight`)
| valor                                   | resultado                                                    |
|-----------------------------------------|--------------------------------------------------------------|
| ausente / `'2d'`                        | Geometry2D = KAGE f40b47d, bit a bit                         |
| `'3d'`                                  | Geometry3D con pose procedural por defecto                   |
| `{ kind:'3d', skeleton, boneMap, blockM }` | Geometry3D con provider `skeleton(fighter, F) -> Skeleton3D` |
| instancia / `(opt)=>Geometry`           | geometría propia                                             |

## Seed de mundo (misma partida + mismo lugar = misma pelea)
```js
import { fightSeed, createFight, simulateFight, replayFight } from './combat/index.js';
fightSeed(worldSeed, x, y, z [, salt])      // -> u32; lugar en bloques (Math.floor por coordenada)
fightSeed(worldSeed, encounterId [, salt])  // -> u32; id estable de encuentro (string|number)
simulateFight(a, b, { worldSeed, x, y, z, salt? }, opts)   // ó { worldSeed, encounterId, salt? }
simulateFight(a, b, 1234, opts)                            // seed numérico crudo = KAGE bit a bit (paridad)
```
`fightSeed` = `hash3(worldSeed ^ 'FIGT' ^ salt*φ, x, y, z)` de `src/shared/rng.js` (sin estado, orden-independiente) pasado a u32; ese u32 siembra el sfc32 de KAGE (`core/rng.js`). `createFight/simulateFight/replayFight` de `index.js` (en `seeded.js`) envuelven el núcleo sin modificarlo; el resultado/pelea lleva `worldSeed` y `location`|`encounterId`. Con geometría 3D y lugar (x,y,z), el ring se centra en ese punto del mundo (`origin`, sólo en las salidas) salvo que `geometry.origin` ya venga dado.

## Unidades y ejes (Geometry3D, contracts v0.3)
- La sim sigue en px KAGE (85 px/m). Skeleton3D, raíz, huesos y cápsulas salen en **metros** `[x,y,z]` (y arriba); el mundo y `CombatEvent.point` van en **bloques** (`BLOCK_M` de contracts = 0.5 m). `geo.toBlocks / fromBlocks` es la única conversión.
- `spec.origin` ([x,y,z] bloques) ubica el centro del ring; la sim no lo ve.
- **La sim es dueña de la raíz y del heading**; la animación nunca realimenta movimiento (un esqueleto en espacio mundo del provider se re-ancla a la raíz de la sim).
- `yaw` = `-heading` interno; `headingDir(yaw)` de contracts = `(cos yaw, 0, -sin yaw)` = `rotation.y` de Three (test contra `THREE.Vector3.applyAxisAngle`).
- `tickExtras` por tick 3D: `{ pos:[x,y,z] metros (= root.pos), yaw }` (`tick.x/facing` siguen en px/±1 como en 2D).
- `skeletonOf(f)` → `Skeleton3D`: `{bones, parent, root:{pos,yaw}, visualYaw (= yaw), pose:{hueso:[x,y,z]}}`.
- `boneWorldPos(f, hueso)` → `[x,y,z]` m (2D: `[x,y,0]` px). `hurtboxes(f)` → 16 cápsulas `{a,b,radius,zone,bones}` (m). `contactPoint` → `[x,y,z]` m | null.
- Los hurtboxes/puntos son presentación; la sim sigue resolviendo por rangos pelvis–pelvis. Jamás alimentan estado (test: el provider no se invoca durante la sim).

## HUMAN_BONES ↔ joints KAGE
Los 16 joints KAGE coinciden por nombre con 16 de los 17 `HUMAN_BONES` (`KAGE_TO_HUMAN` identidad; `KAGE_UNMAPPED = []`).
`chest` existe sólo en el contrato (`HUMAN_ONLY = ['chest']`): se deriva como punto medio spine–neck. Hombros cuelgan de `chest`, neck de `chest`.

## Eventos
`createCombatTranslator({ids}) → {translate(ev, F) → CombatEvent[], translateAll}`. Llamarlo justo después de cada `stepFight` con `F = fight.core` (el `point` de hit/block sale de la pose actual). Los 22 tipos de `COMBAT_EVENT` tienen origen; **ningún tipo KAGE se descarta** (`UNMAPPED = []`). Mapeo en `events.js` (`KAGE_TO_COMBAT`): strike/action/feint→actionStart, hit→hit(+injury), block/parry/check/catch→block, dodge, whiff→miss, knockdown/takedown→knockdown, getUp, submission/subAttempt/tap→submission, ko, y clinch, break(result=reason), sprawl, rocked, position(attacker=arriba,target=abajo,action=pos), sweep, subEscape, stoppage(result=reason), roundStart, roundEnd, decision(attacker=ganador,result=UD|SD|MD|DRAW), fightEnd(attacker=ganador,result=método). Campos del contrato: `src`, `result`, `point` (3D, bloques). `round` (1-based, contrato v0.4) va poblado en TODOS los eventos traducidos.

## RNG
`core/rng.js` = sfc32 de KAGE, sembrado, sin Math.random. El mulberry32 de `src/shared/rng.js` NO reemplaza al sfc32 (rompería la paridad bit a bit); de `shared/rng.js` sólo se usa `hash3`/`hashSeed` para derivar la seed (`seed.js`).

## Verificación
`npm test` (incluye `src/combat/**/*.test.js`): parity 56 seeds vs golden (y vs referencia viva si existe `/tmp/origen-combat-ref`), geometry3d, events, seed, purity (sin Math.random / Date.now en la sim), tests del núcleo KAGE.
Manual: `node src/combat/scripts/parity-full.mjs` (1008 peleas vs referencia), `node src/combat/scripts/dist-3d-vs-2d.mjs` (200 peleas 3D vs 2D).
`support/` son archivos de KAGE sólo para tests de `core/sim.test.js`.


## Pelea en vivo (`live.js`, `liveAnim.js`, `spot.js`) — para main.js

`createLiveFight({a,b,seed|{worldSeed,x,y,z},origin,styles,ground,ids,fightOpts})` envuelve el núcleo con un **acumulador de paso fijo a 60 Hz**: `update(dt)` avanza ticks enteros, así que *misma seed ⇒ misma pelea sea cual sea el patrón de dt* (test: 30/60/144 fps, dt irregular con 0 y picos ⇒ digest idéntico a `simulateFight`). El resto de `dt` queda en `frame.alpha` y pos/yaw se interpolan entre el tick anterior y el actual. `a`/`b` = FighterSpec (por defecto dos boxeadores de prueba); `seed` numérico crudo sigue siendo el camino KAGE bit a bit.

`update(dt, input?)` devuelve (y reutiliza) `frame`: `{tick,time,alpha,steps,round,phase,over,done,result, events:CombatEvent[] (este frame, con round y point en bloques), rawEvents, fighters:{a,b}, list:[a,b]}`; cada peleador `{id,side,pos:[x,y,z] METROS,yaw,state}` con `state` = `{move,clip,animSeq,display,stance(stand|clinch|groundTop|groundBottom|down|ko|victory),phase(windup|active|recovery|null),progress,phaseProgress,moveSeconds,windupSeconds,kind,limb,guard,onGround,position,groundPos,hurt{zone,age},rocked,down,ko,victory,hp,stamina,fatigue,damage,sub,subProgress,loco{mode,speed}}`. Además `on(type|'*', fn)→off`, `restart(seed)`, `step(n)`, `over/done/result/tick/origin/seed/fight`.

`ground` (opcional) = `world.solidAt`-like en BLOQUES (nunca `getBlock` crudo: el agua es truthy). Con `ground`, `pos[1]` sigue el terreno (sólo presentación; la sim es plana ⇒ no cambia el digest). `findFightSpot(world, x, z, radius, {search,step,maxSpread})→{origin:[x,y,z] bloques, spread, ok}` es determinista (espiral fija, sin azar), elige un disco llano (`spread`=desnivel) y descarta agua si recibe un objeto con `getBlock`. Para sacar el origen del mundo: `origin: findFightSpot(world, x, z, 6).origin`.

`createLiveAnimation(live, {createAnimator3D, getBlock, blockM, seed})` (fábrica inyectada: `combat` no importa `src/anim`) crea un animador por lado, les pasa `{pos,yaw}` de la sim y dispara `play('jab')` desde `actionStart` con adelanto para que el impacto del clip (0.152 s) coincida con el fin del windup KAGE. `la.update(dt)→{frame,skeletons}`, `la.anims.{a,b}`. Mapeo `CLIP_MAP` (hoy: todo `strike`→`jab`, aproximado). Huecos para Animador: `ANIM_GAPS` (otros golpes/patadas/rodillas/codos, reacciones por zona, block/dodge, rocked/knockdown/KO/getUp/victoria, clinch/derribo/suelo, `play(name,{speed})`/`playAt`, guardia según `state.guard`).

### Integración en main.js (reemplaza el guion de prueba; ~12 líneas)

```js
import { createLiveFight, createLiveAnimation } from './combat/index.js';   // + quitar simStep y su createAnimator3D por humano
const live = createLiveFight({ seed: SEED, origin: [0, 0, 0], ground: floor.getBlock });
// con el mundo: ground: world.solidAt, origin: findFightSpot(world, 0, 0, 6).origin  (y getBlock del animador = world.solidAt)
const la = createLiveAnimation(live, { createAnimator3D, getBlock: floor.getBlock, blockM: BLOCK_M, seed: SEED });
const fighters = [[0xd8d2c4, 'a'], [0x9a3b34, 'b']].map(([color, side]) => {
  const view = createHumanView(color); scene.add(view.group);
  return { root: live.frame.fighters[side], color, anim: la.anims[side], view };   // render sigue usando f.anim.skeleton
});
// en loop.update(dt) (reemplaza simStep + f.anim.update):
const { frame } = la.update(dt);
fighters.forEach((f, i) => { f.root = frame.list[i]; });   // mid/cámara leen f.root.pos como hasta ahora
// opcional: live.on('hit', (e) => sfx/partículas en e.point); live.restart(SEED + 1) al terminar (live.done)
```
