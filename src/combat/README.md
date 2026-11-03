# src/combat — adaptador de geometría del núcleo KAGE (para ORIGEN)

El núcleo de combate (`src/fight/*`, `src/data/*`) ya no toca `f.x` / `f.facing` / `cage`: todo pasa por `F.geo`
(contrato JSDoc en `geometry.js`). Se elige con `opts.geometry` en `createFight/simulateFight`:

| `opts.geometry`                                 | resultado                                                       |
|-------------------------------------------------|-----------------------------------------------------------------|
| ausente / `'2d'`                                | Geometry2D: idéntica a KAGE `f40b47d` (bit a bit)               |
| `'3d'`                                          | Geometry3D con esqueleto y pose procedural por defecto          |
| `{ kind:'3d', skeleton, boneMap, pxPerUnit }`   | Geometry3D con provider `skeleton(fighter, F) -> Skeleton3D`    |
| instancia / `(opt)=>Geometry`                   | geometría propia                                                |

Sitios del núcleo que leían geometría 2D (todos migrados): `resolve.dist/cornered/armKey`; `core`: colocación inicial y de
round, `startGround` (gather), `standUp`, `startClinch`, lunge/step-back del startup, `moveFighters` (caminar, pivot, circle,
rebote en reja, slide de knockback, clamp, separación mínima y con pie plantado, orientación), `nearCage` en la salida del pocket,
campos `x/facing` del tick; `ai.decideStand`: `wallGap/backToWall/oppNearCage`; `fighter.createRuntime` ya no crea `x/facing`.
`metrics.js` es post-proceso de ticks (lee `tick.x`/`facing`, que siguen existiendo); no es parte del núcleo de sim.

Regla de determinismo: la sim sólo depende de raíz (posición + heading). `boneWorldPos/hurtboxes/contactPoint` son lectura
(render/VFX); jamás alimentan eventos ni estado de la sim (test: el provider de esqueleto no se llama durante la sim).

Verificación: `node --test` (parity.test.js 56 seeds vs golden y vs referencia, geometry3d.test.js, purity.test.js),
`npm run test:parity-full` (1008 peleas vs `/tmp/origen-combat-ref`), `npm run test:dist3d` (200 peleas 3D vs 2D).
`src/engine/{fightdriver,fallbacks,rng}.js` son archivos de KAGE SÓLO para que corran 2 tests de `sim.test.js`; no llevarlos a ORIGEN.
