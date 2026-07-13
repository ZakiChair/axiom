/**
 * @axiom/indicators — volume/relativeVolume.ts
 *
 * Volume relatif (RVOL) = volume / sma(volume, length).
 * > 1 = volume au-dessus de la moyenne (intérêt / breakout).
 * Gratuit, purement OHLCV — universel crypto/tradi.
 */

import type { IndicatorDef } from "@axiom/types";
import { sma, volOf } from "../utils";

export const relativeVolume: IndicatorDef = {
  id: "relativeVolume",
  name: "Volume relatif (RVOL)",
  category: "volume",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 2, max: 200 },
  ],
  outputs: [{ key: "rvol", name: "RVOL", style: "histogram" }],
  precision: 2,
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 20));
    const vol = volOf(candles);
    const avg = sma(vol, length);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const v = vol[i];
      const a = avg[i];
      if (v === undefined || a === undefined || a === 0) continue;
      out[i] = v / a;
    }
    return { series: { rvol: out } };
  },
};
