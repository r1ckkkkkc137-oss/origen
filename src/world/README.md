# src/world — Mundo voxel de ORIGEN (dueño: Mundo)

JS puro en módulos ES. Three.js solo aparece en `threeAdapter.js`, y como parámetro (`THREE`), nunca importado. Sin `Math.random`: usa `src/shared/rng.js` (`createRng`, `hashSeed`, `hash3`). Test de guardia: `test/world-no-math-random.test.js` (más el `nomathrandom.test.js` del repo).

Cumple `src/shared/contracts.js` v0.2b: `CHUNK` 16×64×16, índice `x + 16·z + 256·y`, ids de `BLOCK`, +Y arriba, 1 bloque = `BLOCK_M` = 0,5 m.

## Archivos

| archivo | qué hace |
|---|---|
| `units.js` | `BLOCK_SIZE_M` (leído de `contracts.BLOCK_M`, por defecto 1 si el contrato no lo trae), `toBlocks`, `toMeters` |
| `seed.js` | `normalizeSeed(number\|string)` → uint32 (usa `hashSeed` compartido) |
| `noise.js` | Perlin 2D/3D con permutación sembrada por `createRng` (+ fbm, ridged). Periodo 256 celdas |
| `blocks.js` | tabla de bloques (`B`, `BLOCKS`, flags sólido/opaco/líquido, capa de render, drop, dureza) |
| `chunk.js` | `Chunk {cx,cz,blocks,dirty,version}`, `CHUNK_X/Y/Z`, `SEA_LEVEL = 20`, `hashBlocks` |
| `generator.js` | `generateChunk(seed,cx,cz)` **pura** (mismo resultado en cualquier orden), biomas, cuevas, menas, árboles |
| `world.js` | clase `World` (interfaz del contrato + dig/place, diff, carga por radio, mallas) |
| `mesher.js` | greedy meshing, 3 capas, tile por cara, uvs repetibles |
| `tilemap.js` | **único** mapa `blockId + cara → tile` del atlas |
| `physics.js` | AABB barrido por eje, escalones, agua, raycast DDA, **jugador** (`createPlayerBody` / `stepPlayer`) |
| `threeAdapter.js` | `createWorldView` (carga por radio + mallado con presupuesto + atlas de Arte), `createGeometry`, `createVoxelMaterial`, `buildTileMap` + shaders base (con niebla/sRGB/tonemap de THREE). Solo probado en SwiftShader |
| `entities.js` | entidades transitorias en METROS con paso fijo 1/120: `FallingTree` (péndulo invertido) e `ItemDrop`s (gravedad + colisión de `physics.js`), `pickupItems` |
| `entityView.js` | vista Three de las entidades: `createEntityView(THREE, scene, world, atlas, {tileNames})`; un `Group` por árbol (mallado una vez, luego solo cuaternión) y UNA malla dinámica para todos los items |
| `bench.mjs` | benchmark real (`node src/world/bench.mjs`) |
| `index.js` | reexporta todo; `createWorld(seed)` |

## Unidades (una sola regla)

Contrato v0.2b: «MUNDO (World, chunks, raycast) en BLOQUES; SIM en METROS». `BLOCK_SIZE_M` (0,5 hoy) es la única constante y vive en `units.js`. Dentro del módulo todo es entero de bloque; se convierte solo en el borde:

* **Bloques** (contrato): `getBlock/setBlock/dig/place`, `chunk(cx,cz)`, `Chunk.blocks`, **`World.raycast(origin,dir,maxDist)`** (origin y maxDist en bloques, `hit.dist` en bloques).
* **Metros** (sim/render): `moveAndCollide` (cuerpos en m, m/s, m/s²), `World.raycastM` / `physics.raycastMeters` (`hit.dist` en m; `pos/normal/place` siguen siendo enteros de bloque), `World.ensureChunks(pxM, pzM, radio)`, AABBs en metros de `place(..., solids)`, y las posiciones de vértices del mesher (por defecto metros).
* `meshChunk(chunk, nb, { units:'blocks' })` deja los vértices en bloques por si el adaptador 3D prefiere escalar el mesh con `BLOCK_SIZE_M` (el contrato dice que la conversión vive en `combat/geometry.js`). `mesh.units` informa cuál se usó. Las uvs **siempre** están en bloques.

**Pregunta abierta para Motor**: ¿el mesh de render sale en metros (default actual, sin escalar en Three) o en bloques (y el adaptador escala por `BLOCK_M`)? Ambos funcionan; hoy el default es metros.

## API pública

```js
import { createWorld, meshChunk, moveAndCollide, createBody, BLOCK_SIZE_M } from './world/index.js';
const world = createWorld(1234);                 // seed: number | string → uint32 (world.seed)
```

`World` (interfaz del contrato):

* `seed`, `getBlock(x,y,z)` (fuera de rango o y∉[0,64) ⇒ `AIR`), `setBlock(x,y,z,id)` → `true` **solo si cambió** y marca `chunk.dirty` (y la de los vecinos cargados si es borde), `chunk(cx,cz)` (genera o devuelve), `chunks()` (iterable de chunks cargados), `raycast(origin,dir,maxDist)` → `{pos,normal,block,dist,place}|null`. `place` (celda previa, donde se colocaría un bloque) es un extra aditivo; opts `{hitLiquid:true}` para golpear agua (por defecto atraviesa agua y aire).

Extras de juego: `dig(x,y,z)` → `{broken, drop}|null`; `canPlace/place(x,y,z,id,solids?)` (solo contra un sólido adyacente, sobre aire/agua, sin encerrar entidades); `surfaceY(x,z)`; `ensureChunks(pxM,pzM,radio,{maxNew,unloadMargin})` → `{added,removed,pending}`; `consumeDirty()` → `[{cx,cz}]` (chunks a re-mallar; limpia la marca); `peekChunk/unloadChunk`; `meshChunk(cx,cz,opts)`; `serialize()` / `World.deserialize(json)` / `loadEdits` (solo ediciones reales, por chunk).

Física: `createBody(x,y,z,{halfW:.3,height:1.8})` (metros); `moveAndCollide(world, body, dt, {gravity:-9.81, terminalVelocity:-50, stepHeight:0, waterGravityScale:.15, waterDrag:3})` — las velocidades horizontales las pone la sim; `collides(world, body)`. El suelo bajo y<0 cuenta como sólido. Todos los defaults en m, m/s, m/s².

## Formato de malla (para Arte / Motor)

`meshChunk(chunk, {px,nx,pz,nz}, opts)` → `{cx,cz,origin,units,opaque,cutout,water,triangles}`. Cada capa: `positions` (Float32 xyz), `normals`, `uvs` (st), `tiles` (Uint8, 1 por vértice), `indices` (Uint16 o Uint32 si >65535 vértices), `vertexCount`, `triangleCount`. Posicionar el mesh en `origin`.

* **Capas**: `opaque` (todo lo sólido), `cutout` (hojas; `alphaTest` 0,5, sin blending), `water` (blending, sin depthWrite). Desvío respecto al pedido original (una sola capa «transparente»): son tres porque hojas y agua se renderizan distinto.
* **Caras ocultas**: se descartan entre opacos, también contra chunks vecinos (vecino `null` ⇒ opaco). Entre dos transparentes distintos dentro del chunk se emite solo una cara (la del índice menor); en el borde del chunk cada chunk emite la suya.
* **Caras / tiles**: orden `0:+x 1:-x 2:top 3:bottom 4:+z 5:-z`. `tilemap.js` → `BLOCK_TILES` mapea `blockId → nombre` o `{top, side, bottom}`; `TILE_OF[id*6+cara]` es la tabla plana. Para ajustar un bloque se edita **solo** `BLOCK_TILES`.
* **uv repetible**: con greedy un quad de w×h bloques lleva uv `0..w × 0..h` (unidades de bloque) y el atributo `tile` fija el tile. El shader hace `fract(vUv)` para repetir el tile (no estirarlo) y arma la uv del atlas. Fragmento (de `threeAdapter.js`; compilado y ejecutado solo en SwiftShader, no en GPU real):

```glsl
float t = floor(vTile + 0.5); float row = floor(t / uGrid.x); float col = t - row * uGrid.x;
vec2 f = fract(vUv);                                      // repite el tile
vec2 tuv = vec2((col + f.x) / uGrid.x, 1.0 - (row + 1.0 - f.y) / uGrid.y);   // atlas: fila 0 arriba
```

  `t` crece hacia +Y en caras laterales. Ojo: `fract(x)` vale 0 en los enteros, así que el borde derecho/superior de un quad exacto caería en el tile vecino; el shader acota la uv al interior del tile (medio texel) para evitar sangrado.
* **Atlas** (Arte, `src/render/atlas.js`, 16 px, 4 columnas): los 8 primeros `TILE_NAMES` coinciden con el `TILES` de Arte (test lo comprueba si existe `/tmp/origen-art`). **Arte debe agregar al final, en este orden**: `sand, snow, gravel, coal_ore, iron_ore, water` (índices 8..13) y después, para las especies, `pine_log_side, pine_log_top, pine_leaves, birch_log_side, birch_log_top, birch_leaves` (índices 14..19), o se cambia el orden aquí. Mientras el atlas de Arte tenga solo 8 tiles, `buildTileMap` usa sustitutos (`TILE_FALLBACK`: sand→dirt, water→dirt, snow/gravel/coal_ore/iron_ore→stone; pine_log_side/birch_log_side→log_side, pine_log_top/birch_log_top→log_top, pine_leaves/birch_leaves→leaves; `view.missingTiles` los lista) y las filas del atlas salen de `canvas.height/16`, así que al agregar tiles al final **no hay que tocar nada aquí**. El agua usa `uOpacity=0.7` en el shader (alpha del material), no del tile.

## Diff aditivo propuesto a `src/shared/contracts.js` (Motor decide)

```diff
-export const BLOCK = Object.freeze({ AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5, WATER: 6, SAND: 7, ORE: 8 });
+export const BLOCK = Object.freeze({ AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5, WATER: 6, SAND: 7, ORE: 8,
+  IRON: 9, GRAVEL: 10, SNOW: 11, PLANKS: 12 });
```

El módulo ya usa estos valores como respaldo (`BLOCK.IRON ?? 9`, …) y los toma del contrato apenas existan. Alias internos: `LOG = BLOCK.WOOD`, `COAL = BLOCK.ORE` (el `ORE` genérico es carbón). Nada se renumera.

Notas para la interfaz `World` (aclaraciones, no cambios): `raycast` devuelve además `place:[bx,by,bz]`; `setBlock` marca `dirty` también en el chunk vecino cargado si el bloque está en el borde; `chunk.dirty` lo limpia quien re-malla (`World.consumeDirty()` lo hace por ti).

## Integración con el motor (atlas conectado)
`src/main.js` (único archivo de Motor que se tocó, mínimo): `applyLook` (Arte) + `createAtlas(SEED)` + `createWorld(seed)` + `createWorldView(THREE, scene, world, atlas, { tileNames: TILES, radius })`; cada frame `view.update(camera.x, camera.z)` (metros). Se quitó el `GridHelper` y la luz/niebla provisorias. `?r=<chunks>` fija el radio (por defecto 4,5; **desde el fix de `ensureChunks` carga 69 chunks de coordenadas enteras**: antes cargaba 60 en coordenadas x.5, es decir, geometría duplicada/desplazada — las cifras de rendimiento de más abajo con «60 chunks» son anteriores al fix), `?wseed=` la semilla del mundo. `window.__ORIGEN__` expone `world, view, look, renderer`.

## Jugador (`createPlayerBody` + `stepPlayer`, para Motor)

Todo en METROS y segundos, sobre `moveAndCollide` (barrido por eje sin tunneling, `solidAt` vía `getBlock`; el agua no es sólida). Determinista: sin azar ni reloj, la misma secuencia `(input, dt)` sobre el mismo mundo da la misma trayectoria bit a bit (test). `dt` se parte en subpasos de ≤ 1/120 s (y se limita a 0,25 s), así 1/30, 1/60 y 1/144 dan la misma trayectoria (±3 cm, test).

* `createPlayerBody({ w=0.6, h=1.8, eye=1.62, x, y, z })` → cuerpo (`x,y,z` = pies; `vx,vy,vz`, `onGround`, `inWater`). `playerEye(body)` → `[x,y+eye,z]` para la cámara.
* `stepPlayer(world, body, { moveX, moveZ, jump, yaw, sprint? }, dt)`: `moveX` + derecha, `moveZ` + adelante (−1..1, la diagonal se normaliza), `yaw` en rad (0 mira a −Z como la cámara de Three, + gira a la izquierda), `jump` se puede mantener (salta al tocar suelo).
* Valores (`PLAYER_DEFAULTS`, sobreescribibles como 5.º argumento): camina 4 m/s (×1,5 con `sprint`), aceleración 50 m/s² en suelo / 12 en aire, salto de 0,6 m (= 1,2 bloques, ~0,7 s en el aire: salta 1 bloque, no 2), gravedad −9,81 m/s².
* **Escalón**: al caminar contra un bloque de 1 bloque (0,5 m) sube solo, sin saltar; contra 2 bloques no sube (ni con salto).
* **Agua**: cae lento (gravedad ×0,15 + arrastre), velocidad horizontal ×0,6; con `jump` mantenido nada hacia arriba (2,5 m/s) y sale a un borde de 1 bloque.
* **Desatasco**: si se coloca un bloque dentro del cuerpo, lo sube (pasos de 5 cm, máx. 1 m) hasta que no choque.

Conexión en `main.js` (Motor; yo no lo toco):

```js
import { createPlayerBody, stepPlayer, playerEye } from './world/index.js';
const player = createPlayerBody({ x: spawn.x, y: spawn.y, z: spawn.z });        // metros; pies
const keys = { moveX: 0, moveZ: 0, jump: false, sprint: false };               // teclado -> moveX (D−A), moveZ (W−S), jump (Space)
// cada frame, con dt en segundos (no hace falta ancho fijo):
const input = { moveX: keys.moveX, moveZ: keys.moveZ, jump: keys.jump, sprint: keys.sprint, yaw: cameraYaw };
stepPlayer(world, player, input, dt);
const [ex, ey, ez] = playerEye(player);
camera.position.set(ex, ey, ez);                                                // la cámara se orienta con yaw/pitch aparte
```

Costo medido (`node src/world/bench.mjs`, dt=1/60 = 2 subpasos, mundo real, caminando+saltando+sprint): 2 corridas: media 1,9 y 2,3 µs/step, mediana 1,8 y 1,7, p95 3,0 y 5,3 (máquina compartida, ruido alto); 16,7 ms de frame = ~0,01 %.

## Para Animador (`createAnimator3D({ seed, getBlock, blockM })`)
`getBlock` de Animador es un predicado «sólido» en celdas enteras: usar **`(x,y,z) => world.solidAt(x,y,z)`** con `blockM: BLOCK_M`. No pasar `world.getBlock` crudo: devuelve el id (el agua, id 6, es truthy y contaría como suelo). `solidAt`/`getBlock` hacen una sola indexación con caché del último chunk y no asignan memoria (se mide en `bench.mjs`).

## Decisiones de diseño

* **Pureza**: todo sale de funciones puras por columna `(x,z)` y por voxel `(x,y,z)`; el orden de generación no importa (test con procesos hijos en distinto orden). Cuadrícula de columnas con relleno de 2 para pendientes y árboles en bordes.
* **Mundo**: `CHUNK` 16×64×16, nivel del mar `SEA_LEVEL=20`, altura máxima 62. Mar/lagos por debajo del nivel del mar; no hay agua flotante (los huecos de cueva no se llenan).
* **Biomas** (temperatura × humedad, escala ~400 bloques): `plains`, `forest`, `desert`, `snowy_mountain` (+ montañas por ruido ridged, nieve en altura). Superficie: pasto/tierra, arena (desierto/orillas), grava (fondos profundos), nieve; piedra en pendientes ≥3.
* **Cuevas**: espaguetis (dos ruidos cerca de 0) + cavernas; profundidad mínima 4 bajo la superficie salvo «bocas» raras. Menas: carbón e hierro (hierro solo y≤28) por ruido 3D.
* **Árboles** (`generator.js`, `treeBlocks`, `World.fellTree`): 3 especies, 10–18 bloques (5–9 m con BLOCK_M=0,5), todo por `hash3(seed, celda)`: roble 10–15 (copa ancha de elipsoides con ruido + ramas cortas), pino 13–18 (tronco hasta la punta, copa en pisos, estrecho), abedul 10–14 (delgado, copa ovalada). Bioma → especie: nieve = solo pino; llanura 60 % roble / 40 % abedul; bosque frío (temperatura < 0,42) 60 % pino, resto del bosque 50 % roble / 30 % abedul / 20 % pino; desierto sin árboles. Densidad de candidatos: bosque 1,0 · nieve 0,3 · llanura 0,14 por celda de 6×6. Un candidato por celda; se ACEPTA si ningún candidato válido de mayor prioridad (hash) queda a menos de `rA + rB + 1` bloques (Chebyshev, `r` = alcance máximo de copa por especie, `TREE_REACH`): ni troncos ni copas comparten bloque. Como validez y prioridad son funciones puras de la semilla, un chunk reconstruye los árboles de los chunks vecinos (margen 5) y los bordes coinciden bit a bit sin importar el orden. Válido = suelo pasto/nieve a ≥ SEA+2, pendiente ≤ 2 contra los 4 vecinos (y contra las 4 columnas de la base 2×2), sin boca de cueva, cabe en 64. Troncos altos (roble/pino ≥ 13): base 2×2 que sube `ceil(altura/3)` niveles sobre la columna más alta (≥ 1/3 del árbol), luego afinado 3→2→1 columnas (una diagonal cae primero, después una de las dos ortogonales) y 1×1 arriba; en árboles gruesos de altura ≥ 15, 2–3 raíces de 1 bloque pegadas por cara a la base, sobre suelo sólido (alturas de terreno ≤ +1 del pie del tronco, nunca flotan). Abedul 1×1. **Corteza vs anillos**: ids distintos. Troncos naturales (`LOG`, `PINE_LOG`, `BIRCH_LOG`) llevan corteza también en sus caras superior/inferior; los cortados (`LOG_CUT`, `PINE_LOG_CUT`, `BIRCH_LOG_CUT`, que es lo que sueltan al romperse y lo que coloca el jugador) llevan anillos arriba/abajo. Costo cero en el mesher (`TILE_OF` ya depende de id y cara). Ids por especie: `NATURAL_LOG[species]`, `CUT_LOG[species]`, `LEAF_OF[species]`, `IS_LOG(id)`, `IS_LEAF(id)` exportados desde `src/world`. Hojas solo reemplazan aire y se podan por BFS: ninguna hoja queda sin camino de hojas hasta un tronco (comprobado también sobre el mundo real).
* **Tala** (`world.fellTree(x,y,z,arg)`): quita todos los troncos conectados por cara (2×2, ramas) y las hojas del árbol dueño (exacto vía `treeBlocks`). Dos formas:
  * **Legacy** `fellTree(x,y,z)` o `fellTree(x,y,z,{instant:true})`: instantáneo, devuelve `{ logs, leaves, drops:[{id,count}], tree:null, direction:null }` (igual que antes; los drops son la versión CUT del tronco natural).
  * **Animada** `fellTree(x,y,z,{ fromX, fromZ })` (posición del golpe/jugador en BLOQUES; o `dirX,dirZ` explícito, que tiene prioridad; sin nada, la dirección sale de `hash3(seed,x,y,z)`): el árbol sale de la grilla y se crea un `FallingTree` que cae en dirección OPUESTA al golpe (4 direcciones, la dominante del vector golpe→base). Devuelve además `{ tree, direction:[dx,dz] }`. Opciones: `maxLogs`, `leafDrops` (palos desde hojas, prob. 1/24 por hoja, máx. 6; **default 0**, por defecto las hojas no sueltan nada).
* **Entidades** (`entities.js`, estado en `world.entities`, NO se serializa; `settleEntities()` las resuelve al instante antes de guardar): péndulo invertido θ'' = k·sinθ, k = 1,5·g/L (L = altura del árbol en m), pivote en el borde del lado de caída de la base, θ0 = 0,04, ω0 = 0,12. Impacto = un tronco toca un sólido no-hoja (colisión por centro de bloque; las hojas son atravesables) o θ ≥ ~90°, o `FALL_MAX_TIME` = 8 s. Al impactar: se elimina el árbol y salen `ItemDrop`s (1 por tronco, id = `BLOCKS[id].drop`, repartidos a lo largo del tronco con jitter determinista de `hash3`), gravedad + `moveAndCollide`; duermen tras 30 pasos quietos; despawn 300 s simulados (`ITEM_TTL`), tope `MAX_ITEMS` = 512. Palos: id `ITEM_STICK` = 256 (no bloque; propuesta aditiva a contracts). API: `world.updateEntities(dt)` (acumulador, paso fijo `ENTITY_STEP`=1/120, dt máx 0,25 s), `world.stepEntities(n)` (n pasos exactos), `world.pickupItems([x,y,z] m, radioM=1.5)` → `[{id,count}]` y los quita, `world.consumeEntityEvents()` (`'fell'`/`'impact'`), getters `world.fallingTrees` / `world.itemDrops`. Determinismo: mismo seed + mismos golpes + misma secuencia de dt (o de `stepEntities`) = mismo resultado bit a bit.
* **Vista de entidades** (para Motor, sin tocar nada más): `import { createEntityView } from './world/entityView.js'`; `const ev = createEntityView(THREE, scene, world, atlas, { tileNames: TILES });` y en el bucle: `world.updateEntities(dt); ev.update();`. El árbol se malla una vez (caras visibles, capas opaca/recorte) con posiciones relativas al pivote y solo se actualiza su cuaternión; los items son cubos de `ITEM_SIZE_M` (0,2 m) en una sola malla dinámica (el ShaderMaterial de voxel no soporta `InstancedMesh`). Limitación: las normales no giran con el árbol (la luz es la del bloque sin caer).
* **Cuevas y entradas**: además de las cuevas de espagueti/cavernas (`MIN_CAVE_DEPTH`=4 bajo la superficie), hay **entradas a la superficie** deterministas: una candidata por celda de 32×32 bloques (`ENT_CELL`, prob. `ENT_P`=1; hasta 6 intentos de punto con superficie ≥ SEA+3 y ≤ HEIGHT_MAX−8, si no hay, la celda no tiene entrada) con un túnel inclinado hacia la ladera que baja hasta ~12 bloques bajo la boca y termina en una sala; los árboles no crecen a ≤12 bloques (`ENT_TREE_CLEAR`). `listCaveEntrances(seed,x0,z0,x1,z1)` → `[{x,z,h,dirX,dirZ,bottomY}]` (en bloques). Es función pura de la semilla (el chunk vecino reconstruye las mismas entradas).
* **Menas** (`stampOres`): solo reemplazan piedra, vetas deterministas (esferas con ruido por `hash3`). CARBÓN: y 12–46, más abundante (p 0,68 por celda de 8); HIERRO: y 2–15, más escaso (p 0,24 por celda de 10). Algunas quedan expuestas en paredes de cueva. Medición: `node scripts/world-caves-metrics.mjs [seed] [N]` (`HIST=1` histograma completo).
* **Edición**: el diff guarda por chunk el valor original; revertir una edición la descarta.

## Rendimiento (medido, `node src/world/bench.mjs`, Node v24, Xeon virtual ×8, grilla 8×8, semillas 1234 y 7)

```
generateChunk   N=128  media ≈1,5–1,75 ms  (referencia anterior: media 1.595, mediana 1.480, p95 2.358)
meshChunk       N=72   media ≈0,26–0,29 ms (con 4 vecinos; referencia anterior 0.256)
triángulos/chunk (N=72): greedy media 231 (mediana 142, p95 708) — antes 218 / 126 / 636 · vértices 462/chunk (antes 437) · malla ≈ 16,2 KiB/chunk (antes 15,3; p95 49,8 vs 44,7)
(el recuento «ingenua con culling» y «sin culling» está en la salida de `bench.mjs`)
getBlock/solidAt (patrón de muestreador de suelo, mundo 8×8 cargado, 781 561 llamadas × 7 repeticiones): mediana ≈ 9 ns/llamada
```

**Con el mundo cargado en el motor** (`npm run build && npm run smoke:world`, Chrome headless + **SwiftShader = render por software, no GPU**, 1280×720, radio 4,5 ≈ 60 chunks, cámara inicial de `main.js`; 4 corridas): carga inicial (página + 60 chunks generados y mallados) 0,8–0,95 s (2 corridas la midieron); 60 chunks / 89 mallas / 43 draw calls / 16 956 triángulos dibujados (26 932 en total cargados; el resto lo descarta el frustum culling), 1 textura. `requestAnimationFrame` de Chrome headless está topado a 60 Hz: fps promedio por frame 57,5–59,6 y mínimo (ventanas de 0,5 s) 50–58; peor frame 33–50 ms (1–2 frames perdidos). Para ver margen se cronometraron 200 renders seguidos con `readPixels` (sincroniza con SwiftShader): media 5,6–12,0 ms por render (mediana 5,0–10,4). La variación entre corridas es grande (máquina compartida). Esto **no predice un GPU real ni un celular**.

Cifras de una sola máquina/corrida; la variación entre corridas es visible (p.ej. la media de `generateChunk` de la semilla 1234 fue 1,76 y 2,20 ms en dos corridas).

**Árboles** (A/B en la misma máquina, 3 corridas intercaladas de `bench.mjs` en master `afc0110` vs `world-trees`; el ruido entre corridas es mayor que la diferencia: generateChunk 1,5–1,8 vs 1,5–1,75 ms, meshChunk 0,25–0,35 vs 0,26–0,29 ms). La ventana por defecto del bench (chunks 0..7 de las semillas 1234 y 7) tiene pocos árboles, así que se midió aparte una ventana de bosque (semilla 1234, chunks -40..-33 × -28..-21, 8×8, script ad hoc, no en el repo): bloques LOG+LEAVES por chunk 259 (árboles viejos de 4–6 bloques) → 178 (árboles nuevos, ≈1,3 árboles/chunk); generateChunk 1,65–1,84 → 1,69–1,98 ms; meshChunk 0,48–0,64 → 0,40–0,59 ms; triángulos greedy 767 (mediana 744, p95 1274) → 740 (678, 1404). Distribución real de alturas (4 semillas, región de 720×720 bloques cada una, 5153 árboles): roble N=1302 min 10 / mediana 12 / máx 15 · pino N=2841 13 / 15 / 18 · abedul N=1010 10 / 12 / 14 bloques (todos 5–9 m).

## Pendiente / limitaciones conocidas

* **Sin GPU real**: shader y vista se ejecutan en Chrome headless con SwiftShader (render por software) vía `npm run smoke:world`; los fps de abajo NO representan un GPU ni un celular. Los tests unitarios usan un THREE falso.
* Periodo del ruido: 256 celdas (se repite el patrón; imperceptible a esta escala).
* Ediciones cargadas desde disco no se pueden descartar automáticamente al revertirlas (se desconoce el original).
* Filtraciones de agua hacia cuevas solo verificadas dentro de un chunk; sin simulación de fluidos.
* Tala: no queda tocón (todos los troncos conectados caen); colisión del árbol solo por centros de bloque; entidades no persistentes; el determinismo depende de la secuencia de dt; el impacto convierte el árbol en items de golpe (no hay rodar ni astillar). Falta: manzanas, AO y teñido por bioma, fauna/spawns, flujo de agua, decoraciones (flores, hierba alta). Las 3 especies usan ids propios pero, mientras el atlas de Arte no tenga los tiles `pine_*`/`birch_*`, se ven con el tile de roble (fallback) y se distinguen solo por forma. Un roble de 15 bloques tiene ~7,5 m de altura pero copa de radio ≤4 bloques (2 m).
* Cifras de afinado del terreno (porcentajes de biomas, 17 % bajo el mar) son de una muestra informal, no del bench.

## Tests

`npm test` corre `test/world-*.test.js` junto a los de Motor: generador (determinismo entre órdenes, árboles, agua, cuevas), ruido, mundo (contrato, edición, diff, carga), mesher (comparado cara por cara con fuerza bruta por capa, winding, uvs, tiles, unidades), physics/raycast (DDA vs muestreo fino, 1000 rayos), jugador (`world-player.test.js`: caída/aterrizaje, paredes sin tunneling, escalón 1 vs 2 bloques, salto, determinismo, dt 1/30 vs 1/144, esquinas, agua, desatasco), carga por radio entero y fraccionario, tilemap, contrato y adaptador Three falso.
