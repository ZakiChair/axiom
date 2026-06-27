/**
 * @axiom/indicators — volume/adLine.ts
 *
 * Accumulation/Distribution Line (ADL) — Marc Chaikin.
 * Source : StockCharts "Accumulation/Distribution Line".
 *
 * Formules :
 *   CLV[i] (Close Location Value) = ((c - l) - (h - c)) / (h - l)
 *          = h == l  ->  0   (bougie sans amplitude : garde division par zéro)
 *   MFV[i] (Money Flow Volume)    = CLV[i] * volume[i]
 *   adl[i] = adl[i-1] + MFV[i]     (cumul, adl[0] = MFV[0])
 *
 * Indicateur cumulatif : défini dès la première bougie.
 */

import type { IndicatorDef } from "@axiom/types";

export const adLine: IndicatorDef = {
  id: "adLine",
  name: "Accumulation/Distribution",
  category: "volume",
  pane: "separate",
  inputs: [],
  outputs: [{ key: "adLine", name: "A/D Line", style: "line" }],
  calc(candles) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    let acc = 0;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) {
        out[i] = acc;
        continue;
      }
      const range = c.high - c.low;
      const clv = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
      acc += clv * c.volume;
      out[i] = acc;
    }
    return { series: { adLine: out } };
  },
};
