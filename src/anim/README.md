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
