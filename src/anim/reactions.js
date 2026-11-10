// reactions.js — reacciones a golpes por zona, aturdido (rocked), KO, y levantarse. Mismos canales/keyframes que clips.js.
//   hurt_head / hurt_body / hurt_legs : el golpe YA conectó => la pose se vuelve pico en ~60 ms y se recupera (0.5-0.62 s). Empiezan y terminan en 0.
//   rocked : aturdido SOSTENIDO (hold + vaivén procedural) hasta que la sim lo suelte (anim.cancel() o setState).
//   ko     : cae de espaldas (≈0.9 s), queda tendido (hold).      getUp : del suelo a la guardia (≈1.5 s), arranca EXACTAMENTE donde termina ko.
// La sim es dueña de la raíz: todo esto es pose (pelvis/pie/torso relativos a ella); sin root motion.
import { CLIPS, sampleTrack } from './clips.js';

const K = (t, v, e = 'easeInOutQuad') => [t, v, e];
const Q = 'easeOutQuad';
const ph = (d, a, b) => [{ name: 'impact', t0: 0, t1: a }, { name: 'react', t0: a, t1: b }, { name: 'recover', t0: b, t1: d }];

// ------------------------------------------------------------------ golpe a la CABEZA: latigazo atrás, mentón arriba, guardia se abre
export const HURT_HEAD = {
  name: 'hurt_head', duration: 0.56, impactT: 0.0, tip: 'L', phases: ph(0.56, 0.07, 0.30), feet: true,
  tracks: {
    // ronda 3: latigazo claro: la CABEZA se va atrás/arriba y gira (~-0.85 rad respecto del pecho; -1.1 se veía como cuello roto), el torso sólo acompaña un poco; rebote hacia adelante y asienta.
    hdPitch: [K(0, 0), K(0.07, -0.85, Q), K(0.15, -0.72), K(0.26, -0.36), K(0.36, 0.18), K(0.46, 0.07), K(0.56, 0)],
    hdYaw:   [K(0, 0), K(0.07, -0.60, Q), K(0.20, -0.42), K(0.40, -0.05), K(0.56, 0)],
    hdRoll:  [K(0, 0), K(0.07, 0.34, Q), K(0.22, 0.16), K(0.40, -0.04), K(0.56, 0)],
    spPitch: [K(0, 0), K(0.08, -0.30, Q), K(0.22, -0.24), K(0.40, 0.04), K(0.56, 0)],
    spYaw:   [K(0, 0), K(0.08, -0.16, Q), K(0.24, -0.10), K(0.56, 0)],
    hipPitch:[K(0, 0), K(0.09, -0.14, Q), K(0.26, -0.10), K(0.56, 0)],
    pz:      [K(0, 0), K(0.09, -0.10, Q), K(0.26, -0.07), K(0.56, 0)],
    dy:      [K(0, 0), K(0.08, -0.03, Q), K(0.24, -0.02), K(0.56, 0)],
    shrugL:  [K(0, 0), K(0.07, 0.10, Q), K(0.56, 0)], shrugR: [K(0, 0), K(0.07, 0.10, Q), K(0.56, 0)],
    hLz:     [K(0, 0), K(0.08, -0.05, Q), K(0.24, -0.03), K(0.56, 0)], hRz: [K(0, 0), K(0.08, -0.05, Q), K(0.24, -0.03), K(0.56, 0)],
    hLy:     [K(0, 0), K(0.09, -0.07, Q), K(0.26, -0.05), K(0.56, 0)], hRy: [K(0, 0), K(0.09, -0.07, Q), K(0.26, -0.05), K(0.56, 0)],
    hLx:     [K(0, 0), K(0.09, 0.05, Q), K(0.56, 0)], hRx: [K(0, 0), K(0.09, 0.06, Q), K(0.56, 0)],
  },
};

// ronda 6: con contacto real el primer frame del latigazo (ease-out desde 0) movía el codo/cabeza del golpeado ~0,14–0,16 m (>0,13 m/frame
// a power 1). El primer tramo pasa a lineal: misma llegada al pico (0,07–0,09 s), la mitad de velocidad máxima.
for (const ch in HURT_HEAD.tracks) {
  const tr = HURT_HEAD.tracks[ch];
  if (tr.length > 1 && tr[0][0] === 0 && tr[1][2] === Q) tr[1] = K(tr[1][0], tr[1][1], 'linear');
}

// ------------------------------------------------------------------ golpe al CUERPO: se dobla sobre el estómago, codos abajo, aire fuera
export const HURT_BODY = {
  name: 'hurt_body', duration: 0.64, impactT: 0.0, tip: 'L', phases: ph(0.64, 0.09, 0.36), feet: true,
  tracks: {
    spPitch: [K(0, 0), K(0.09, 0.55, Q), K(0.28, 0.48), K(0.48, 0.12), K(0.64, 0)],
    hipPitch:[K(0, 0), K(0.09, 0.26, Q), K(0.28, 0.22), K(0.48, 0.05), K(0.64, 0)],
    hdPitch: [K(0, 0), K(0.10, 0.20, Q), K(0.30, 0.18), K(0.64, 0)],
    pz:      [K(0, 0), K(0.09, -0.10, Q), K(0.28, -0.08), K(0.64, 0)],
    dy:      [K(0, 0), K(0.10, -0.08, Q), K(0.30, -0.07), K(0.50, -0.02), K(0.64, 0)],
    shrugL:  [K(0, 0), K(0.09, 0.10, Q), K(0.64, 0)], shrugR: [K(0, 0), K(0.09, 0.10, Q), K(0.64, 0)],
    protL:   [K(0, 0), K(0.09, 0.12, Q), K(0.64, 0)], protR: [K(0, 0), K(0.09, 0.12, Q), K(0.64, 0)],
    hLy:     [K(0, 0), K(0.10, -0.20, Q), K(0.30, -0.18), K(0.50, -0.04), K(0.64, 0)], hRy: [K(0, 0), K(0.10, -0.18, Q), K(0.30, -0.16), K(0.50, -0.04), K(0.64, 0)],
    hLz:     [K(0, 0), K(0.10, 0.03, Q), K(0.64, 0)], hRz: [K(0, 0), K(0.10, 0.02, Q), K(0.64, 0)],
    hLx:     [K(0, 0), K(0.10, -0.08, Q), K(0.64, 0)], hRx: [K(0, 0), K(0.10, -0.10, Q), K(0.64, 0)],
    elbL:    [K(0, 0), K(0.10, 0.2, Q), K(0.64, 0)], elbR: [K(0, 0), K(0.10, 0.2, Q), K(0.64, 0)],
  },
};

// ------------------------------------------------------------------ golpe a las PIERNAS (low kick): la pierna adelantada cede, se hunde de lado
export const HURT_LEGS = {
  name: 'hurt_legs', duration: 0.60, impactT: 0.0, tip: 'L', phases: ph(0.60, 0.10, 0.32), feet: true,
  tracks: {
    // ronda 3: la pierna golpeada (adelantada, L) CEDE: la rodilla se dobla y el pie se descarga (se levanta/retrae), el peso se va al pie trasero (pelvis hacia R).
    dy:      [K(0, 0), K(0.12, -0.20, Q), K(0.26, -0.17), K(0.46, -0.05), K(0.60, 0)],
    px:      [K(0, 0), K(0.12, -0.10, Q), K(0.26, -0.09), K(0.46, -0.02), K(0.60, 0)],
    hipRoll: [K(0, 0), K(0.10, 0.20, Q), K(0.28, 0.14), K(0.60, 0)],
    spRoll:  [K(0, 0), K(0.10, -0.18, Q), K(0.28, -0.12), K(0.60, 0)],
    spPitch: [K(0, 0), K(0.10, 0.12, Q), K(0.60, 0)],
    hdRoll:  [K(0, 0), K(0.10, -0.10, Q), K(0.60, 0)],
    hdPitch: [K(0, 0), K(0.10, 0.12, Q), K(0.30, 0.06), K(0.60, 0)],
    fLy:     [K(0, 0), K(0.10, 0.11, Q), K(0.22, 0.07), K(0.34, 0.0, 'easeInQuad'), K(0.60, 0)],
    fLz:     [K(0, 0), K(0.10, -0.14, Q), K(0.24, -0.12), K(0.40, 0, 'easeInOutQuad'), K(0.60, 0)],
    fLx:     [K(0, 0), K(0.10, -0.04, Q), K(0.24, -0.03), K(0.40, 0), K(0.60, 0)],
    fLpitch: [K(0, 0), K(0.10, -0.35, Q), K(0.24, -0.25), K(0.36, 0), K(0.60, 0)],
    hLy:     [K(0, 0), K(0.10, -0.08, Q), K(0.60, 0)], hRy: [K(0, 0), K(0.10, 0.05, Q), K(0.60, 0)],
    hRx:     [K(0, 0), K(0.10, 0.12, Q), K(0.60, 0)], hLx: [K(0, 0), K(0.10, 0.10, Q), K(0.60, 0)],
    elvR:    [K(0, 0), K(0.10, 0.3, Q), K(0.60, 0)], elvL: [K(0, 0), K(0.10, 0.3, Q), K(0.60, 0)],
    elbR:    [K(0, 0), K(0.10, 0.2, Q), K(0.60, 0)], elbL: [K(0, 0), K(0.10, 0.2, Q), K(0.60, 0)],
  },
};

// ------------------------------------------------------------------ ROCKED: aturdido sostenido. Entra en 0.35 s y se queda con un vaivén lento (capa procedural).
export const ROCKED = {
  name: 'rocked', duration: 0.45, impactT: 0.0, tip: 'L', hold: true, feet: true, phases: [{ name: 'enter', t0: 0, t1: 0.1 }, { name: 'react', t0: 0.1, t1: 0.45 }, { name: 'hold', t0: 0.45, t1: 0.45 }],
  tracks: {
    dy:      [K(0, 0), K(0.25, -0.13, Q), K(0.45, -0.15)],
    spPitch: [K(0, 0), K(0.3, 0.22, Q), K(0.45, 0.24)],
    hipPitch:[K(0, 0), K(0.3, 0.10, Q), K(0.45, 0.10)],
    hdPitch: [K(0, 0), K(0.3, 0.26, Q), K(0.45, 0.28)],
    hdRoll:  [K(0, 0), K(0.3, 0.14, Q), K(0.45, 0.14)],
    hipRoll: [K(0, 0), K(0.3, 0.06), K(0.45, 0.06)],
    shrugL:  [K(0, 0), K(0.3, -0.10, Q), K(0.45, -0.10)], shrugR: [K(0, 0), K(0.3, -0.10, Q), K(0.45, -0.10)],
    hLy:     [K(0, 0), K(0.3, -0.30, Q), K(0.45, -0.30)], hRy: [K(0, 0), K(0.3, -0.32, Q), K(0.45, -0.32)],
    hLz:     [K(0, 0), K(0.3, -0.04, Q), K(0.45, -0.04)], hRz: [K(0, 0), K(0.3, -0.05, Q), K(0.45, -0.05)],
    hLx:     [K(0, 0), K(0.3, 0.12, Q), K(0.45, 0.12)], hRx: [K(0, 0), K(0.3, 0.14, Q), K(0.45, 0.14)],
    elbL:    [K(0, 0), K(0.3, 0.35, Q), K(0.45, 0.35)], elbR: [K(0, 0), K(0.3, 0.35, Q), K(0.45, 0.35)],
    fLx:     [K(0, 0), K(0.3, 0.06, Q), K(0.45, 0.06)], fRx: [K(0, 0), K(0.3, -0.06, Q), K(0.45, -0.06)],
  },
  // vaivén (th = s desde que quedó sostenido): peso de un pie al otro y cabeza que cabecea. Amplitud pequeña (sin pops).
  holdLayer(th, c) {
    const s = Math.sin(6.4 * th), s2 = Math.sin(4.1 * th + 1.0);
    c.px += 0.035 * s; c.hipRoll += 0.07 * s; c.spRoll += -0.06 * s; c.hdRoll += -0.06 * s2; c.pz += 0.025 * s2; c.hdPitch += 0.05 * s2;
    c.hLy += 0.02 * s2; c.hRy += -0.02 * s2;
  },
};

// ------------------------------------------------------------------ KO (ronda 4): PESO MUERTO, sin pelear con la IK.
// En el instante del KO se cortan la guardia y el tono (las manos caen), las piernas pasan a FK (kw: 0 -> 1 en 0.12 s) y las RODILLAS se doblan
// hacia adelante y abajo: la pelvis cae casi en caída libre (ease-in) hasta quedar sentada sobre los talones con las piernas PLEGADAS debajo;
// después el tronco se vuelca de espaldas y queda tendido con las piernas plegadas (rodillas a la altura de la cadera, no hacia arriba). Hold.
// Valores finales (deltas sobre la guardia) — getUp arranca desde ellos.
export const KO_END = Object.freeze({
  dy: -0.67, pz: -0.12, px: 0.0, hipPitch: -1.45, spPitch: -0.04, hdPitch: -0.20, hdRoll: 0.14, hdYaw: 0.3, hipYaw: 0.25, hipRoll: 0.06, spYaw: -0.1,
  hLx: 0.48, hLy: -0.07, hLz: -0.08, hRx: -0.38, hRy: -0.05, hRz: 0.30, elbL: -0.2, elbR: 0.25, shrugL: -0.08, shrugR: -0.08, elvL: 1, elvR: 1,
  kw: 1, kHL: 0.20, kKL: 2.90, kAL: 0.20, kFL: 1.0, kHR: 0.12, kKR: 2.92, kAR: 0.28, kFR: 1.0,
});
const E0 = KO_END, LN = 'linear', EI = 'easeInQuad';
export const KO = {
  name: 'ko', duration: 1.20, impactT: 0.0, tip: 'L', hold: true, feet: true,
  phases: [{ name: 'snap', t0: 0, t1: 0.08 }, { name: 'buckle', t0: 0.08, t1: 0.42 }, { name: 'topple', t0: 0.42, t1: 0.85 }, { name: 'settle', t0: 0.85, t1: 1.20 }],
  tracks: {
    // piernas FK: arranca en la flexión de la guardia (cadera ≈0.56, rodilla ≈1.15 rad) y se pliega
    kw:  [K(0, 0), K(0.12, 1, EI), K(1.2, 1, LN)],
    kHL: [K(0, 0), K(0.02, 0.56, LN), K(0.12, 0.72), K(0.26, 1.10), K(0.42, 1.45), K(0.56, 1.15), K(0.72, 0.55), K(0.86, 0.22), K(1.0, 0.20), K(1.2, E0.kHL)],
    kKL: [K(0, 0), K(0.02, 1.15, LN), K(0.12, 1.35), K(0.26, 2.00), K(0.42, 2.55), K(0.60, 2.70), K(0.86, 2.86), K(1.2, E0.kKL)],
    kHR: [K(0, 0), K(0.02, 0.50, LN), K(0.12, 0.66), K(0.26, 1.02), K(0.42, 1.38), K(0.56, 1.08), K(0.72, 0.44), K(0.86, 0.12), K(1.0, 0.12), K(1.2, E0.kHR)],
    kKR: [K(0, 0), K(0.02, 1.15, LN), K(0.12, 1.30), K(0.26, 1.95), K(0.42, 2.52), K(0.60, 2.70), K(0.86, 2.88), K(1.2, E0.kKR)],
    kAL: [K(0, 0), K(0.42, 0.12), K(1.2, E0.kAL)], kAR: [K(0, 0), K(0.42, 0.18), K(1.2, E0.kAR)],
    kFL: [K(0, 0), K(0.20, 0), K(0.42, 0.9), K(1.2, E0.kFL)], kFR: [K(0, 0), K(0.20, 0), K(0.42, 0.9), K(1.2, E0.kFR)],
    // pelvis: cae como peso muerto (ease-in) hasta sentarse sobre los talones, mínimo rebote, y se va de espaldas
    dy:      [K(0, 0), K(0.06, -0.02), K(0.42, -0.46, EI), K(0.50, -0.45), K(0.84, -0.68, EI), K(0.94, -0.65), K(1.2, E0.dy)],
    pz:      [K(0, 0), K(0.42, 0.04), K(0.80, -0.14), K(1.2, E0.pz)],
    // ronda 5 (Rick): sin el instante "arrodillado erguido": desde que se doblan las rodillas el tronco ya se va hacia ATRÁS y al COSTADO
    // (cae del lado izquierdo) y sigue en esa dirección hasta el suelo: con las rodillas en el suelo nunca queda a menos de ~35° de la vertical.
    hipPitch:[K(0, 0), K(0.10, -0.08), K(0.30, -0.55), K(0.44, -0.74), K(0.62, -1.02, EI), K(0.82, -1.50, EI), K(0.94, -1.40), K(1.2, E0.hipPitch)],
    spPitch: [K(0, 0), K(0.12, 0.10), K(0.30, 0.02), K(0.60, -0.04), K(1.2, E0.spPitch)],
    hipRoll: [K(0, 0), K(0.12, 0.10), K(0.30, 0.40), K(0.50, 0.46), K(0.80, 0.30), K(1.0, 0.12), K(1.2, E0.hipRoll)],
    spRoll:  [K(0, 0), K(0.30, 0.10), K(0.70, 0.06), K(1.2, 0)],
    hipYaw:  [K(0, 0), K(0.5, 0.10), K(1.2, E0.hipYaw)], spYaw: [K(0, 0), K(1.2, E0.spYaw)],
    // cabeza: latigazo del golpe, cae sobre el pecho (sin tono) y golpea el suelo al volcar
    hdPitch: [K(0, 0), K(0.06, -0.35, Q), K(0.26, 0.35), K(0.56, 0.32), K(0.70, 0.10), K(0.88, -0.26), K(1.02, -0.15), K(1.2, E0.hdPitch)],
    hdYaw:   [K(0, 0), K(0.06, -0.20, Q), K(0.5, 0.1), K(1.2, E0.hdYaw)],
    hdRoll:  [K(0, 0), K(0.3, 0.12), K(1.2, E0.hdRoll)],
    shrugL:  [K(0, 0), K(0.10, -0.10, Q), K(1.2, E0.shrugL)], shrugR: [K(0, 0), K(0.10, -0.10, Q), K(1.2, E0.shrugR)],
    // brazos: el tono se corta YA (las manos caen en 0.10 s) y al volcar quedan abiertos a los lados
    hLy: [K(0, 0), K(0.15, -0.26, Q), K(0.42, -0.34), K(0.64, -0.40), K(0.92, -0.02), K(1.2, E0.hLy)], hRy: [K(0, 0), K(0.15, -0.26, Q), K(0.42, -0.34), K(0.64, -0.40), K(0.92, -0.02), K(1.2, E0.hRy)],
    hLx: [K(0, 0), K(0.15, 0.06, Q), K(0.42, 0.10), K(0.66, 0.14), K(0.92, 0.42), K(1.2, E0.hLx)], hRx: [K(0, 0), K(0.15, -0.04, Q), K(0.42, -0.08), K(0.66, -0.12), K(0.92, -0.34), K(1.2, E0.hRx)],
    hLz: [K(0, 0), K(0.15, -0.08, Q), K(0.42, -0.06), K(0.85, -0.06), K(1.2, E0.hLz)], hRz: [K(0, 0), K(0.15, -0.08, Q), K(0.42, -0.02), K(0.85, 0.20), K(1.2, E0.hRz)],
    elbL: [K(0, 0), K(0.1, 0.1), K(1.2, E0.elbL)], elbR: [K(0, 0), K(0.1, 0.1), K(1.2, E0.elbR)],
    elvL: [K(0, 0), K(0.30, 0.2), K(0.95, 1, LN), K(1.2, 1)], elvR: [K(0, 0), K(0.30, 0.2), K(0.95, 1, LN), K(1.2, 1)],
  },
};

// ronda 5: los muslos conservan la dirección en el MUNDO del KO de r4 (rodillas adelante/abajo, la trasera nunca sobre la cadera) aunque la pelvis
// ahora se incline atrás antes: kH nuevo = (kH − hipPitch) de r4 + hipPitch nuevo (hipPitch < 0 = atrás, kH > 0 = muslo adelante).
(function bakeKoThighs() {
  const T = KO.tracks, oldPitch = [K(0, 0), K(0.26, 0.24), K(0.42, 0.20), K(0.50, 0.02), K(0.60, -0.45), K(0.82, -1.50, EI), K(0.94, -1.40), K(1.2, E0.hipPitch)];
  for (const c of ['kHL', 'kHR']) {
    const old = T[c], k = [];
    for (let t = 0; t <= 1.2 + 1e-9; t += 0.02) { const tt = Math.min(1.2, +t.toFixed(3)); k.push(K(tt, tt === 0 ? 0 : sampleTrack(old, tt) - sampleTrack(oldPitch, tt) + sampleTrack(T.hipPitch, tt), LN)); }
    k[k.length - 1] = K(1.2, E0[c], LN); T[c] = k;
  }
})();

// ------------------------------------------------------------------ GET UP: del tendido con piernas plegadas se sienta sobre los talones (FK),
// se levanta a cuclillas mientras las piernas vuelven a la IK sobre los pies plantados (kw 1 -> 0) y se para en guardia. Termina en 0 => guardia.
const E = KO_END;
const GU = (c) => E[c] ?? 0;
export const GETUP = {
  name: 'getUp', duration: 1.60, impactT: 0.0, tip: 'L', from: 'ko', feet: true,
  phases: [{ name: 'sit', t0: 0, t1: 0.55 }, { name: 'crouch', t0: 0.55, t1: 1.10 }, { name: 'stand', t0: 1.10, t1: 1.6 }],
  tracks: {
    kw:  [K(0, 1), K(0.70, 1, LN), K(1.10, 0), K(1.6, 0)],
    kHL: [K(0, GU('kHL')), K(0.15, GU('kHL')), K(0.55, 1.45), K(0.85, 1.25), K(1.10, 0.56), K(1.6, 0)],
    kHR: [K(0, GU('kHR')), K(0.15, GU('kHR')), K(0.55, 1.40), K(0.85, 1.20), K(1.10, 0.50), K(1.6, 0)],
    kKL: [K(0, GU('kKL')), K(0.15, GU('kKL')), K(0.55, 2.55), K(0.85, 2.05), K(1.10, 1.15), K(1.6, 0)],
    kKR: [K(0, GU('kKR')), K(0.15, GU('kKR')), K(0.55, 2.52), K(0.85, 2.00), K(1.10, 1.15), K(1.6, 0)],
    kAL: [K(0, GU('kAL')), K(0.55, 0.12), K(1.10, 0), K(1.6, 0)], kAR: [K(0, GU('kAR')), K(0.55, 0.16), K(1.10, 0), K(1.6, 0)],
    kFL: [K(0, GU('kFL')), K(0.55, 0.9), K(0.85, 0.4), K(1.05, 0), K(1.6, 0)], kFR: [K(0, GU('kFR')), K(0.55, 0.9), K(0.85, 0.4), K(1.05, 0), K(1.6, 0)],
    dy:      [K(0, GU('dy')), K(0.10, GU('dy')), K(0.60, -0.50), K(0.85, -0.30), K(1.15, -0.12), K(1.6, 0)],
    pz:      [K(0, GU('pz')), K(0.15, GU('pz')), K(0.55, 0.04), K(0.85, 0.02), K(1.15, 0.0), K(1.6, 0)],
    hipPitch:[K(0, GU('hipPitch')), K(0.10, GU('hipPitch')), K(0.60, 0.22), K(0.85, 0.40), K(1.15, 0.26), K(1.6, 0)],
    spPitch: [K(0, GU('spPitch')), K(0.10, GU('spPitch')), K(0.60, 0.20), K(0.85, 0.30), K(1.15, 0.20), K(1.6, 0)],
    hdPitch: [K(0, GU('hdPitch')), K(0.15, -0.05), K(0.55, 0.05), K(0.85, 0.0), K(1.6, 0)],
    hdRoll:  [K(0, GU('hdRoll')), K(0.55, 0.03), K(1.6, 0)],
    hdYaw:   [K(0, GU('hdYaw')), K(0.55, 0.2), K(1.6, 0)],
    hipYaw:  [K(0, GU('hipYaw')), K(0.15, GU('hipYaw')), K(0.60, 0.1), K(1.0, 0.0), K(1.6, 0)],
    hipRoll: [K(0, GU('hipRoll')), K(1.6, 0)], spYaw: [K(0, GU('spYaw')), K(0.6, 0.0), K(1.6, 0)],
    shrugL:  [K(0, GU('shrugL')), K(1.6, 0)], shrugR: [K(0, GU('shrugR')), K(1.6, 0)],
    // manos: se apoyan adelante para empujar, luego suben a la guardia
    hLx: [K(0, GU('hLx')), K(0.15, GU('hLx')), K(0.62, 0.20), K(0.85, 0.10), K(1.2, 0.02), K(1.6, 0)], hRx: [K(0, GU('hRx')), K(0.15, GU('hRx')), K(0.62, -0.20), K(0.85, -0.05), K(1.2, 0.0), K(1.6, 0)],
    hLy: [K(0, GU('hLy')), K(0.15, GU('hLy')), K(0.62, -0.24), K(0.85, -0.22), K(1.2, -0.04), K(1.6, 0)], hRy: [K(0, GU('hRy')), K(0.15, GU('hRy')), K(0.62, -0.24), K(0.85, -0.22), K(1.2, -0.04), K(1.6, 0)],
    hLz: [K(0, GU('hLz')), K(0.15, GU('hLz')), K(0.62, 0.20), K(0.85, 0.08), K(1.2, 0.0), K(1.6, 0)], hRz: [K(0, GU('hRz')), K(0.15, GU('hRz')), K(0.62, 0.18), K(0.85, 0.08), K(1.2, 0.0), K(1.6, 0)],
    elvL: [K(0, 1), K(0.4, 1), K(0.9, 0.2), K(1.6, 0)], elvR: [K(0, 1), K(0.4, 1), K(0.9, 0.2), K(1.6, 0)],
    elbL: [K(0, GU('elbL')), K(0.5, 0.1), K(1.6, 0)], elbR: [K(0, GU('elbR')), K(0.5, 0.1), K(1.6, 0)],
  },
};
for (const c in KO_END) if (!GETUP.tracks[c]) GETUP.tracks[c] = [K(0, GU(c)), K(0.15, GU(c)), K(1.3, 0), K(1.6, 0)];

export const REACTIONS = { hurt_head: HURT_HEAD, hurt_body: HURT_BODY, hurt_legs: HURT_LEGS, rocked: ROCKED, ko: KO, getUp: GETUP };
Object.assign(CLIPS, REACTIONS);
export const ZONE_CLIP = Object.freeze({ head: 'hurt_head', body: 'hurt_body', legs: 'hurt_legs' });
