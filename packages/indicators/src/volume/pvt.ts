/**
 * @axiom/indicators — volume/pvt.ts
 *
 * Price Volume Trend (PVT) — variante de l'OBV pondérée par la variation relative.
 * Source : StockCharts/TradingView "Price Volume Trend".
 *
 * Formule cumulative :
 *   roc[i] = (close[i] - close[i-1]) / close[i-1]   (ROC à 1 période)
 *   pvt[i] = pvt[i-1] + volume[i] * roc[i]          (pvt[0] = 0)
 *
 * Indicateur cumulatif : défini dès la première bougie.
 * Garde : close[i-1] == 0 -> contribution nulle (ROC non défini).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, volOf } from "../utils";

export const pvt: IndicatorDef = {
  id: "pvt",
  name: "Price Volume Trend",
  category: "volume",
  pane: "separate",
  inputs: [],
  outputs: [{ key: "pvt", name: "PVT", style: "line" }],
  calc(candles) {
    const close = closeOf(candles);
    const vol = volOf(candles);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (n === 0) return { series: { pvt: out } };

    let acc = 0;
    out[0] = 0;
    for (let i = 1; i < n; i++) {
      const c = close[i];
      const p = close[i - 1];
      const v = vol[i];
      if (c === undefined || p === undefined || v === undefined || p === 0) {
        out[i] = acc;
        continue;
      }
      acc += v * ((c - p) / p);
      out[i] = acc;
    }
    return { series: { pvt: out } };
  },
};
