/**
 * @axiom/indicators — volume/volumeDelta.ts
 *
 * Delta de volume par bougie : buyVolume − sellVolume (histogramme).
 * Complément du CVD (qui cumule). Sans buy/sell → undefined sur la barre.
 */

import type { IndicatorDef } from "@axiom/types";

export const volumeDelta: IndicatorDef = {
  id: "volumeDelta",
  name: "Volume Delta",
  category: "volume",
  pane: "separate",
  inputs: [],
  outputs: [{ key: "delta", name: "Delta", style: "histogram" }],
  precision: 0,
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
      out[i] = buy - sell;
    }
    return { series: { delta: out } };
  },
};
