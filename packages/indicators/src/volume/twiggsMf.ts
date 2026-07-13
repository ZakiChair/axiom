/**
 * @axiom/indicators — volume/twiggsMf.ts
 *
 * Twiggs Money Flow (C. Twiggs) — variante du CMF avec True Range et EMA Wilder :
 *   TR = max(high−low, |high−prevClose|, |low−prevClose|)
 *   AD = volume · (2·close − high − low) / TR     (si TR>0)
 *   TMF = EMA(AD, length) / EMA(volume, length)
 * ∈ ≈ [−1, 1]. Pression acheteuse/vendeuse filtrée.
 */

import type { IndicatorDef } from "@axiom/types";
import { ema, trueRange, volOf } from "../utils";

export const twiggsMf: IndicatorDef = {
  id: "twiggsMf",
  name: "Twiggs Money Flow",
  category: "volume",
  pane: "separate",
  precision: 3,
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 21, min: 2, max: 200 },
  ],
  outputs: [{ key: "tmf", name: "TMF", style: "histogram" }],
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 21));
    const n = candles.length;
    const tr = trueRange(candles);
    const vol = volOf(candles);
    const ad: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const t = tr[i];
      const v = vol[i];
      if (c === undefined || t === undefined || v === undefined || t === 0) {
        ad[i] = 0;
        continue;
      }
      ad[i] = (v * (2 * c.close - c.high - c.low)) / t;
    }
    const emaAd = ema(ad, length);
    const emaVol = ema(vol, length);
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const a = emaAd[i];
      const vv = emaVol[i];
      if (a === undefined || vv === undefined || vv === 0) continue;
      out[i] = a / vv;
    }
    return { series: { tmf: out } };
  },
};
