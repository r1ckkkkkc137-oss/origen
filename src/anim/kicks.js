// kicks.js — ronda 7: patada MEDIA (al cuerpo, costillas) y ALTA (cabeza/cuello) con la pierna trasera (R), clips propios (no el low kick).
// Mismos canales que clips.js. Cadena cinética desde la cadera: 1) el pie de apoyo (L) da un paso corto en el aire y PIVOTA sobre la bola
// (talón hacia el blanco, ~85–95°), 2) la CADERA gira entera con ease-in y se vuelca (hipRoll: la cadera de la pierna que patea sube),
// el torso se inclina hacia atrás/afuera de contrapeso, 3) la RODILLA se carga (chamber: sube plegada al costado) y 4) la tibia se
// despliega ÚLTIMA con ease-in fuerte => pico de velocidad de la espinilla EN el impacto. Hit-stop HITSTOP con el peso adentro, la
// pierna se repliega por el mismo arco (rodilla arriba) y baja a su sitio; el pie de apoyo desanda el pivote.
// Punta de contacto: espinilla baja (kickFrac = fracción desde el tobillo hacia la rodilla). Media: 30 % (espinilla); alta: 15 % (empeine/espinilla baja).
// Tiempos de la sim (src/combat/data/moves.js): bodyKick [16,4,20], highKick [19,4,24] ticks a 60 Hz.
import { CLIPS, HITSTOP } from './clips.js';

const K = (t, v, e = 'easeInOutQuad') => [t, v, e];
const EI = 'easeInQuad', EO = 'easeOutQuad', LIN = 'linear';
export const KICK_TICKS = Object.freeze({ bodykick: [16, 4, 20], highkick: [19, 4, 24] });

// p: parámetros (marco de cara: x izq, y arriba, z adelante; pie R en reposo = [-0.19, 0, -0.22] respecto de la raíz)
function roundKick(name, p) {
  const [s, a, r] = KICK_TICKS[name], I = s / 60, D = (s + a + r) / 60, H = I + HITSTOP;
  const tC = I * p.chamberAt, tL = 0.07 * I / 0.267;             // tC: rodilla cargada; tL: el pie de apoyo aterriza del paso
  const tR1 = H + 0.13, tR2 = H + 0.25, tR3 = H + 0.33;          // replegar (rodilla arriba) -> bajar -> pie en su sitio
  const A = p.ankle, C = p.chamber, B = p.back;
  const tracks = {
    dy:      [K(0, 0), K(tL, -0.025, EO), K(I, p.dy, EI), K(H, p.dy - 0.01), K(tR2, -0.02), K(D, 0)],
    px:      [K(0, 0), K(tL, 0.04), K(I, p.px), K(tR2, 0.04), K(D, 0)],
    pz:      [K(0, 0), K(tL, 0.10), K(I, p.pz, EI), K(H, p.pz + 0.015), K(tR1, p.pz * 0.75), K(tR3, 0.02), K(D, 0)],
    hipYaw:  [K(0, 0), K(0.05, -0.10, EO), K(I - 0.02, p.hipYaw, EI), K(H, p.hipYaw - 0.03), K(tR1, p.hipYaw * 0.6), K(tR3, 0.05), K(D, 0)],
    hipRoll: [K(0, 0), K(tC, p.hipRoll * 0.4), K(I, p.hipRoll, EI), K(H, p.hipRoll), K(tR2, p.hipRoll * 0.3), K(D, 0)],
    hipPitch:[K(0, 0), K(I, p.hipPitch), K(tR2, 0), K(D, 0)],
    spYaw:   [K(0, 0), K(0.05, 0), K(I, p.spYaw), K(tR1, p.spYaw * 0.6), K(tR3, 0), K(D, 0)],
    spRoll:  [K(0, 0), K(I, p.spRoll), K(tR1, p.spRoll * 0.6), K(D, 0)],
    spPitch: [K(0, 0), K(tL, -0.05), K(I, p.spPitch), K(H, p.spPitch - 0.02), K(tR2, -0.08), K(D, 0)],
    hdPitch: [K(0, 0), K(I, p.hdPitch), K(tR2, 0.05), K(D, 0)],
    hdYaw:   [K(0, 0), K(I, p.hdYaw), K(tR1, p.hdYaw * 0.6), K(D, 0)],
    hdRoll:  [K(0, 0), K(I, p.hdRoll), K(tR2, 0), K(D, 0)],
    // brazo del lado que patea: baja y va atrás (contrapeso, cadena cinética); la izquierda tapa la cara
    hRx: [K(0, 0), K(I, p.armR[0]), K(tR2, p.armR[0] * 0.3), K(D, 0)],
    hRy: [K(0, 0), K(I, p.armR[1]), K(tR2, p.armR[1] * 0.3), K(D, 0)],
    hRz: [K(0, 0), K(I, p.armR[2]), K(tR2, p.armR[2] * 0.3), K(D, 0)],
    elvR: [K(0, 0), K(I, 0.25), K(tR2, 0.05), K(D, 0)],
    hLx: [K(0, 0), K(I, -0.03), K(D, 0)], hLy: [K(0, 0), K(I, 0.03), K(D, 0)], hLz: [K(0, 0), K(I, -0.04), K(D, 0)],
    // pie de apoyo (L): paso corto afuera/adelante en el aire (aterriza en tL) y pivote sobre la bola (talón hacia el blanco)
    fLx:     [K(0, 0), K(tL, p.step[0]), K(tR2, p.step[0], LIN), K(tR3, 0), K(D, 0)],
    fLz:     [K(0, 0), K(tL, p.step[1]), K(tR2, p.step[1], LIN), K(tR3, 0), K(D, 0)],
    fLy:     [K(0, 0), K(tL * 0.45, 0.035, EO), K(tL, 0, EI), K(tR2, 0, LIN), K((tR2 + tR3) / 2, 0.03, EO), K(tR3, 0, EI), K(D, 0)],
    fLyaw:   [K(0, 0), K(tL, 0.1), K(I, p.pivot, EI), K(tR1, p.pivot, LIN), K(tR3, 0), K(D, 0)],
    fLpitch: [K(0, 0), K(tL + 0.01, -0.1), K(I, -0.55), K(tR1, -0.5, LIN), K(tR3, 0), K(D, 0)],
    // pie que patea (R): despega -> rodilla cargada (tC) -> la tibia se despliega con ease-in hasta el blanco -> hit-stop -> repliega -> baja
    fRx: [K(0, 0), K(0.05, 0.0), K(tC, C[0]), K(I, A[0], EI), K(H, A[0], LIN), K(tR1, B[0]), K(tR2, 0.02), K(tR3, 0), K(D, 0)],
    fRy: [K(0, 0), K(0.05, 0.07, EO), K(tC, C[1]), K(I, A[1], EI), K(H, A[1], LIN), K(tR1, B[1]), K(tR2, 0.06, EI), K(tR3, 0), K(D, 0)],
    fRz: [K(0, 0), K(0.05, 0.06), K(tC, C[2]), K(I, A[2], EI), K(H, A[2], LIN), K(tR1, B[2]), K(tR2, 0.04), K(tR3, 0), K(D, 0)],
    fRyaw: [K(0, 0), K(tC, 0.6), K(I, p.footYaw), K(tR1, 0.8), K(tR3, 0), K(D, 0)],
    fRpitch: [K(0, 0), K(tC, -0.3), K(I, -0.6), K(tR1, -0.5), K(tR3, 0), K(D, 0)],
    ptR: [K(0, 0), K(0.05, 0.2), K(tC, 0.85), K(I - 0.03, 1), K(tR1, 1, LIN), K(tR2, 0.2), K(tR3, 0), K(D, 0)],   // empeine en la línea de la tibia
  };
  return {
    name, duration: D, impactT: I, tip: 'kickR', kickFrac: p.kickFrac, feet: true, ball: { L: true },
    phases: [{ name: 'anticipation', t0: 0, t1: tC * 0.5 }, { name: 'strike', t0: tC * 0.5, t1: H + 0.025 }, { name: 'recovery', t0: H + 0.025, t1: D }],
    tracks,
  };
}

export const KICK_PARAMS = {
  bodykick: {
    chamberAt: 0.68, kickFrac: 0.55, dy: 0.03, px: 0.07, pz: 0.20, hipYaw: 1.30, hipRoll: -0.30, hipPitch: -0.05, spYaw: 0.10, spRoll: -0.15, spPitch: -0.10,
    hdPitch: 0.20, hdYaw: -0.60, hdRoll: 0.15, armR: [-0.10, -0.22, -0.22], step: [0.06, 0.10], pivot: 1.50, footYaw: 1.2,
    ankle: [-0.01, 0.97, 1.29], chamber: [-0.21, 0.62, 0.42], back: [-0.16, 0.57, 0.57],
  },
  highkick: {
    chamberAt: 0.58, kickFrac: 0.15, dy: 0.10, px: 0.08, pz: 0.29, hipYaw: 1.40, hipRoll: -0.50, hipPitch: -0.10, spYaw: 0.12, spRoll: -0.20, spPitch: -0.12,
    hdPitch: 0.30, hdYaw: -0.65, hdRoll: 0.20, armR: [-0.12, -0.25, -0.25], step: [0.05, 0.0], pivot: 1.65, footYaw: 1.3,
    ankle: [0.08, 1.42, 1.18], chamber: [-0.21, 0.87, 0.47], back: [-0.18, 0.80, 0.55],
  },
};
export const BODYKICK = roundKick('bodykick', KICK_PARAMS.bodykick);
export const HIGHKICK = roundKick('highkick', KICK_PARAMS.highkick);
export { roundKick };
Object.assign(CLIPS, { bodykick: BODYKICK, highkick: HIGHKICK });
// contacto (ronda 6/7, sólo con rival enlazado): zona, altura del blanco y punta libre en el impacto en el marco raíz [izq, altura, adelante]
// (medida sin rival, semilla 7; round7.test.mjs comprueba que sigue valiendo). Media: costillas = base del torso + 0,23; alta: mandíbula/cuello.
BODYKICK.aim = { zone: 'body', dy: 0.23, ref: [-0.142, 1.014, 0.849] };
HIGHKICK.aim = { zone: 'head', dy: -0.07, ref: [-0.098, 1.475, 0.903] };
