/**
 * @axiom/indicators — volume/nvi.ts
 *
 * Negative Volume Index (NVI) — Paul Dysart / Norman Fosback.
 * Source : StockCharts "Negative Volume Index (NVI)".
 *
 * Formule cumulative (valeur de départ conventionnelle = 1000) :
 *   nvi[0] = 1000
 *   si volume[i] < volume[i-1] :
 *       nvi[i] = nvi[i-1] + nvi[i-1] * (close[i] - close[i-1]) / close[i-1]
 *   sinon :
 *       nvi[i] = nvi[i-1]   (inchangé les jours de volume ≥)
 *
 * Indicateur cumulatif : défini dès la première bougie.
 * Garde : close[i-1] == 0 -> NVI inchangé (ROC non défini).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, volOf } from "../utils";

export const nvi: IndicatorDef = {
  id: "nvi",
  name: "Negative Volume Index",
  category: "volume",
  pane: "separate",
  inputs: [
    { key: "start", name: "Valeur initiale", type: "number", default: 1000 },
  ],
  outputs: [{ key: "nvi", name: "NVI", style: "line" }],
  calc(candles, params) {
    const start = Number(params.start ?? 1000);
    const close = closeOf(candles);
    const vol = volOf(candles);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (n === 0) return { series: { nvi: out } };

    let acc = start;
    out[0] = acc;
    for (let i = 1; i < n; i++) {
      const c = close[i];
      const p = close[i - 1];
      const v = vol[i];
      const vp = vol[i - 1];
      if (
        c !== undefined && p !== undefined && p !== 0 &&
        v !== undefined && vp !== undefined && v < vp
      ) {
        acc = acc + acc * ((c - p) / p);
      }
      out[i] = acc;
    }
    return { series: { nvi: out } };
  },
};
