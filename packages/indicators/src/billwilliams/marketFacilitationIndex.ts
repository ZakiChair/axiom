/**
 * @axiom/indicators — billwilliams/marketFacilitationIndex.ts
 *
 * Market Facilitation Index (MFI / BW MFI) de Bill Williams — histogramme dans un
 * pane séparé. Source : « Trading Chaos » (Bill Williams). Formule canonique :
 *   MFI[i] = (high[i] - low[i]) / volume[i]
 *
 * Mesure le « mouvement de prix par unité de volume ». Toujours >= 0 (high >= low).
 * Si volume[i] == 0 (division impossible), la valeur vaut `undefined`.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { highOf, lowOf, volOf } from "../utils";

export const marketFacilitationIndex: IndicatorDef = {
  id: "marketFacilitationIndex",
  name: "Market Facilitation Index",
  category: "billwilliams",
  pane: "separate",
  inputs: [],
  outputs: [{ key: "mfi", name: "BW MFI", style: "histogram" }],

  calc(
    candles: Candle[],
    _params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const highs = highOf(candles);
    const lows = lowOf(candles);
    const vols = volOf(candles);
    const n = candles.length;

    const out: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 0; i < n; i++) {
      const h = highs[i];
      const l = lows[i];
      const v = vols[i];
      if (h === undefined || l === undefined || v === undefined) continue;
      // Volume nul : indice non défini (évite la division par zéro).
      if (v === 0) continue;
      out[i] = (h - l) / v;
    }

    return { series: { mfi: out } };
  },
};
