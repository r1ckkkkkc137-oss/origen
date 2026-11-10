# ORIGEN anim — módulo de animación 3D (humanoide)
API: `createAnimator3D({seed,getBlock,blockM=0.5})` -> `update(dt, root{pos:[x,y,z] m, yaw}) -> Skeleton3D`; `play('jab')`.
Skeleton3D = `{bones, parent, root, visualYaw, pose:{hueso:[x,y,z] MUNDO m}, tips:{headTop,face,handL,handR,toeL,toeR}}`.
Mundo en metros, +Y arriba, frente local +X, yaw = rotation.y de three (frente = (cos yaw,0,-sin yaw)). La raíz es del sim; solo se lee.
`npm test` · `npm run dev` (viewer, teclas 1-7 escenarios) · `npm run capture [dir]` · `node scripts/fps.mjs`.

## Sincronía con la sim (Combate)
- `play(name)` 1x (compatible, devuelve false si ya hay clip) · `play(name,{speed})` · `play(name,{duration})` (clip entero en N s) ·
  `play(name,{impactIn,duration})` (deforma el tiempo: el impacto del clip cae a `impactIn` s —p.ej. windupSeconds— y el clip termina a `duration` s) ·
  `play(name,{phase, force})`.
- `playAt(name, phase01, simImpact01?)`: modo conducido; la sim da la fase 0..1 cada frame (simImpact01 = fracción de la sim donde cae el impacto). Termina solo en 1; si no se refresca 0.25 s se cancela con fundido.
- `cancel(fade=0.15)`: corta con fundido (stun/reacción). `clipInfo(name)`: `{duration, impactT, impact01, active01, tip}`.
- `update()` emite en `A.events`: `{type:'impact',name,tip}` al cruzar el impacto y `{type:'clipEnd',name}`; `A.strike = {active, phase, phase01, name, tip, fist}`.
- Capturas del JUEGO real (main.js + humanView): `node scripts/anim-game-capture.mjs [outDir] [escenas] [flat|world]`.

## Golpes y bloqueo (ronda 2)
Clips: `jab` (con paso del pie delantero, +13 cm, sólo en el aire), `cross` (mano trasera, pivote del talón trasero sobre la bola del pie, cadera → hombros → puño),
`hook` (mano delantera, arco horizontal, codo ≈90° y a la altura del hombro, pivote del pie delantero), `lowkick` (patada trasera: paso + pivote del pie de apoyo,
giro de cadera ≈65°, la espinilla pega a ~0.7 m de altura, vuelve a la guardia), `block` (clip de 0.6 s). `A.setGuardLevel(0..1)` mantiene el bloqueo mientras la sim lo pida (resorte ~0.08 s).
Todos aceptan `play(name,{speed|duration,impactIn})` y `playAt`. `strike.fist` es el puño (o el tercio inferior de la espinilla en `lowkick`; `tip:'kickR'`).
Nuevos canales: `fL*/fR*` (override de pie: x,y,z en marco de cara, yaw, pitch; sólo actúan con el cuerpo quieto), `elvL/R` (elevación de codo).
Clip: `feet:true` congela los pasos automáticos durante el clip; `ball:{L|R}` hace pivotar el pie sobre la bola. `feetWorld()[i].contact` = punto de apoyo (bola) para tests de no-deslizamiento.

## Ronda 3 (feedback de Rick: el gancho era un jab abierto)
- **Gancho real.** El codo queda FIJO en `HOOK_E` (92°) de la carga (`lock.tLoad`) al impacto: la muñeca se hornea al cargar el módulo como un cuerpo rígido en el marco del pecho a radio `HOOK_R`
  (|muñeca−hombro| constante = codo constante), rotada por la guiñada del pecho (cadera → hombros) + aducción tardía del hombro `HOOK_A0→HOOK_A1`; se mezcla con la guardia con `lam`.
  Medido: codo 91.4–92.0° de la carga al impacto, puño a 0.63 m del centro de los hombros (no 1.5 m), desvío lateral 0.05 m, cadera 28°, hombros 50°, cadena cadera < hombros < pico del puño.
- **Alcance contra la tabla de Combate** (`src/combat/data/reach3d.js`, sólo se lee): `node scripts/anim-metrics.mjs reach` mide pelvis→punta en `impactT` (horizontal y 3D). Hook 0.67 m (ideal 0.70±0.08, OK).
  Jab y cross: 3D 1.07/1.03 m (ideal 1.10/1.05, OK) pero horizontal 0.88/0.79 (el brazo ya está extendido: sólo se podría acercar con el paso/inclinación). Low kick 0.55→0.75 m (ideal 1.00; la pierna está al límite del IK).
- **Guardia**: columna casi vertical (hipPitch/spPitch 0.04, mentón `hdPitch` 0.20): inclinación 10.6° → 3.1°.
- **Reacciones**: `hurt_head` latigazo de cabeza (hdPitch −0.85 rad, giro y balanceo), `hurt_legs` flexión/entrega de rodillas con pérdida de peso (pelvis baja ≈0.2 m); KO: `KO_END` compensa la guardia nueva
  (el cuerpo tendido queda igual en absoluto) y la rodilla trasera sube menos.
- **Trepada**: el fundido de la mano al borde (`wH`) es más largo y el polo del codo cambia más suave: salto del codo izquierdo 7.4 → 4.4 cm/frame.
- Métricas reproducibles: `node scripts/anim-metrics.mjs [hook|guard|hurt|ko|climb|reach|all]`. Tests: `src/anim/tests/round3.test.mjs`.

## Ronda 4 (Rick + Benja: gancho abierto, KO de peso muerto, peso y velocidad)
* **Tiempos de la sim**: jab/cross/hook/lowkick usan `SIM_TICKS` (startup/active/recovery a 60 Hz): `impactT = startup/60`, duración = total/60. Anticipación corta con carga de cadera, ease-in fuerte hasta el impacto (el pico de velocidad de la punta cae en el frame de impacto), hit-stop `HITSTOP` = 2,5 frames con transferencia de peso (pie trasero empuja sobre la bola, pelvis baja, torso avanza) y recuperación rápida. `node scripts/anim-metrics.mjs speed`.
* **Gancho**: húmero abducido ~85° (paralelo al suelo), ≥60° de la dirección al rival, codo fijo 90° y al costado del puño. Brazo bloqueado en el marco del pecho + snap de aducción horizontal (`hookArm`, `bakeHookArm`); el codo se fija con el polo en marco de cara (canales `pLx/pLy/pLz/pLw`). Alcance raíz→puño 0,70 (`rootReach`, raíz = pelvis de la sim, como reach3d.js).
* **Low kick**: paso del pie de apoyo + pivote sobre la bola + torso atrás; alcance horizontal raíz→espinilla 1,0 m.
* **KO**: sin IK de piernas: canales FK `kw, kH*, kK*, kA*, kF*` (cadera/rodilla en el marco de la pelvis). En el instante del KO se corta guardia y tono; rodillas adelante/abajo, cae como peso muerto con las piernas plegadas debajo y termina tendido. `getUp` se levanta desde ahí.
* **Finta de gancho** (`feint_hook`): la sim aborta el hook en el startup y manda `state.clip = 'feint'`, `state.move = 'hook'`. `setState` cambia a `feint_hook` a la misma fase (idéntico al gancho hasta `FEINT_CUT`), la cadera/hombros siguen cargando y se cortan en seco a 0,13 s; el puño no va adelante. Mientras dure la finta `play('hook')` no relanza el gancho. Evento `{type:'feint'}` y `feintCut` (en vez de `impact`).
* **Reacciones según la fuerza**: `react(zone, {power | damage})`; desde `setState` la fuerza se deduce del salto de `state.damage[zona]` en el frame del golpe (`state.hurt` sólo trae zona/edad). Cuerpo/pelvis escalan `0,40 + 0,90·power`, la cabeza `0,65 + 0,35·power`; el golpe fuerte dura algo más. Sin dato => amplitud 1 (r3). `node scripts/anim-metrics.mjs force`.
* **Juego de pies de pelea** (`state.loco.mode` ≠ exit/walk): se mantiene la estancia de guardia, el pie del lado del movimiento sale primero, el otro lo sigue a mitad de vuelo (paso-arrastre), pasos de 0,22 s que persiguen al home durante la ráfaga; giro más rápido. Guardia (subir/bajar) más seca. `node scripts/anim-metrics.mjs loco`.
* Tests: `tests/round4.test.mjs`.

## Ronda 5 (Rick)
* **Jab y cross a 1,0 m** (alcance horizontal raíz→puño = pelvis de la sim, `REACH_IDEAL` 1,00±0,05): más giro de cadera/hombro, brazo a ~170° (la IK llega, huesos de largo fijo: sin brazo de goma), pelvis que entra (jab: paso de 24 cm del pie delantero; cross: desliz de 21 cm del pie delantero). Pico de velocidad en el impacto y hit-stop intactos. Cortar un golpe extendido (cancel/reacción) funde en ≥0,14 s para no saltar >15 cm/frame.
* **KO**: desde que se doblan las rodillas el tronco se va hacia atrás y al costado y no vuelve a erguirse (≥35° de la vertical desde que apoya las rodillas); muslos con la misma dirección en el mundo que en r4 (`bakeKoThighs`), piernas por FK. `node scripts/anim-metrics.mjs ko` (KO_TILT).
* **Gancho ≥10 m/s** al impacto (60 Hz): más carga de cadera (0,34 rad a 0,07 s) y el pecho gira con ease-in desde 0,09 s; el brazo (HOOK_A0/A1, codo 90°, snap0) es el de r4. La cadena cinética se mide hasta el valor en el impacto (`halfCross(..., iEnd)`).
* Tests: `tests/round5.test.mjs`.

## Ronda 6 (Rick): contacto real y gancho con entrada

### Para Motor: enlazar los dos animadores (sin tocar src/combat ni main.js de Combate)
El contacto necesita que cada animador vea el esqueleto del otro. Dos formas equivalentes:

```js
import { pairedAnimatorFactory, pairAnimators } from './src/anim/index.js';
// a) fábrica: liveAnim crea a y b seguidos con opt.createAnimator3D -> quedan enlazados a<->b
const la = createLiveAnimation(live, { createAnimator3D: pairedAnimatorFactory(), seed });
// b) a mano, después de crear
pairAnimators(la.anims.a, la.anims.b);           // = a.setOpponent(b); b.setOpponent(a)
```
`A.setOpponent(B | () => Skeleton3D | null)`. Sin enlace todo sigue como en r5 (hojas del visor, tests previos).
Orden de update a->b: `a` lee la pose de `b` del frame anterior (extrapolada 1 frame) y, cuando `b` termina su update,
`b` llama `a._refine()` para que `a` saque su punta/miembro contra la pose NUEVA de `b` y re-exporte. No hace falta nada más.

### Contacto (src/anim/contact.js + animator3d `contactStep`)
- Rival = primitivas desde SUS huesos: cabeza esfera (r 0,105, centro head+0,55·(headTop−head)), torso cápsula pelvis+0,06→cuello−0,09
  (r 0,14), cuello (0,06), hombro–hombro (0,07), muslos (0,075) y espinillas (0,055). Punta: nudillos (r 0,02) / espinilla al 30 % del tobillo (0,045).
- **Ajuste al blanco** (últimos 0,10 s antes del impacto): con la punta libre prevista (`clip.aim.ref`, marco raíz) se calcula dónde toca
  la zona (cabeza a la altura de mentón/mandíbula: `aim.dy`; low kick: el muslo más cercano) y la diferencia entra en rampa: el golpe
  llega a la superficie EN el impacto frenando de forma continua (sin plegarse de golpe). Si se cambia un clip hay que remedir `aim.ref`
  (round6.test.mjs lo comprueba).
- **Clamp**: si la punta está dentro (o el antebrazo/espinilla atravesó: barrido codo->nudillos / rodilla->espinilla) va al primer
  contacto; el resto del miembro (codo/rodilla y muestras de los segmentos) se saca con una corrección limitada a 0,10 m/frame.
- **Hit-stop**: desde el primer contacto de la fase de golpe hasta HITSTOP s después del impacto la mano queda clavada en el punto de
  impacto (IK); si el rival retrocede, la acompaña como mucho 6 cm (0,06 m/frame) y luego suelta en 0,08 s.
- Eventos: el atacante emite `{type:'contact', name, zone, point (mundo), clipT, early}`; el golpeado `{type:'contactIn', ...}`
  (sirve para VFX/sonido en el punto). El golpeado usa el lado del contacto para el retroceso: el signo y tamaño de los canales laterales
  (giro/inclinación de cabeza y tronco) salen de dónde pegó (gancho de izquierda -> cabeza a su izquierda; jab al centro -> sobre todo atrás).
- `state.hurt.power` (combat-gap) manda la fuerza; sin `power`, respaldo por el salto de `state.damage`.

### Gancho con entrada (combat-gap: el hook conecta a ~0,85 m sin que la raíz entre)
`HOOK.entry`: paso del pie delantero (fLz 0,19 m, en el aire hasta 0,11 s) + pelvis que entra (pz 0,195) + el peso cruza (px −0,05),
escalado por k: con el esqueleto del rival, k pone la punta libre a la profundidad del centro de SU cabeza (+1,5 cm); sin esqueleto,
k = (d − 0,70)/0,16 con d = distancia raíz–raíz prevista en el impacto (`opts.entryDist` para fijarla). Se recalcula cada frame hasta el
impacto: si la sim mete la raíz a ~0,70, k cae a ~0 y el clip no se pasa. Sin rival (visor) k = 1: alcance raíz→puño 0,864.

## Ronda 7 (Rick): patadas media/alta, ground and pound y bloqueo con colisionadores de guardia

### Patadas media y alta (clips propios)
- `bodykick` (a las costillas) y `highkick` (a la cabeza/cuello) en `kicks.js`: cadena cadera→rodilla cargada→espinilla/empeine,
  pivote del pie de apoyo (~85°/94°), pico de velocidad de la espinilla en el impacto, hit-stop (clavado 0,042 s).
- Enganche con la sim: `MOVE_CLIP = { bodyKick: 'bodykick', highKick: 'highkick', gnpPunch: 'gnp_punch', gnpElbow: 'gnp_elbow', gnpBody: 'gnp_body' }`.
  - Con `clipMap: MOVE_CLIP` en liveAnim, cada move pide su clip.
  - Sin clipMap (`CLIP_MAP` de liveAnim manda bodyKick/highKick a 'lowkick' y los gnp* a 'jab'), el animador **remapea**: si `state.move`
    es bodyKick/highKick (o la stance es de suelo), el 'lowkick'/'jab' pedido se cambia por el clip propio con el tiempo deformado para
    que el impacto caiga donde lo pidió liveAnim (impactIn = impactT del clip pedido).
- Patada NO bloqueada: los brazos del rival ceden ante la pierna (guardYield) y, en la recogida, la pierna rodea los brazos que bajan a cubrir.

### Ground and pound
- Stances `groundTop` / `groundBottom` con `groundPos` ('mount' | 'guard' | 'side' | 'half' | 'back'): capa de pose de suelo con muelles;
  las dos raíces coinciden (yaws opuestos), como la sim.
- Clips `gnp_punch` (puño a la cabeza), `gnp_elbow` (punta = codo), `gnp_body` (puño al torso), cada uno con referencia de puntería por posición.
- El de abajo recibe `hurt_ground` (la cabeza va al suelo y rebota, nunca por debajo: `floorHead`) o `hurt_ground_body`.
- Mientras está en el suelo se cancelan los clips de pie; un KO tumbado sigue tumbado.

### Bloqueo: lo que espera el animador de Combate
Evento de la sim (por `live.on('*')`):

```js
{ type: 'block' | 'blocked',
  src: 'block' | 'parry' | 'check' | 'catch',     // o result
  attacker, target | defender,                    // ids de los peleadores (live.ids)
  power,                                          // 0..1
  point,                                          // hoy cae en la zona del cuerpo: NO se usa
  guard: { limb: 'glove' | 'forearm' | 'shin', side: 'L' | 'R' } }   // próxima rama de Combate; opcional
```

- Con `guard`, ese miembro es el colisionador objetivo.
- Sin `guard`:
  - puño: se usa el guante o antebrazo más cercano a la trayectoria del puño;
  - media/alta de derecha: el brazo izquierdo del rival;
  - `check` o low kick: espinilla contra espinilla.
- `src: 'catch'` (patada atrapada): el pie frena contra el guante. **La pose de pierna atrapada está PENDIENTE.**
- Alternativa: `state.hurt.blocked = true` (con zone/power) en el que recibe se trata igual que `blockHit` (sin dolor en la cabeza).

### API
- `A.strikeBlocked(ev)` (lado que golpea): el golpe en curso frena y se clava sobre el miembro.
- `A.blockHit(ev)` (lado que recibe):
  - la guardia cede según `power`;
  - con brazo o espinilla contra una patada, el miembro va al encuentro de la punta;
  - no hay reacción de dolor;
  - chequeo: `check_hit` o `check_hit_R`, según el lado de la patada.
- `bindCombatEvents(live, anims)`: se suscribe a `live.on('*')` y enruta con `routeBlockEvent(ev, anims, ids)`. Devuelve la función para
  desuscribirse.

**Lo que tiene que llamar Motor:** `bindCombatEvents(live, la.anims)` y, si quiere clips propios sin remapeo, `clipMap: MOVE_CLIP`.

### Pendiente
- Pose de patada atrapada.
- `guardElbow` (golpes desde abajo).
- Reacción de dolor del de arriba en el suelo.
- gnp desde guard, back y half menos afinado; el codo desde guard no llega.
- El chequeo queda a ~0,03 m.
