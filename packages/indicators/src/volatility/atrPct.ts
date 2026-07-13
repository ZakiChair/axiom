/**
 * @axiom/indicators — volatility/atrPct.ts
 *
 * ATR en % du prix : 100 × ATR(length) / close.
 * Comparable cross-actifs (BTC vs alt) pour filtre de régime / sizing.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, rma, trueRange } from "../utils";

export const atrPct: IndicatorDef = {
  id: "atrPct",
  name: "ATR %",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 1, max: 200 },
  ],
  outputs: [{ key: "atrPct", name: "ATR %", style: "line" }],
  precision: 2,
  calc(candles, params) {
    const length = Math.max(1, Math.floor(Number(params.length) || 14));
    const atrVals = rma(trueRange(candles), length);
    const close = closeOf(candles);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const a = atrVals[i];
      const c = close[i];
      if (a === undefined || c === undefined || c === 0) continue;
      out[i] = (100 * a) / c;
    }
    return { series: { atrPct: out } };
  },
};
