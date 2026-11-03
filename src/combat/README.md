# src/combat — núcleo de combate KAGE + geometría 2D/3D (ORIGEN)

Dueño: Combate. Núcleo KAGE (`f40b47d`, congelado) sin tocar; sólo ve el espacio por `F.geo`.

## Layout
```
core/            núcleo KAGE (ex src/fight): core, resolve, ai, controllers, fighter, events, metrics, tuning, rng(sfc32) + tests + sim.mjs
data/            moves.js, styles.js (ex src/data)
kage-contracts.js  subconjunto verbatim de los contratos de KAGE que usa el núcleo (NO es src/shared/contracts.js de Motor)
geometry.js      contrato JSDoc de Geometry + createGeometry(opt)
geometry2d.js    Geometry2D: idéntica a KAGE f40b47d (bit a bit), px
geometry3d.js    Geometry3D: plano XZ + yaw, ring circular, cápsulas; salida en bloques ([x,y,z])
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

## Unidades y ejes (Geometry3D)
- La sim sigue en px KAGE (85 px/m). Salidas 3D en **bloques**: `BLOCK_M = 0.5` m (de `contracts` si algún día lo exporta; si no, local). Un único factor: `PXB = 85 * BLOCK_M`.
- y arriba; esqueleto local: metros, +x adelante, y arriba, z derecha. **La sim es dueña de la raíz y del heading**; la animación nunca realimenta movimiento (un esqueleto en espacio mundo del provider se re-ancla a la raíz de la sim).
- `yaw` = `rotation.y` de Three: el +x local apunta a `(cos yaw, 0, -sin yaw)`. `yawFromHeading(h) = -h` (el heading interno es antihorario en XZ). Test contra `THREE.Vector3.applyAxisAngle`.
- `tickExtras` por tick 3D: `{ pos:[x,y,z] bloques, yaw }` (`tick.x/facing` siguen en px/±1, como en 2D).
- `skeletonOf(f)` → `Skeleton3D` del contrato: `{bones:HUMAN_BONES, parent, root:{pos,yaw}, pose:{hueso:[x,y,z]}}`.
- `boneWorldPos(f, hueso)` → `[x,y,z]` (2D: `[x,y,0]` px). `hurtboxes(f)` → 16 cápsulas `{a,b,radius,zone,bones}` (bloques). `contactPoint` → `[x,y,z]|null`.
- Los hurtboxes/puntos son presentación; la sim sigue resolviendo por rangos pelvis–pelvis. Jamás alimentan estado (test: el provider no se invoca durante la sim).

## HUMAN_BONES ↔ joints KAGE
Los 16 joints KAGE coinciden por nombre con 16 de los 17 `HUMAN_BONES` (`KAGE_TO_HUMAN` identidad; `KAGE_UNMAPPED = []`).
`chest` existe sólo en el contrato (`HUMAN_ONLY = ['chest']`): se deriva como punto medio spine–neck. Hombros cuelgan de `chest`, neck de `chest`.

## Eventos
`createCombatTranslator({ids}) → {translate(ev, F) → CombatEvent[], translateAll}`. Llamarlo justo después de cada `stepFight` con `F = fight.core` (el `point` de hit/block sale de la pose actual). Mapeo en `events.js` (`KAGE_TO_COMBAT`, `UNMAPPED`); campos extra: `src` (tipo KAGE), `result` (submission), `point` (3D, bloques).

## RNG
`core/rng.js` = sfc32 de KAGE, sembrado, sin Math.random. `src/shared/rng.js` (mulberry32) NO se usa: cambiarlo rompe la paridad bit a bit con KAGE.

## Verificación
`npm test` (incluye `src/combat/**/*.test.js`): parity 56 seeds vs golden (y vs referencia viva si existe `/tmp/origen-combat-ref`), geometry3d, events, purity (sin Math.random / Date.now en la sim), tests del núcleo KAGE.
Manual: `node src/combat/scripts/parity-full.mjs` (1008 peleas vs referencia), `node src/combat/scripts/dist-3d-vs-2d.mjs` (200 peleas 3D vs 2D).
`support/` son archivos de KAGE sólo para tests de `core/sim.test.js`.
