/**
 * @axiom/indicators — volume/volumeZScore.ts
 *
 * Z-score du volume sur fenêtre glissante :
 *   z = (vol − μ) / σ
 * Extrêmes |z| > 2 = volume anormal (souvent news / liquidations / breakout).
 */

import type { IndicatorDef } from "@axiom/types";
import { sma, stdev, volOf } from "../utils";

export const volumeZScore: IndicatorDef = {
  id: "volumeZScore",
  name: "Z-Score du volume",
  category: "volume",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 5, max: 200 },
  ],
  outputs: [{ key: "z", name: "Z", style: "histogram" }],
  precision: 2,
  calc(candles, params) {
    const length = Math.max(5, Math.floor(Number(params.length) || 20));
    const vol = volOf(candles);
    const mu = sma(vol, length);
    const sd = stdev(vol, length);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const v = vol[i];
      const m = mu[i];
      const s = sd[i];
      if (v === undefined || m === undefined || s === undefined) continue;
      out[i] = s === 0 ? 0 : (v - m) / s;
    }
    return { series: { z: out } };
  },
};
