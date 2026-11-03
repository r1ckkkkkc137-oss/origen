# src/fight — núcleo de combate MMA (Rick Combate)

JS vanilla ES modules sin dependencias. **Determinista por seed** (PRNG sfc32 en `rng.js`, sin `Math.random`/`Date`),
paso fijo **60 Hz**, unidades en **px** (arena ±260, `PX_PER_M = 55` en `src/data/moves.js`).
`index.js`, `tuning.js` y `sim.test.js` son del otro agente de Combate; este README documenta el núcleo.

| Archivo | Qué hace |
|---|---|
| `core.js` | `DEFAULT_TUNING`, `createFightCore`, `stepCore`, `runCore`, `moveToAction`; rounds, jueces, suelo/clinch, acción por tick |
| `fighter.js` | `FIGHT_STATS`, `normalizeStats`, `styleFromStats`, `createFighter`, atributos derivados, `condition()` (fatiga/daño) |
| `resolve.js` | resolución de golpes (defensa, parry, chequeo, atrapada), KO/TKO, derribos, suelo, sumisiones |
| `ai.js` | IA utilitaria (softmax) por estilo, memoria/lectura del rival, costo de tempo |
| `events.js` | `FIGHT_EVENTS` (contrato) + `FIGHT_EVENTS_EXT` + `ALL_EVENT_TYPES` |
| `rng.js` | sfc32 + `fork`, `int`, `float`, `chance`, `gauss`, `pick`, `softmax` |
| `sim.mjs` | métricas: `node src/fight/sim.mjs --n 500 [--seed S] [--rounds R] [--json] [--core]` (por defecto con `OVERRIDES` de tuning.js; `--core` = núcleo solo). Incluye `minStandGap`: % de ticks de pie bajo `minGap` (debe ser 0) y el bloque `pro` (entropía de 3-gramas de acciones con footwork, combo más repetido, longitud de combo, fintas y fintas castigadas, pivotes/salidas, tiempo contra la reja, entradas al clinch, volumen/min por round, % spam) |
| `../data/moves.js`, `../data/styles.js` | datos de golpes/acciones y 8 estilos |

## API

```js
import { createFightCore, stepCore, runCore, DEFAULT_TUNING, moveToAction } from './core.js';
const F = createFightCore(specA, specB, seed, options);  // estado
const { tick, events } = stepCore(F);                     // 1 tick (1/60 s)
const r = runCore(specA, specB, seed, { keepTicks: true, tailSeconds: 2, ...overrides });
```

**FighterSpec**: `{ id, name, level, style?, stats:{fuerza,velocidad,tecnica,resistencia[,mandibula,cardio,lucha]}, extra?, condition?(0.5–1.1), color?, seed? }`.
También acepta un perfil ya creado con `createFighter` (se usa tal cual). Sin `style` se elige uno determinista según stats.

**runCore → `{ seed, tickRate, ticks, events, winner:'a'|'b'|null, reason:'ko'|'decision'|'draw', method:'KO'|'TKO'|'SUB'|'DEC'|'DRAW', detail, result, stats, inputs, phaseTicks, cards, fighters }`**
- `reason` respeta el contrato: KO, TKO y SUB → `'ko'` (el detalle va en `method`/`detail`: `flash`, `unanswered`, `accumulated`, `body`, `legs`, `groundAndPound`, `doctor`, nombre de la sumisión, `UD|SD|MD`).
- La duración = `ticks.length / TICK_RATE`. Por defecto 3 rounds × 90 s + 3 s de descanso (`roundSeconds`, `restSeconds`, `rounds`).

**Tick** (`tick.a` / `tick.b`):
```js
{ x, hp, maxHp:100, stamina /*0..1*/, action, actionT /*s*/, facing, move, movePhase:'startup'|'active'|'recovery'|null, moveT,
  phase:'stand'|'clinch'|'ground', groundPos:'guard'|'half'|'side'|'mount'|'back'|null, groundRole:'top'|'bottom'|null,
  guard /*0..1*/, rocked, down, momentum, dmg:{head,body,legs} /*0..1+ sobre capacidad*/, sub /*'attacking'|'defending'|null*/,
  animClip /*clip de animación sugerido*/, animSeq /*sube cada vez que arranca un clip nuevo: re-disparar aunque el clip se repita*/ }
// + tick.round, tick.roundT, tick.phase:'stand'|'clinch'|'ground'|'rest'|'over'
// + tick.subProgress 0..1|null, tick.injuries, tick.cutHead/nose/eye, tick.damage (5 zonas)
// Nota: tick.sub es string ('attacking'|'defending'), NO un objeto. El move de la sumisión
// viaja en el evento subAttempt/submission (y en subProgress la presión).
```

## Stats (7) — `FIGHT_STATS`
`fuerza, velocidad, tecnica, resistencia, mandibula, cardio, lucha`. Si faltan las 3 extra se derivan (1..100):
```
mandibula = 0.70·resistencia + 0.30·fuerza
cardio    = 0.65·resistencia + 0.35·velocidad
lucha     = 0.40·fuerza + 0.35·tecnica + 0.25·resistencia + LUCHA_STYLE_BONUS[estilo]
LUCHA_STYLE_BONUS = { wrestler:6, bjj:5, allRounder:2, muayThai:0, brawler:-1, kickboxer:-2, counterpuncher:-2, boxer:-3 }  // exportado en fighter.js
```
⚠ `tuning.js` tiene su propia copia de la tabla con valores viejos (22/20/8/…); conviene que la importe de `fighter.js`.

## Eventos
Todos: `{ tick, type, actor, round, ... }`. Los de golpe/acción agregan
`attacker, defender, move, limb, target:'head'|'body'|'legs', angle, arc:'straight'|'hook'|'upper'|'over'|'knee'|'push'|'shoot'|'spin', power 0..1, hitstop (ticks)`.

| type | extra |
|---|---|
| `strike` | `startup, active, recovery, counter, combo, read, phase` (al iniciar el golpe) |
| `hit` | `damage, counter` |
| `block` | `damage` (chip) |
| `dodge` | `kind:'slip'|'step'|'pummel'` |
| `whiff` | `kind:'miss'|'short'` (al aire / fuera de rango) |
| `parry` | desvío de un recto; abre el contragolpe |
| `check` / `catch` | patada baja chequeada / patada atrapada |
| `feint` | `move, bit:boolean` |
| `action` | inicio de acción no-golpe (derribo, clinch, pase, raspada, getUp…) con `startup, active, recovery` |
| `takedown` | `pos` · `sprawl` `kind:'sprawl'|'knee'|'scramble'|'short'` |
| `clinch` `kind:'entry'` · `break` `reason` |
| `position` | `top, bottom, pos` · `sweep` · `getUp` `kind:'escape'|'knockdown'` |
| `subAttempt` `move` (id de clip Animador) · `subEscape` `kind:'defended'|'escape'` · `submission` `{move,phase,pressure,result:'tap'|'break'|'escape'}` · `tap` (actor = quien se rinde; `injury` si result break) |
| `rocked` `ticks` · `knockdown` `getUpIn, reason` · `ko` `method:'KO'|'TKO', move, koZone, reason` · `stoppage` |

| `block` / `parry` | siempre `target:'head'\|'body'\|'legs'` (Animador: blockHigh/blockBody) |
| `ko` | `method:'KO'\|'TKO'`, `move`, `koZone:'jaw'\|'temple'\|'body'\|'legs'|…`, `reason`/`detail` (TKO). El HIT que causa el KO lleva el mismo `koZone`. |

| `roundStart` · `roundEnd` `cards` · `decision` `winner, kind, cards` · `fightEnd` `result` |

## Acción por tick (propuesta para Motor/Anim)
Del contrato: `idle, walk, guard, jab, cross, kick, hit, block, dodge, ko, victory`. Propuestas (ya en contrato v2):
`clinch, shoot, sprawl, groundTop, groundBottom, getUp, feint, sub`.
Mapeo: patadas/rodillas → `kick`; mano izq./codo → `jab`; mano der. → `cross`; derribo → `shoot`; amago → `feint`;
knockdown → `ko` (con `down:true`); en suelo `groundTop`/`groundBottom` (o `sub` para quien aplica la sumisión).
Para animar mejor, Motor puede leer además `move`, `movePhase`, `moveT`, `groundPos`, `rocked`, `guard`.

### Extras estables por tick y peleador (`tick.a` / `tick.b`; no contractuales, Animador/Motor)
| campo | significado |
|---|---|
| `animClip` | clip exacto de src/anim: `idle guard walk shuffleBack stepIn stepOut pivot circle cutAngle feint jab cross hook uppercut lowKick highKick knee elbow jabJab jabJabCross stepJabJab clinchEntry clinchTie clinchUnderhook clinchKnee clinchElbow block slip hitHead hitBody hitLegs shoot takenDown getUp ko victory` |
| `animSeq` | sube con cada one-shot nuevo (re-dispara el mismo clip) |
| `intent` | `{name, mode:'oneShot'\|'continuous', variant?, dist?}` o `null` (guard/idle/ko/victory). `oneShot`: se dispara una vez por `animSeq` y corre hasta terminar (golpes, feint, stepIn/stepOut, pivot, clinchEntry/Knee/Elbow, jabJab…). `continuous`: dura mientras el tick lo reporte (walk, shuffleBack, circle, cutAngle, clinchTie, clinchUnderhook) |
| `foot` | paso de footwork activo (`advance retreat stepIn stepOut pivot cutAngle circle`) o `null`; también en vivo en `core.fighters[i].foot = {kind, until, dir}` |
| `variant` | `'strike'\|'takedown'` en `feint`, si no `null` (= `intent.variant`; `takedown` → clip `feintTakedown` en Animador) |
| `dist` | largo del paso en px con signo (+ hacia el rival): stepIn +20, stepOut −20, clinchEntry +18, resto 0 (= `intent.dist`) |
| `lunge` | estocada/paso previsto del golpe actual en px hacia facing (`stepInReach`, **varía por golpe** — ver tabla abajo); 0 sin acción / clinch. Motor/Animador: complementary a `intent.rootDx` |
| `step` | px hacia facing movidos **este tick** por la estocada del startup (+ adelante, − atrás); 0 en activo/recovery |

### Formato Arte / Motor (ronda 6)
Campos extra en `tick.a` / `tick.b` (además de `dmg` histórico 3 zonas):
| campo | significado |
|---|---|
| `damage` | `{head,body,legs,armL,armR}` 0..1 |
| `marks` | por zona: `none`\|`bruise`\|`swelling`\|`cut` |
| `injuries` | `{elbowL\|elbowR\|shoulderL\|shoulderR\|…: 'dislocated'\|'broken'}` |
| `cutHead` / `nose` / `eye` | 0..1 cortes faciales |
| `fatigue` | **0..1** (1 = agotado). Siempre presente en `tick.a`/`tick.b` (Motor/Arte/HUD). |
| `subProgress` | 0..1 o `null` si no hay sumisión activa |
| `guard` | 0..1 |
| `lunge` / `step` | estocada prevista / px este tick (facing); finta = 0 |

HIT/TAP pueden llevar `injury: {part, kind}`. Técnicas `expert` (spinningBackfist, flyingKnee, supermanPunch) sólo desde `profile.level >= 10`.

| `orbit` | sólo animación (x sigue 1D): `circle` → `{mode:'continuous', rate: rad/s firmado, dir}`; `pivot` → `{mode:'oneShot', target: rad, dir}`; si no `null`. dir +1 = hacia su mano izquierda |
Combos con clip propio: 2 jabs seguidos del mismo combo → `jabJab` en el 2º; jab-jab-cross → `jabJabCross` en el cross; si hubo `stepIn` ≤60 ticks antes del combo → `stepJabJab`. Tips de impacto (px): jab 91.9, cross 94.1, hook 79.2, uppercut 40.6, lowKick 95, highKick 74, knee 56.2, elbow 68.2, shoot 116.3.
Ritmo: cada round abre con fase de estudio (R1 150–260 ticks, R2 90–170, R3 70–140, menos con urgencia) y tras cada intercambio hay reset (calma) sin golpes; la finta de calma encadena un jab (`FEINT_FOLLOW` 60 ticks).

## DEFAULT_TUNING (core.js)
`rounds 3, roundSeconds 90, restSeconds 3, cage 260, startGap 180, minGap 50, koScale 0.24, damageScale 0.15, levelKeep {velocidad: 0.3}, subInstinct 1.5, legsTko 1.05, legsHunt 0.3, legsToHead 0.8, limbDamageMul 1.9,
tempoCost 1.1, neutralGap 0.35, pace 1.3, tdBias 0, subBias 0, getUpBias 0, standupSeconds 9, clinchBreakSeconds 6, maxSubSeconds 5,
hitstop{base,perDamage,min,max,ko,knockdown,parry,takedown,sweep}, windows{comboCancel,comboStartupMul,counterStartupMul,hitstun,blockstun,dodgeShow}, maxTicks`.
Se pasan como `options` (merge superficial + profundo en `hitstop`/`windows`).

## Modelo (resumen)
- KO por golpe: `ko = dmg·move.ko·(0.35+1.5·headR^1.4)/chin·koScale` (×1.7 rocked, ×1.15 contra); pKO=1−e^(−0.004ko), knockdown 1−e^(−0.014ko), rocked 1−e^(−0.05ko).
- Distancia mínima dura de pie: `minGap 50` px entre pelvis (medido en los clips de src/anim: hombro adelantado de la guardia a 12.8 px del ancla, así que los torsos quedan a ≥24 px; durante el uppercut el hombro llega a 19–22 px y sigue sin cruzar. Las cabezas sí se rozan ~16 px en el pico del uppercut: cosmético, para el Animator). Si se enciman,
  se separan a partes iguales; contra la reja el que no puede retroceder queda en la reja y el otro absorbe todo el empuje.
- Golpes cortos (`short: true` en moves: uppercut, codo y rodilla de pie): ventana sin crédito de estocada (`SHORT_STEP_PX 12`);
  en combos también se revisa la ventana. En clinch, rodillas/codos/uppercut sucio.
- Derribo: bonus multiplicativos (pateando ×1.27, rival striker ×1.33, rocked ×1.67, tras finta ×1.22, setup ×1.18) sobre la prob. base relativa.
- Piernas: TKO por piernas al pasar `legsCap·legsTko`; la IA caza piernas dañadas (`legsHunt`) y sube a la cabeza (`legsToHead`).
- Instinto de sumisión: la IA busca la sumisión contra rival cansado/golpeado/aturdido (`subInstinct`).
- TKO: castigo sin respuesta estando herido, acumulado de cabeza/cuerpo/piernas, ground-and-pound, médico por corte.
- Derribo: `sig(4.5·(ofensa−defensa) − 1.5 + tdBias)`; la defensa sin lectura vale ×0.72; leer depende de startup, telegrafía y reacción.
- Sumisión: trabar `sig(3.5·(sub−defSuelo+posAdj) − 0.9 + subBias)`, luego progreso por ventaja + ruido hasta tap / escape / `maxSubSeconds`.
- Jueces: 3 con pesos propios (daño, control, agresión) y ruido; 10-point must por round.
- Rasgos opcionales de estilo: `powerMul`, `chinMul` (hoy sólo brawler 1.2/1.3).


## Alcances (px, ancla-ancla) — `node src/fight/reach.mjs`
`rangeIdeal` = punta del clip + offset al centro de la zona objetivo; ventana = ideal ± 6 (`REACH_TOL`), redondeado a 0.1.
En el startup temprano (`t < startup`) el atacante da un paso hacia el ideal (adelante ≤ stepInReach, atrás ≤ max(10, 0.8·stepInReach); sin paso atrás si está acorralado).
El tick de impacto y la fase activa/recovery dejan el root anclado (minGap / giros de reja los absorbe el rival) para que Animador no deslice el pie plantado; `tick.lunge`/`tick.step` exponen la estocada prevista.

### Tabla de lunge (`stepInReach`, px; U = PX_PER_M = 85)

`stepInReach(mv)` en `resolve.js` → `tick.lunge`. Antes era plano `0.25·U` (=21.25) para casi todos; ahora varía por golpe/alcance. Clinch = 0 (ya pegados). Bounce AI `ticks` 5–7 / `next` 6–11 evita walk→stepIn+kneeR que con tips CLIP_REACH hundía el pie.

| golpe | lunge | criterio |
|---|---|---|
| jab, cross, overhand, bodyCross | 21.25 (0.25·U) | estocada |
| hook, bodyHook, spinningBackfist | 10.2 (0.12·U) | corto (giro, sin paso largo) |
| uppercut, standElbow, kneeR (`short`) | 12 (`SHORT_STEP_PX`) | corto |
| lowKick, calfKick, highKick, bodyKick, teep | 15.3 (0.18·U) | paso propio de patada |
| clinchKnee, clinchElbow, dirtyUppercut | 0 | ya pegados (`phase==='clinch'`) |
| con `mv.lunge` (supermanPunch, flyingKnee, derribos) | 0.25·U + lunge | override explícito en moves.js |
Si al impacto queda fuera: whiff `'short'` (lejos) o `'jammed'` (atascado). El tick de impacto queda congelado; el teep empuja 6 ticks.
La IA no lanza golpes que quedarían atascados si está acorralada o si el rival está entrando.

| golpe | ventana | ideal | | golpe | ventana | ideal |
|---|---|---|---|---|---|---|
| jab | 94–106 | 99.5 | | teep | 90–102 | 95.9 |
| cross | 97–109 | 103 | | lowKick | 121–133 | 126.9 |
| hook | 81–93 | 86.9 | | bodyKick | 69–81 | 74.9 |
| uppercut | 42–54 | 48.2 | | highKick | 77–89 | 82.8 |
| bodyHook | 73–85 | 79 | | flyingKnee | 59–71 | 65 |
| bodyCross | 89–101 | 95.1 | | standElbow | 71–83 | 77 |

El uppercut de pie (ideal 48.2, ventana ±6 = 42.2–54.2) es alcanzable con `minGap 50` (antes 56 lo dejaba fuera).

`node src/fight/sim.mjs --n N` mide con la config del juego (`effectiveTuning` de index.js + `fightLevel`): matriz de estilos, métodos de victoria por estilo
y `reachErrPx` por golpe (p5/p50/p95; meta |p5|,|p95| ≤ 6).

Campos de estilo opcionales (styles.js): `tdDefense` (multiplica la defensa al derribo, def. 1), `getUpBonus` (logit extra al levantarse, def. 0),
`guillotine` (prob. base de guillotina al leer un derribo y hacer sprawl; si falta = 0.24·sub cuando sub > 0.2), `topControl`, `powerMul`, `chinMul`.
`shootCounter` (prob. de contestar un derribo leído con contra en vez de sprawl; si falta: 0.22+0.1·moveW.flyingKnee para pateadores/brawler, 0.04 resto).
La contra sale como `counterUppercut` (puñeteros, base 11) o `counterKnee` (pateadores, base 13): ids nuevos en `stats.landed` y en los eventos.
Los strikers también tienen `guillotine` > 0 (boxer 0.22, MT/KB 0.08, cp 0.1): su SUB viene de guillotina al shoot y de RNC tras knockdown.
Knockdown + remate (`pounce`): `KD_BACK 0.04` de tomar la espalda; si no, half/guard. Patadas (resolve.js): `HK_LEGS 1.2, HK_BODY 0.8` (boost de la
patada alta con piernas/cuerpo dañados), `BK_FOLD 3` (knockdown por patada al cuerpo), `LG_MIN 0.5, LG_P 1.0` (piernas rotas → caída); `legsTko 1.05`.

## Stats efectivos (fighter.effectiveStats)
`ef = 50 + (media−50)·levelKeep + (s−media)·statSpread + forma` (media = promedio de ambos por stat, forma = gauss·formSd por
peleador/pelea, del RNG de la pelea). Defaults `levelKeep {velocidad: 0.3}` (número u objeto por stat; stat ausente = 0 → sólo cuenta la diferencia con el rival), `statSpread 0.75, formSd 5`. `createRuntime(profile, id, x, facing, eff)`
guarda `f.eff` y deriva `attr` de ahí: el nivel absoluto pesa poco, la diferencia entre ambos mucho (10 vs 10 ≈ 85 vs 85).

## Grappling relativo
`rel(a, b) = REL_K·ln(a/b)` (REL_K 0.6) sobre `prowess` de ataque vs defensa: derribos, sumisiones, pases y levantadas se
deciden por cociente, no por diferencia absoluta. `SUB_DEF_EX 0.25`: exponente de la defensa de suelo en la defensa de sumisión.
Rasgos de estilo nuevos (styles.js): `topControl` 0..1 (luchador 0.7: cuesta levantarse) y `rangeKick` 0..1 (kickboxer 1, muay thai 0.8).

## Controladores (options.controllers) — `controllers.js`
```js
import { createHumanController, createReplayController, AI_CONTROLLER } from './controllers.js';
const human = createHumanController();                       // o { source:(t,F,self)=>intent | intent[] , assist:true }
const F = createFightCore(a, b, seed, { controllers: { a: human, b: 'ai' } });   // default de cada lado: IA
// cada frame, antes de stepCore: intención del jugador (persiste hasta el próximo set)
human.set({ walk: 1 /*-1 atrás,0,1 adelante*/, act: 'jab' /*moveId|null, se consume*/, feint: false, block: true, slip: false });
const { tick, events } = stepCore(F);
// replay exacto: F.inputs = [{ t, side, intent }] (sólo cambios); runCore lo devuelve como r.inputs
runCore(a, b, seed, { controllers: { a: createReplayController(r.inputs, 'a') } });  // mismos eventos
```
- Interfaz: `{ decide(F,self,opp), readP?(F,def,att,move,p), chooseDefense?(F,def,att,move), poll?(F,self), autoCounter? }`.
  Lo que falta cae a la IA (`F.ai` sigue siendo el módulo ai.js para observe/readBonus/etc.).
- Humano: defensa manual (block → bloqueo/check/sprawl; slip → esquiva o paso atrás) con lectura ≥0.9 si está apretada
  y 0 si no. Tras defender, el próximo golpe en ≤18 ticks sale como contra (no hay contra automático). `assist` deja
  suelo/clinch a la IA si no hay `act`. Sin RNG propio: mismas entradas por tick ⇒ misma pelea.
