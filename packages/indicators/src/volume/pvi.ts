/**
 * @axiom/indicators — volume/pvi.ts
 *
 * Positive Volume Index (PVI) — Paul Dysart / Norman Fosback.
 * Source : StockCharts "Positive Volume Index (PVI)".
 *
 * Formule cumulative (valeur de départ conventionnelle = 1000) :
 *   pvi[0] = 1000
 *   si volume[i] > volume[i-1] :
 *       pvi[i] = pvi[i-1] + pvi[i-1] * (close[i] - close[i-1]) / close[i-1]
 *   sinon :
 *       pvi[i] = pvi[i-1]   (inchangé les jours de volume ≤)
 *
 * Indicateur cumulatif : défini dès la première bougie.
 * Garde : close[i-1] == 0 -> PVI inchangé (ROC non défini).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, volOf } from "../utils";

export const pvi: IndicatorDef = {
  id: "pvi",
  name: "Positive Volume Index",
  category: "volume",
  pane: "separate",
  inputs: [
    { key: "start", name: "Valeur initiale", type: "number", default: 1000 },
  ],
  outputs: [{ key: "pvi", name: "PVI", style: "line" }],
  calc(candles, params) {
    const start = Number(params.start ?? 1000);
    const close = closeOf(candles);
    const vol = volOf(candles);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (n === 0) return { series: { pvi: out } };

    let acc = start;
    out[0] = acc;
    for (let i = 1; i < n; i++) {
      const c = close[i];
      const p = close[i - 1];
      const v = vol[i];
      const vp = vol[i - 1];
      if (
        c !== undefined && p !== undefined && p !== 0 &&
        v !== undefined && vp !== undefined && v > vp
      ) {
        acc = acc + acc * ((c - p) / p);
      }
      out[i] = acc;
    }
    return { series: { pvi: out } };
  },
};
