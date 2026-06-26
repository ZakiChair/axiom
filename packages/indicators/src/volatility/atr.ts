/**
 * @axiom/indicators — volatility/atr.ts
 *
 * ATR (Average True Range) de Wilder — mesure de volatilité.
 *
 * Calcul :
 *   TR[i] = max( high[i] - low[i],
 *                |high[i] - close[i-1]|,
 *                |low[i]  - close[i-1]| )
 *   Pour la première bougie (i = 0), il n'existe pas de close précédent :
 *     TR[0] = high[0] - low[0].
 *   ATR = rma(TR, length)   (lissage de Wilder, cf. utils.ts)
 *
 * Alignement : `rma` laisse `undefined` les `length - 1` premières positions
 * (fenêtre de lissage non pleine). La première valeur ATR apparaît donc à
 * l'index `length - 1`.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { rma } from "../utils";

export const atr: IndicatorDef = {
  id: "atr",
  name: "ATR",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 1 },
  ],
  outputs: [{ key: "atr", name: "ATR", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length);
    const n = candles.length;

    // True Range par bougie (aligné index par index sur les bougies).
    const tr: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;

      const highLow = c.high - c.low;
      const prev = candles[i - 1];
      if (prev === undefined) {
        // Première bougie : pas de close précédent -> TR = high - low.
        tr[i] = highLow;
        continue;
      }

      const highClose = Math.abs(c.high - prev.close);
      const lowClose = Math.abs(c.low - prev.close);
      tr[i] = Math.max(highLow, highClose, lowClose);
    }

    // ATR = lissage de Wilder du True Range.
    const out = rma(tr, length);

    return { series: { atr: out } };
  },
};
