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
