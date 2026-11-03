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
| `physics.js` | AABB barrido por eje, escalones, agua, raycast DDA |
| `threeAdapter.js` | `createWorldView` (carga por radio + mallado con presupuesto + atlas de Arte), `createGeometry`, `createVoxelMaterial`, `buildTileMap` + shaders base (con niebla/sRGB/tonemap de THREE). Solo probado en SwiftShader |
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
* **Atlas** (Arte, `src/render/atlas.js`, 16 px, 4 columnas): los 8 primeros `TILE_NAMES` coinciden con el `TILES` de Arte (test lo comprueba si existe `/tmp/origen-art`). **Arte debe agregar al final, en este orden**: `sand, snow, gravel, coal_ore, iron_ore, water` (índices 8..13), o se cambia el orden aquí. Mientras el atlas de Arte tenga solo 8 tiles, `buildTileMap` usa sustitutos (`TILE_FALLBACK`: sand→dirt, water→dirt, snow/gravel/coal_ore/iron_ore→stone; `view.missingTiles` los lista) y las filas del atlas salen de `canvas.height/16`, así que al agregar tiles al final **no hay que tocar nada aquí**. El agua usa `uOpacity=0.7` en el shader (alpha del material), no del tile.

## Diff aditivo propuesto a `src/shared/contracts.js` (Motor decide)

```diff
-export const BLOCK = Object.freeze({ AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5, WATER: 6, SAND: 7, ORE: 8 });
+export const BLOCK = Object.freeze({ AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5, WATER: 6, SAND: 7, ORE: 8,
+  IRON: 9, GRAVEL: 10, SNOW: 11, PLANKS: 12 });
```

El módulo ya usa estos valores como respaldo (`BLOCK.IRON ?? 9`, …) y los toma del contrato apenas existan. Alias internos: `LOG = BLOCK.WOOD`, `COAL = BLOCK.ORE` (el `ORE` genérico es carbón). Nada se renumera.

Notas para la interfaz `World` (aclaraciones, no cambios): `raycast` devuelve además `place:[bx,by,bz]`; `setBlock` marca `dirty` también en el chunk vecino cargado si el bloque está en el borde; `chunk.dirty` lo limpia quien re-malla (`World.consumeDirty()` lo hace por ti).

## Integración con el motor (atlas conectado)
`src/main.js` (único archivo de Motor que se tocó, mínimo): `applyLook` (Arte) + `createAtlas(SEED)` + `createWorld(seed)` + `createWorldView(THREE, scene, world, atlas, { tileNames: TILES, radius })`; cada frame `view.update(camera.x, camera.z)` (metros). Se quitó el `GridHelper` y la luz/niebla provisorias. `?r=<chunks>` fija el radio (por defecto 4,5 ≈ 8×8 chunks = 60 chunks cargados), `?wseed=` la semilla del mundo. `window.__ORIGEN__` expone `world, view, look, renderer`.

## Para Animador (`createAnimator3D({ seed, getBlock, blockM })`)
`getBlock` de Animador es un predicado «sólido» en celdas enteras: usar **`(x,y,z) => world.solidAt(x,y,z)`** con `blockM: BLOCK_M`. No pasar `world.getBlock` crudo: devuelve el id (el agua, id 6, es truthy y contaría como suelo). `solidAt`/`getBlock` hacen una sola indexación con caché del último chunk y no asignan memoria (se mide en `bench.mjs`).

## Decisiones de diseño

* **Pureza**: todo sale de funciones puras por columna `(x,z)` y por voxel `(x,y,z)`; el orden de generación no importa (test con procesos hijos en distinto orden). Cuadrícula de columnas con relleno de 4 para pendientes y árboles en bordes.
* **Mundo**: `CHUNK` 16×64×16, nivel del mar `SEA_LEVEL=20`, altura máxima 62. Mar/lagos por debajo del nivel del mar; no hay agua flotante (los huecos de cueva no se llenan).
* **Biomas** (temperatura × humedad, escala ~400 bloques): `plains`, `forest`, `desert`, `snowy_mountain` (+ montañas por ruido ridged, nieve en altura). Superficie: pasto/tierra, arena (desierto/orillas), grava (fondos profundos), nieve; piedra en pendientes ≥3.
* **Cuevas**: espaguetis (dos ruidos cerca de 0) + cavernas; profundidad mínima 4 bajo la superficie salvo «bocas» raras. Menas: carbón e hierro (hierro solo y≤28) por ruido 3D.
* **Regla de árboles**: grilla de 7×7; tronco = celda·7 + jitter 0..2 ⇒ troncos ≥5 separados y copas (radio 2) nunca solapan. Existe si `hash3` pasa (bosque 0,8; llanura 0,06) y la columna es válida (bosque/llanura, suelo ≥ SEA+2, pendiente ≤2, pasto, no boca de cueva). Tronco 4..6 bloques; hojas/troncos solo reemplazan aire. **Con 0,5 m por bloque eso son 2–3 m de árbol**: si Rick quiere árboles más altos hay que subir la línea `trunk = 4 + floor(hash3(ts,cx,4,cz)*3)` de `generator.js` (pendiente de decisión, no se cambió).
* **Edición**: el diff guarda por chunk el valor original; revertir una edición la descarta.

## Rendimiento (medido, `node src/world/bench.mjs`, Node v24, Xeon virtual ×8, grilla 8×8, semillas 1234 y 7)

```
generateChunk   N=128  media 1.818 ms  mediana 1.545  p95 3.497  (máx 7.201)
meshChunk       N=72   media 0.248 ms  mediana 0.224  p95 0.392  (con 4 vecinos)
triángulos/chunk (N=72): greedy media 218 (mediana 126, p95 636) · ingenua con culling media 993 · sin culling media 70185
greedy = 22,0 % de la ingenua con culling · 0,31 % de la malla sin culling · malla ≈ 15,3 KiB/chunk
```

Cifras de una sola máquina/corrida; la variación entre corridas es visible (p.ej. la media de `generateChunk` de la semilla 1234 fue 1,76 y 2,20 ms en dos corridas).

## Pendiente / limitaciones conocidas

* **Sin GPU real**: shader y vista se ejecutan en Chrome headless con SwiftShader (render por software) vía `npm run smoke:world`; los fps de abajo NO representan un GPU ni un celular. Los tests unitarios usan un THREE falso.
* Periodo del ruido: 256 celdas (se repite el patrón; imperceptible a esta escala).
* Ediciones cargadas desde disco no se pueden descartar automáticamente al revertirlas (se desconoce el original).
* Filtraciones de agua hacia cuevas solo verificadas dentro de un chunk; sin simulación de fluidos.
* Falta: caída de árboles/tala, AO y teñido por bioma, fauna/spawns, flujo de agua, decoraciones (flores, hierba alta).
* Cifras de afinado del terreno (porcentajes de biomas, 17 % bajo el mar) son de una muestra informal, no del bench.

## Tests

`npm test` corre `test/world-*.test.js` junto a los de Motor: generador (determinismo entre órdenes, árboles, agua, cuevas), ruido, mundo (contrato, edición, diff, carga), mesher (comparado cara por cara con fuerza bruta por capa, winding, uvs, tiles, unidades), physics/raycast (DDA vs muestreo fino, 1000 rayos), tilemap, contrato y adaptador Three falso.
