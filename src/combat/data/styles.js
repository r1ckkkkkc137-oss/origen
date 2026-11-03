// Estilos de pelea: personalidad + afinidades técnicas. Los stats (0-100) vienen del tamagotchi;
// el estilo define CÓMO pelea con esos stats.
//
// range: distancia preferida en m de stickman (× PX_PER_M = 85 → px; la IA busca range+neutralGap). Todo lo demás del núcleo va en px. aggression: 0 paciente .. 1 presión total. feint: tasa de amagos.
// combo: tendencia a encadenar. counter: tendencia a esperar y contragolpear.
// td: tendencia a derribar. sub: tendencia a buscar sumisión. clinch: tendencia a amarrar.
// gnp: preferencia por ground and pound vs avanzar posición. groundBottomOk: cómodo abajo (guardia activa).
// skill: multiplicadores de técnica por área (1 = normal). Son la "especialidad" del estilo.
// topControl: 0..1 control desde arriba (cuesta más levantarse debajo de él).
// rangeKick: 0..1 control de distancia con patadas (patada de parada al que entra, retrocede fuera del jab rival,
//   recovery de patadas -18%·rk, más difíciles de atrapar, menos expuesto en la recuperación, footwork hacia atrás,
//   lee mejor el derribo).
// tdDefense: multiplicador de la defensa de derribo (sprawl, default 1). getUpBonus: bonus logit al levantarse (default 0).
// guillotine: probabilidad base de guillotina oportunista cuando lee y sprawlea un shoot (default: según sub).
// moveW: pesos de preferencia por movimiento (default 1). combos: secuencias favoritas.

const S = (o) => Object.freeze(o);

export const STYLES = Object.freeze({
  boxer: S({
    id: 'boxer', name: 'Boxeador', range: 0.95, aggression: 0.6, feint: 0.22, combo: 0.6, counter: 0.4,
    td: 0.02, sub: 0.0, clinch: 0.05, gnp: 0.7, groundBottomOk: 0.1, tdDefense: 1.15, getUpBonus: 0.3, shootCounter: 0.4, guillotine: 0.22,
    skill: { punch: 1.05, kick: 0.6, clinch: 0.85, wrestling: 0.75, ground: 0.65, subs: 0.55, defense: 1.0, headMovement: 1.07 },
    moveW: { jab: 1.6, cross: 1.4, hook: 1.4, uppercut: 1.1, bodyHook: 1.3, bodyCross: 1.0, overhand: 0.7, teep: 0.1, lowKick: 0.1, calfKick: 0.1, bodyKick: 0.05, highKick: 0.03, flyingKnee: 0.02, spinningBackfist: 0.05, supermanPunch: 0.2, standElbow: 0.1 },
    combos: [['jab', 'cross'], ['jab', 'cross', 'hook'], ['jab', 'jab', 'cross'], ['bodyHook', 'hook'], ['cross', 'hook', 'cross'], ['jab', 'bodyCross', 'hook'], ['hook', 'uppercut'], ['jab', 'cross', 'hook', 'cross'], ['jab', 'jab', 'cross', 'hook'], ['jab', 'cross', 'bodyHook', 'hook']],
  }),
  muayThai: S({
    id: 'muayThai', name: 'Muay Thai', range: 1.15, rangeKick: 0.8, aggression: 0.5, feint: 0.15, combo: 0.45, counter: 0.3,
    td: 0.03, sub: 0.02, clinch: 0.45, gnp: 0.6, groundBottomOk: 0.15, powerMul: 1.06, guillotine: 0.08,
    skill: { punch: 1.0, kick: 1.3, clinch: 1.3, wrestling: 0.88, ground: 0.72, subs: 0.6, defense: 1.0, headMovement: 0.95 },
    moveW: { jab: 1.0, cross: 1.0, hook: 0.8, uppercut: 0.5, teep: 1.1, lowKick: 1.6, calfKick: 0.8, bodyKick: 1.5, highKick: 1.3, flyingKnee: 0.5, standElbow: 1.0, overhand: 0.3, spinningBackfist: 0.15, supermanPunch: 0.2, bodyHook: 0.6, bodyCross: 0.5 },
    combos: [['jab', 'cross', 'lowKick'], ['teep', 'bodyKick'], ['jab', 'bodyKick'], ['cross', 'lowKick'], ['jab', 'cross', 'highKick'], ['hook', 'lowKick']],
  }),
  kickboxer: S({
    id: 'kickboxer', name: 'Kickboxer', range: 1.13, rangeKick: 1.0, aggression: 0.6, feint: 0.2, combo: 0.6, counter: 0.3,
    td: 0.03, sub: 0.02, clinch: 0.1, gnp: 0.6, groundBottomOk: 0.12, powerMul: 0.98, guillotine: 0.08,
    skill: { punch: 1.15, kick: 1.32, clinch: 0.8, wrestling: 1.05, ground: 0.95, subs: 0.6, defense: 1.06, headMovement: 1.1 },
    moveW: { jab: 1.3, cross: 1.2, hook: 1.0, uppercut: 0.6, teep: 0.8, lowKick: 1.3, calfKick: 1.0, bodyKick: 1.2, highKick: 1.5, spinningBackfist: 0.6, supermanPunch: 0.45, flyingKnee: 0.25, standElbow: 0.3, overhand: 0.5, bodyHook: 0.7, bodyCross: 0.6 },
    combos: [['jab', 'cross', 'hook', 'lowKick'], ['jab', 'cross', 'highKick'], ['jab', 'cross', 'lowKick'], ['jab', 'jab', 'cross', 'bodyKick'], ['jab', 'cross', 'lowKick'], ['jab', 'jab', 'cross', 'bodyKick'], ['calfKick', 'cross'], ['jab', 'spinningBackfist'], ['cross', 'hook', 'calfKick']],
  }),
  wrestler: S({
    id: 'wrestler', name: 'Luchador', range: 0.9, aggression: 0.7, feint: 0.18, combo: 0.3, counter: 0.15,
    td: 0.5, sub: 0.12, clinch: 0.35, gnp: 0.85, groundBottomOk: 0.1, topControl: 0.7,
    skill: { punch: 0.95, kick: 0.65, clinch: 1.15, wrestling: 1.38, ground: 1.15, subs: 0.85, defense: 0.98, headMovement: 0.9 },
    moveW: { jab: 1.2, cross: 1.0, overhand: 1.3, hook: 0.7, uppercut: 0.4, bodyHook: 0.5, lowKick: 0.3, calfKick: 0.2, teep: 0.1, bodyKick: 0.15, highKick: 0.05, flyingKnee: 0.05, spinningBackfist: 0.02, supermanPunch: 0.1, standElbow: 0.2, bodyCross: 0.4 },
    combos: [['jab', 'overhand'], ['jab', 'cross', 'hook'], ['jab', 'cross'], ['overhand', 'hook'], ['jab', 'cross', 'doubleLeg'], ['jab', 'overhand', 'doubleLeg']],
  }),
  bjj: S({
    id: 'bjj', name: 'Jiu-Jitsu', range: 1.0, aggression: 0.45, feint: 0.12, combo: 0.3, counter: 0.25,
    td: 0.5, sub: 0.38, clinch: 0.4, gnp: 0.9, groundBottomOk: 0.8, topControl: 0.7,
    skill: { punch: 0.98, kick: 0.8, clinch: 1.1, wrestling: 1.25, ground: 1.3, subs: 1.0, defense: 1.15, headMovement: 0.88 },
    moveW: { jab: 1.2, cross: 1.0, hook: 0.6, uppercut: 0.3, teep: 0.6, lowKick: 0.7, calfKick: 0.3, bodyKick: 0.4, highKick: 0.15, overhand: 0.4, bodyHook: 0.3, flyingKnee: 0.05, spinningBackfist: 0.02, supermanPunch: 0.05, standElbow: 0.2, bodyCross: 0.3 },
    combos: [['jab', 'singleLeg'], ['jab', 'clinchEntry'], ['teep', 'jab', 'singleLeg']],
  }),
  brawler: S({
    id: 'brawler', name: 'Fajador', range: 0.8, aggression: 0.9, feint: 0.3, combo: 0.75, counter: 0.1, noRepeat: 1.3, jabBias: 0.9,
    td: 0.06, sub: 0.02, clinch: 0.15, gnp: 0.9, groundBottomOk: 0.1, tdDefense: 1.05, powerMul: 0.97, chinMul: 0.92, guillotine: 0.4,
    skill: { punch: 1.12, kick: 0.85, clinch: 1.0, wrestling: 1.02, ground: 0.8, subs: 0.6, defense: 1.05, headMovement: 1.02 },
    moveW: { jab: 1.3, cross: 1.2, hook: 1.8, uppercut: 1.4, overhand: 1.6, bodyHook: 1.0, bodyCross: 0.5, lowKick: 0.5, calfKick: 0.2, bodyKick: 0.3, highKick: 0.2, flyingKnee: 0.35, spinningBackfist: 0.3, supermanPunch: 0.4, teep: 0.05, standElbow: 0.7 },
    combos: [['jab', 'overhand', 'hook'], ['jab', 'hook', 'uppercut'], ['hook', 'uppercut', 'hook'], ['overhand', 'hook'], ['cross', 'hook', 'uppercut', 'hook'], ['bodyHook', 'hook', 'overhand']],
  }),
  counterpuncher: S({
    id: 'counterpuncher', name: 'Contragolpeador', range: 1.05, aggression: 0.5, feint: 0.3, combo: 0.5, counter: 0.85,
    td: 0.04, sub: 0.02, clinch: 0.08, gnp: 0.65, groundBottomOk: 0.12, guillotine: 0.1,
    skill: { punch: 1.2, kick: 0.85, clinch: 0.9, wrestling: 0.8, ground: 0.7, subs: 0.6, defense: 1.25, headMovement: 1.35 },
    moveW: { jab: 1.5, cross: 1.5, hook: 1.3, uppercut: 1.0, bodyHook: 0.7, bodyCross: 0.8, overhand: 0.3, lowKick: 0.4, calfKick: 0.6, teep: 0.4, bodyKick: 0.2, highKick: 0.15, flyingKnee: 0.05, spinningBackfist: 0.1, supermanPunch: 0.1, standElbow: 0.2 },
    combos: [['cross', 'hook'], ['jab', 'cross'], ['hook', 'cross'], ['uppercut', 'hook']],
  }),
  allRounder: S({
    id: 'allRounder', name: 'MMA completo', range: 1.0, aggression: 0.55, feint: 0.18, combo: 0.45, counter: 0.4,
    td: 0.26, sub: 0.25, clinch: 0.2, gnp: 0.6, groundBottomOk: 0.4,
    skill: { punch: 1.08, kick: 1.08, clinch: 1.08, wrestling: 1.08, ground: 1.08, subs: 1.05, defense: 1.08, headMovement: 1.0 },
    moveW: { jab: 1.3, cross: 1.2, hook: 1.0, uppercut: 0.6, bodyHook: 0.7, bodyCross: 0.5, overhand: 0.6, teep: 0.5, lowKick: 1.0, calfKick: 0.8, bodyKick: 0.7, highKick: 0.5, flyingKnee: 0.2, spinningBackfist: 0.15, supermanPunch: 0.2, standElbow: 0.4 },
    combos: [['jab', 'cross', 'lowKick'], ['jab', 'cross', 'hook', 'lowKick'], ['jab', 'jab', 'cross'], ['jab', 'doubleLeg'], ['cross', 'hook'], ['jab', 'cross', 'highKick'], ['calfKick', 'cross', 'singleLeg']],
  }),
});

export const STYLE_IDS = Object.freeze(Object.keys(STYLES));

// Área técnica de cada movimiento (para usar skill[area]).
export function moveArea(move) {
  if (move.kind === 'sub') return 'subs';
  if (move.phase === 'ground') return 'ground';
  if (move.kind === 'takedown') return 'wrestling';
  if (move.phase === 'clinch' || move.kind === 'clinch') return 'clinch';
  if (move.limb.startsWith('foot') || move.limb.startsWith('knee')) return 'kick';
  return 'punch';
}
