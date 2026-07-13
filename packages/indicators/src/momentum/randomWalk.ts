/**
 * @axiom/indicators — momentum/randomWalk.ts
 *
 * Random Walk Index (Michael Poulos) :
 *   RWI_high = (high − low[n]) / (ATR · sqrt(n))
 *   RWI_low  = (high[n] − low) / (ATR · sqrt(n))
 * Sur une fenêtre de longueur `length` (lookback n = length).
 * > 1 ≈ mouvement plus fort qu'un random walk (tendance).
 */

import type { IndicatorDef } from "@axiom/types";
import { rma, trueRange } from "../utils";

export const randomWalk: IndicatorDef = {
  id: "randomWalk",
  name: "Random Walk Index",
  category: "momentum",
  pane: "separate",
  precision: 2,
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 2, max: 100 },
  ],
  outputs: [
    { key: "high", name: "RWI High", style: "line" },
    { key: "low", name: "RWI Low", style: "line" },
  ],
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 14));
    const atr = rma(trueRange(candles), length);
    const n = candles.length;
    const hi: Array<number | undefined> = new Array(n).fill(undefined);
    const lo: Array<number | undefined> = new Array(n).fill(undefined);
    const sqrtN = Math.sqrt(length);

    for (let i = length; i < n; i++) {
      const c = candles[i];
      const past = candles[i - length];
      const a = atr[i];
      if (c === undefined || past === undefined || a === undefined || a === 0) continue;
      hi[i] = (c.high - past.low) / (a * sqrtN);
      lo[i] = (past.high - c.low) / (a * sqrtN);
    }
    return { series: { high: hi, low: lo } };
  },
};
