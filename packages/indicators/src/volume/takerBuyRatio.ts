/**
 * @axiom/indicators — volume/takerBuyRatio.ts
 *
 * Ratio agresseur acheteur = buyVolume / (buyVolume + sellVolume) ∈ [0, 1].
 * 0,5 = équilibre ; > 0,5 pression acheteuse. Sans volumes split → undefined.
 */

import type { IndicatorDef } from "@axiom/types";

export const takerBuyRatio: IndicatorDef = {
  id: "takerBuyRatio",
  name: "Taker Buy Ratio",
  category: "volume",
  pane: "separate",
  inputs: [],
  outputs: [{ key: "ratio", name: "Buy ratio", style: "line" }],
  precision: 3,
  calc(candles) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      const buy = c.buyVolume;
      const sell = c.sellVolume;
      if (buy === undefined || sell === undefined) continue;
      if (!Number.isFinite(buy) || !Number.isFinite(sell)) continue;
      const tot = buy + sell;
      if (tot <= 0) {
        out[i] = 0.5;
        continue;
      }
      out[i] = buy / tot;
    }
    return { series: { ratio: out } };
  },
};
