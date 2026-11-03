# ORIGEN anim — módulo de animación 3D (humanoide)
API: `createAnimator3D({seed,getBlock,blockM=0.5})` -> `update(dt, root{pos:[x,y,z] m, yaw}) -> Skeleton3D`; `play('jab')`.
Skeleton3D = `{bones, parent, root, visualYaw, pose:{hueso:[x,y,z] MUNDO m}, tips:{headTop,face,handL,handR,toeL,toeR}}`.
Mundo en metros, +Y arriba, frente local +X, yaw = rotation.y de three (frente = (cos yaw,0,-sin yaw)). La raíz es del sim; solo se lee.
`npm test` · `npm run dev` (viewer, teclas 1-7 escenarios) · `npm run capture [dir]` · `node scripts/fps.mjs`.
