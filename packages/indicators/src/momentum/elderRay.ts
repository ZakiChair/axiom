/**
 * @axiom/indicators — momentum/elderRay.ts
 *
 * Elder Ray — Dr. Alexander Elder (« Trading for a Living », 1993).
 * Décompose la pression haussière/baissière autour d'une EMA de référence.
 *
 * Formule canonique (length par défaut = 13) :
 *   ema      = EMA(close, length)
 *   bullPower[i] = high[i] - ema[i]   (force des acheteurs : capacité à pousser au-dessus de l'EMA)
 *   bearPower[i] = low[i]  - ema[i]   (force des vendeurs : capacité à pousser en-dessous)
 *
 * Tant que l'EMA n'est pas amorcée (i < length - 1), les deux sorties valent `undefined`.
 * Invariant : bullPower - bearPower == high - low >= 0.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, ema as emaOf, highOf, lowOf } from "../utils";

export const elderRay: IndicatorDef = {
  id: "elderRay",
  name: "Elder Ray",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur EMA", type: "number", default: 13, min: 1 },
  ],
  outputs: [
    // Histogrammes opposés (haussier vs baissier) autour de l'EMA.
    { key: "bull", name: "Bull Power", style: "histogram" },
    { key: "bear", name: "Bear Power", style: "histogram" },
  ],

  calc(candles, params) {
    const length = Number(params.length ?? 13);
    const n = candles.length;

    const emaClose = emaOf(closeOf(candles), length);
    const highs = highOf(candles);
    const lows = lowOf(candles);

    const bull: Array<number | undefined> = new Array(n).fill(undefined);
    const bear: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 0; i < n; i++) {
      const e = emaClose[i];
      const h = highs[i];
      const l = lows[i];
      if (e === undefined || h === undefined || l === undefined) continue;
      bull[i] = h - e;
      bear[i] = l - e;
    }

    return { series: { bull, bear } };
  },
};
