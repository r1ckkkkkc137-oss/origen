// reactions.js — reacciones a golpes por zona, aturdido (rocked), KO, y levantarse. Mismos canales/keyframes que clips.js.
//   hurt_head / hurt_body / hurt_legs : el golpe YA conectó => la pose se vuelve pico en ~60 ms y se recupera (0.5-0.62 s). Empiezan y terminan en 0.
//   rocked : aturdido SOSTENIDO (hold + vaivén procedural) hasta que la sim lo suelte (anim.cancel() o setState).
//   ko     : cae de espaldas (≈0.9 s), queda tendido (hold).      getUp : del suelo a la guardia (≈1.5 s), arranca EXACTAMENTE donde termina ko.
// La sim es dueña de la raíz: todo esto es pose (pelvis/pie/torso relativos a ella); sin root motion.
import { CLIPS } from './clips.js';

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

// ------------------------------------------------------------------ KO: se desploma hacia atrás y queda tendido boca arriba (hold).
// Valores finales (deltas sobre la guardia) — getUp arranca desde ellos.
export const KO_END = Object.freeze({
  dy: -0.66, pz: -0.44, px: 0.0, hipPitch: -1.58, spPitch: 0.02, hdPitch: -0.20, hdRoll: 0.12, hdYaw: 0.1, hipYaw: 0.5, hipRoll: 0.04, spYaw: -0.1,
  hLx: 0.48, hLy: -0.07, hLz: -0.08, hRx: -0.38, hRy: -0.05, hRz: 0.30, elbL: -0.2, elbR: 0.25,
  fLz: 0.0, fLy: 0, fRx: -0.04, fRz: 0.30, fRy: 0.0, shrugL: -0.08, shrugR: -0.08, elvL: 1, elvR: 1,
});
const ko = (c, a) => a;   // (azúcar)
export const KO = {
  name: 'ko', duration: 1.15, impactT: 0.0, tip: 'L', hold: true, feet: true,
  phases: [{ name: 'snap', t0: 0, t1: 0.12 }, { name: 'fall', t0: 0.12, t1: 0.75 }, { name: 'settle', t0: 0.75, t1: 1.15 }],
  tracks: {
    // 0-0.12 latigazo de cabeza (como hurt_head); 0.12-0.7 las rodillas ceden y cae de espaldas; rebota levemente al llegar
    hdPitch: [K(0, 0), K(0.11, -0.65, Q), K(0.30, -0.45), K(0.75, -0.33), K(0.92, -0.12), K(1.15, KO_END.hdPitch)],
    hdYaw:   [K(0, 0), K(0.11, -0.25, Q), K(0.5, -0.1), K(1.15, KO_END.hdYaw)],
    hdRoll:  [K(0, 0), K(0.2, 0.1), K(1.15, KO_END.hdRoll)],
    dy:      [K(0, 0), K(0.08, -0.04, Q), K(0.30, -0.28, 'easeInQuad'), K(0.55, -0.60, 'easeInQuad'), K(0.70, -0.67, 'easeOutQuad'), K(0.85, -0.65), K(1.15, KO_END.dy)],
    pz:      [K(0, 0), K(0.1, -0.06, Q), K(0.35, -0.16), K(0.65, -0.52, 'easeInQuad'), K(0.80, -0.46), K(1.15, KO_END.pz)],
    hipPitch:[K(0, 0), K(0.1, -0.1, Q), K(0.35, -0.12), K(0.55, -0.86, 'easeInQuad'), K(0.72, -1.66, 'easeInQuad'), K(0.86, -1.52, 'easeOutQuad'), K(1.15, KO_END.hipPitch)],
    spPitch: [K(0, 0), K(0.1, -0.25, Q), K(0.45, -0.18), K(0.72, 0.04), K(1.15, KO_END.spPitch)],
    hipYaw:  [K(0, 0), K(0.5, 0.15), K(1.15, KO_END.hipYaw)],
    hipRoll: [K(0, 0), K(0.5, 0.06), K(1.15, KO_END.hipRoll)],
    spYaw:   [K(0, 0), K(1.15, KO_END.spYaw)],
    shrugL:  [K(0, 0), K(0.75, -0.04), K(1.15, KO_END.shrugL)], shrugR: [K(0, 0), K(0.75, -0.04), K(1.15, KO_END.shrugR)],
    // brazos: la guardia se cae (cuelgan) y al llegar abren a los lados
    hLy: [K(0, 0), K(0.2, -0.12, Q), K(0.5, -0.22), K(0.75, 0.0), K(1.15, KO_END.hLy)], hRy: [K(0, 0), K(0.2, -0.12, Q), K(0.5, -0.22), K(0.75, 0.0), K(1.15, KO_END.hRy)],
    hLx: [K(0, 0), K(0.25, 0.30), K(0.8, 0.40), K(1.15, KO_END.hLx)], hRx: [K(0, 0), K(0.25, -0.10), K(0.8, -0.34), K(1.15, KO_END.hRx)],
    hLz: [K(0, 0), K(0.8, -0.04), K(1.15, KO_END.hLz)], hRz: [K(0, 0), K(0.8, 0.10), K(1.15, KO_END.hRz)],
    elbL: [K(0, 0), K(0.5, 0.1), K(1.15, KO_END.elbL)], elbR: [K(0, 0), K(0.5, 0.1), K(1.15, KO_END.elbR)],
    elvL: [K(0, 0), K(0.20, 0.0), K(0.75, 1, 'linear'), K(1.15, 1)], elvR: [K(0, 0), K(0.20, 0.0), K(0.75, 1, 'linear'), K(1.15, 1)],
    // pies: el de apoyo se arrastra levemente, el trasero se queda (rodilla doblada hacia arriba)
    fLz: [K(0, 0), K(1.15, KO_END.fLz)], fRz: [K(0, 0), K(0.28, 0.0), K(0.58, 0.22), K(0.85, 0.30), K(1.15, KO_END.fRz)], fRx: [K(0, 0), K(1.15, KO_END.fRx)],
  },
};

// ------------------------------------------------------------------ GET UP: sienta el torso, recoge el cuerpo sobre los pies (cuclillas) y se para en guardia.
// Los pies quedan clavados donde estaban (en el suelo); la pelvis viaja sobre ellos. Termina en 0 => guardia.
const E = KO_END;
const GU = (c) => E[c] ?? 0;
export const GETUP = {
  name: 'getUp', duration: 1.60, impactT: 0.0, tip: 'L', from: 'ko', feet: true,
  phases: [{ name: 'sit', t0: 0, t1: 0.55 }, { name: 'crouch', t0: 0.55, t1: 1.05 }, { name: 'stand', t0: 1.05, t1: 1.6 }],
  tracks: {
    dy:      [K(0, GU('dy')), K(0.15, GU('dy')), K(0.50, -0.60), K(0.85, -0.26), K(1.15, -0.12), K(1.6, 0)],
    pz:      [K(0, GU('pz')), K(0.15, GU('pz')), K(0.50, -0.34), K(0.85, -0.04), K(1.15, 0.0), K(1.6, 0)],
    hipPitch:[K(0, GU('hipPitch')), K(0.15, GU('hipPitch')), K(0.55, -0.42), K(0.85, 0.38), K(1.15, 0.26), K(1.6, 0)],
    spPitch: [K(0, GU('spPitch')), K(0.15, GU('spPitch')), K(0.55, -0.10), K(0.85, 0.30), K(1.15, 0.20), K(1.6, 0)],
    hdPitch: [K(0, GU('hdPitch')), K(0.15, -0.05), K(0.55, 0.05), K(0.85, 0.0), K(1.6, 0)],
    hdRoll:  [K(0, GU('hdRoll')), K(0.55, 0.03), K(1.6, 0)],
    hdYaw:   [K(0, GU('hdYaw')), K(0.55, 0.2), K(1.6, 0)],
    hipYaw:  [K(0, GU('hipYaw')), K(0.15, GU('hipYaw')), K(0.60, 0.1), K(1.0, 0.0), K(1.6, 0)],
    hipRoll: [K(0, GU('hipRoll')), K(1.6, 0)], spYaw: [K(0, GU('spYaw')), K(0.6, 0.0), K(1.6, 0)],
    shrugL:  [K(0, GU('shrugL')), K(1.6, 0)], shrugR: [K(0, GU('shrugR')), K(1.6, 0)],
    // manos: se apoyan adelante para empujar (suelo), luego suben a la guardia
    hLx: [K(0, GU('hLx')), K(0.15, GU('hLx')), K(0.5, 0.20), K(0.85, 0.10), K(1.2, 0.02), K(1.6, 0)], hRx: [K(0, GU('hRx')), K(0.15, GU('hRx')), K(0.5, -0.20), K(0.85, -0.05), K(1.2, 0.0), K(1.6, 0)],
    hLy: [K(0, GU('hLy')), K(0.15, GU('hLy')), K(0.5, -0.30), K(0.85, -0.25), K(1.2, -0.04), K(1.6, 0)], hRy: [K(0, GU('hRy')), K(0.15, GU('hRy')), K(0.5, -0.30), K(0.85, -0.25), K(1.2, -0.04), K(1.6, 0)],
    hLz: [K(0, GU('hLz')), K(0.15, GU('hLz')), K(0.5, 0.20), K(0.85, 0.08), K(1.2, 0.0), K(1.6, 0)], hRz: [K(0, GU('hRz')), K(0.15, GU('hRz')), K(0.5, 0.18), K(0.85, 0.08), K(1.2, 0.0), K(1.6, 0)],
    elvL: [K(0, 1), K(0.4, 1), K(0.9, 0.2), K(1.6, 0)], elvR: [K(0, 1), K(0.4, 1), K(0.9, 0.2), K(1.6, 0)],
    elbL: [K(0, GU('elbL')), K(0.5, 0.1), K(1.6, 0)], elbR: [K(0, GU('elbR')), K(0.5, 0.1), K(1.6, 0)],
    fLz: [K(0, GU('fLz')), K(1.6, 0)], fRz: [K(0, GU('fRz')), K(1.6, 0)], fRx: [K(0, GU('fRx')), K(1.6, 0)],
  },
};

export const REACTIONS = { hurt_head: HURT_HEAD, hurt_body: HURT_BODY, hurt_legs: HURT_LEGS, rocked: ROCKED, ko: KO, getUp: GETUP };
Object.assign(CLIPS, REACTIONS);
export const ZONE_CLIP = Object.freeze({ head: 'hurt_head', body: 'hurt_body', legs: 'hurt_legs' });
