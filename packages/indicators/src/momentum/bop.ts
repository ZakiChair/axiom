/**
 * @axiom/indicators — momentum/bop.ts
 *
 * BOP (Balance of Power) — Igor Livshin (Stocks & Commodities, 2001).
 * Mesure la force des acheteurs vs vendeurs à l'intérieur d'une bougie.
 *
 * Formule canonique (par bougie, aucune fenêtre) :
 *   BOP[i] = (close - open) / (high - low)
 *
 * Borné dans [-1, +1] car |close - open| <= high - low.
 * Bougie dégénérée (high == low) : valeur `undefined` (aucune amplitude exploitable).
 */

import type { IndicatorDef } from "@axiom/types";

export const bop: IndicatorDef = {
  id: "bop",
  name: "Balance of Power",
  category: "momentum",
  pane: "separate",
  inputs: [],
  outputs: [{ key: "bop", name: "BOP", style: "line" }],

  calc(candles) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      const range = c.high - c.low;
      // high == low : bougie sans amplitude -> pas de valeur calculable.
      if (range === 0) continue;
      out[i] = (c.close - c.open) / range;
    }

    return { series: { bop: out } };
  },
};
