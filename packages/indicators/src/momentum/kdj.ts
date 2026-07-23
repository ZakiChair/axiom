/**
 * @axiom/indicators — momentum/kdj.ts
 *
 * KDJ — oscillateur K/D/J standard (dérivé du Stochastic, lissage récursif à la
 * chinoise). Source : convention usuelle des plateformes de trading (RSV +
 * lissage exponentiel-like avec seed 50).
 *
 * Formule :
 *   RSV[i] = 100 * (close[i] - LL(length)[i]) / (HH(length)[i] - LL(length)[i])
 *   HH == LL (amplitude nulle) -> RSV `undefined`, K et D reconduisent leur
 *   valeur précédente (pas de recalcul).
 *
 *   K[i] = ((signalK - 1) * K[i-1] + RSV[i]) / signalK
 *   D[i] = ((signalD - 1) * D[i-1] + K[i]) / signalD
 *   Seed : avant le premier RSV défini, K et D valent 50 (valeur neutre
 *   médiane), utilisée comme K[i-1]/D[i-1] implicite pour amorcer la
 *   récursion.
 *
 *   J[i] = 3 * K[i] - 2 * D[i] — volontairement non clampé : J déborde
 *   [0, 100] par construction (c'est l'intérêt du signal), contrairement à K/D.
 *
 * `undefined` tant que la fenêtre `length` est incomplète (pas de RSV
 * possible) ; au-delà, K/D/J sont toujours définis (seed 50 puis récurrence).
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf, closeOf, rollingHighest, rollingLowest } from "../utils";

export const kdj: IndicatorDef = {
  id: "kdj",
  name: "KDJ",
  category: "momentum",
  pane: "separate",
  precision: 2,
  inputs: [
    { key: "length", name: "Length", type: "number", default: 9, min: 2, max: 100 },
    { key: "signalK", name: "Signal K", type: "number", default: 3, min: 1, max: 20 },
    { key: "signalD", name: "Signal D", type: "number", default: 3, min: 1, max: 20 },
  ],
  outputs: [
    { key: "k", name: "K", style: "line" },
    { key: "d", name: "D", style: "line" },
    { key: "j", name: "J", style: "line" },
  ],

  calc(candles, params) {
    const length = Number(params.length ?? 9);
    const signalK = Number(params.signalK ?? 3);
    const signalD = Number(params.signalD ?? 3);

    const highs = highOf(candles);
    const lows = lowOf(candles);
    const closes = closeOf(candles);
    const n = closes.length;

    const hh = rollingHighest(highs, length);
    const ll = rollingLowest(lows, length);

    const k: Array<number | undefined> = new Array(n).fill(undefined);
    const d: Array<number | undefined> = new Array(n).fill(undefined);
    const j: Array<number | undefined> = new Array(n).fill(undefined);

    // Seed 50 : valeur neutre servant de K[i-1]/D[i-1] implicite tant qu'aucun
    // K/D réel n'a encore été calculé.
    let prevK = 50;
    let prevD = 50;

    for (let i = length - 1; i < n; i++) {
      const h = hh[i];
      const l = ll[i];
      const c = closes[i];
      if (h === undefined || l === undefined || c === undefined) continue;

      const range = h - l;
      let curK: number;
      let curD: number;
      if (range === 0) {
        // Amplitude nulle : RSV non défini, K/D reconduisent leur valeur précédente.
        curK = prevK;
        curD = prevD;
      } else {
        const rsv = (100 * (c - l)) / range;
        curK = ((signalK - 1) * prevK + rsv) / signalK;
        curD = ((signalD - 1) * prevD + curK) / signalD;
      }

      k[i] = curK;
      d[i] = curD;
      j[i] = 3 * curK - 2 * curD; // non clampé — J déborde 0-100 par nature.

      prevK = curK;
      prevD = curD;
    }

    return { series: { k, d, j } };
  },
};
