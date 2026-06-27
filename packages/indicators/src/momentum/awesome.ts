/**
 * @axiom/indicators — momentum/awesome.ts
 *
 * Awesome Oscillator (Bill Williams).
 *
 * Source : formule canonique (Bill Williams, reprise par TradingView / pandas-ta).
 *
 * Calcul :
 *   median[i] = (high + low) / 2            (prix médian = hl2)
 *   AO        = SMA(median, fast) - SMA(median, slow)
 *
 * Paramètres canoniques : fast = 5, slow = 34. Rendu en histogramme.
 *
 * Alignement : la première valeur exige la fenêtre SMA lente pleine (index
 * `slow - 1`). Les positions précédentes valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { sma } from "../utils";

export const awesome: IndicatorDef = {
  id: "awesome",
  name: "Awesome Oscillator",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "fast", name: "Fast", type: "number", default: 5, min: 1 },
    { key: "slow", name: "Slow", type: "number", default: 34, min: 1 },
  ],
  outputs: [{ key: "ao", name: "AO", style: "histogram" }],

  calc(candles, params, ctx) {
    const fast = Number(params.fast);
    const slow = Number(params.slow);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // Prix médian fourni par le contexte (hl2).
    const median = ctx.hl2;
    const smaFast = sma(median, fast);
    const smaSlow = sma(median, slow);

    for (let i = 0; i < n; i++) {
      const f = smaFast[i];
      const s = smaSlow[i];
      if (f === undefined || s === undefined) continue;
      out[i] = f - s;
    }

    return { series: { ao: out } };
  },
};
