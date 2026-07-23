/**
 * @axiom/indicators — volatility/priceZScore.ts
 *
 * Price Z-Score (id: priceZScore) — z-score de prix générique (source configurable),
 * pane séparé. Complète les z-scores spécialisés existants (funding, MVRV, volume) par
 * une version mean-reversion générique applicable à n'importe quelle série de prix.
 *
 * Formule canonique :
 *   z[i] = (source[i] - SMA(source, length)[i]) / stdev(source, length, population = true)[i]
 *
 * Convention « population » (divise par N), identique à Bollinger/stddev.
 * `undefined` tant que la fenêtre est incomplète, ou si stdev == 0 (fenêtre plate) :
 * pas de 0/0 -> NaN.
 *
 * Bandes de repère `hi`/`lo` : constantes +2/-2 sur toute la série (seuils
 * mean-reversion usuels, indépendants de la fenêtre — lignes de niveau, pas des
 * bandes calculées).
 *
 * Défaut : length = 100. Source : convention interne (cf. stddev.ts / bbPercentB.ts).
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { sma, stdev } from "../utils";

export const priceZScore: IndicatorDef = {
  id: "priceZScore",
  name: "Price Z-Score",
  category: "volatility",
  pane: "separate",
  precision: 2,
  inputs: [
    { key: "length", name: "Length", type: "number", default: 100, min: 10, max: 500 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  outputs: [
    { key: "z", name: "Z-Score", style: "line" },
    { key: "hi", name: "+2", style: "line" },
    { key: "lo", name: "-2", style: "line" },
  ],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length);
    const src = ctx.source;
    const n = src.length;

    const basis = sma(src, length);
    const dev = stdev(src, length, true);

    const z: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const b = basis[i];
      const d = dev[i];
      if (b === undefined || d === undefined) continue;
      if (d === 0) continue; // fenêtre plate : z non défini (évite 0/0).
      const s = src[i];
      if (s === undefined) continue;
      z[i] = (s - b) / d;
    }

    return {
      series: {
        z,
        hi: new Array<number>(n).fill(2),
        lo: new Array<number>(n).fill(-2),
      },
    };
  },
};
