/**
 * @axiom/indicators — momentum/fisher.ts
 *
 * Fisher Transform (John Ehlers).
 *
 * Source : formule canonique (Ehlers, « Using the Fisher Transform », 2002 ;
 * reprise par TradingView / pandas-ta).
 *
 * Calcul (n = période de normalisation, défaut 9) :
 *   median[i] = (high + low) / 2                                    (hl2)
 *   raw       = (median - min(median, n)) / (max(median, n) - min(median, n))
 *   value     = 0.66·(2·raw - 1) + 0.67·value[i-1]   puis clampé à [-0.999, 0.999]
 *   fisher    = 0.5·ln((1 + value) / (1 - value)) + 0.5·fisher[i-1]
 *   trigger   = fisher[i-1]                                         (ligne décalée)
 *
 * Le facteur 0.66 = 0.33·2 (forme d'Ehlers). Les états récursifs `value` et
 * `fisher` sont amorcés à 0 sur la première fenêtre pleine (index n-1).
 *
 * Alignement : la première valeur apparaît à l'index `n - 1` (fenêtre haut/bas
 * pleine). Les positions précédentes valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { rollingHighest, rollingLowest } from "../utils";

export const fisher: IndicatorDef = {
  id: "fisher",
  name: "Fisher Transform",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 9, min: 1 },
  ],
  outputs: [
    { key: "fisher", name: "Fisher", style: "line" },
    { key: "trigger", name: "Trigger", style: "line" },
  ],

  calc(candles, params, ctx) {
    const length = Number(params.length);
    const n = candles.length;
    const fisherOut: Array<number | undefined> = new Array(n).fill(undefined);
    const triggerOut: Array<number | undefined> = new Array(n).fill(undefined);

    const median = ctx.hl2;
    const hi = rollingHighest(median, length);
    const lo = rollingLowest(median, length);

    // États récursifs amorcés à 0 (convention Ehlers à l'entrée de la fenêtre).
    let valuePrev = 0;
    let fishPrev = 0;

    for (let i = length - 1; i < n; i++) {
      const m = median[i];
      const maxH = hi[i];
      const minL = lo[i];
      if (m === undefined || maxH === undefined || minL === undefined) continue;

      const range = maxH - minL;
      // Plage nulle (prix plat) -> position médiane (raw = 0.5).
      const raw = range === 0 ? 0.5 : (m - minL) / range;

      let value = 0.66 * (2 * raw - 1) + 0.67 * valuePrev;
      // Clamp anti-divergence du logarithme (|value| < 1 strict).
      if (value > 0.999) value = 0.999;
      else if (value < -0.999) value = -0.999;

      const fish = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * fishPrev;
      fisherOut[i] = fish;

      valuePrev = value;
      fishPrev = fish;
    }

    // Trigger = ligne Fisher décalée d'une barre (first index = length).
    for (let i = length; i < n; i++) {
      triggerOut[i] = fisherOut[i - 1];
    }

    return { series: { fisher: fisherOut, trigger: triggerOut } };
  },
};
