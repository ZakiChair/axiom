/**
 * @axiom/indicators — trend/dpo.ts
 *
 * DPO (Detrended Price Oscillator) — retire la tendance en comparant une clôture
 * passée (décalée) à une SMA centrée, pour isoler les cycles courts. Pane séparé.
 *
 * Source / formule canonique (cf. StockCharts « Detrended Price Oscillator ») :
 *   shift   = floor(n / 2) + 1
 *   DPO[i]  = close[i - shift] - SMA(close, n)[i]
 * Défaut : n = 20  ->  shift = 11.
 *
 * Défini là où la SMA est pleine (i >= n-1) ET la clôture décalée existe
 * (i - shift >= 0). Sinon `undefined`.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, sma } from "../utils";

export const dpo: IndicatorDef = {
  id: "dpo",
  name: "DPO",
  category: "trend",
  pane: "separate",
  inputs: [{ key: "length", name: "Longueur", type: "number", default: 20, min: 1 }],
  outputs: [{ key: "dpo", name: "DPO", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length ?? 20);
    const close = closeOf(candles);
    const n = close.length;

    const shift = Math.floor(length / 2) + 1;
    const basis = sma(close, length);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const j = i - shift;
      if (j < 0) continue;
      const past = close[j];
      const avg = basis[i];
      if (past !== undefined && avg !== undefined) {
        out[i] = past - avg;
      }
    }

    return { series: { dpo: out } };
  },
};
