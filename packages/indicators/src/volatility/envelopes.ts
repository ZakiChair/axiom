/**
 * @axiom/indicators — volatility/envelopes.ts
 *
 * Moving Average Envelopes (id: envelopes) — bandes en pourcentage autour d'une SMA.
 *
 * Formule canonique :
 *   basis = sma(close, length)
 *   upper = basis * (1 + percent / 100)
 *   lower = basis * (1 - percent / 100)
 *
 * Défauts : length = 20, percent = 1 (%).
 * Source : StockCharts « Moving Average Envelopes ».
 *
 * Alignement : les `length - 1` premières positions valent undefined.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, sma } from "../utils";

export const envelopes: IndicatorDef = {
  id: "envelopes",
  name: "Enveloppes",
  category: "volatility",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 1 },
    { key: "percent", name: "Percent", type: "number", default: 1, min: 0 },
  ],
  outputs: [
    { key: "basis", name: "Médiane", style: "line" },
    { key: "upper", name: "Bande haute", style: "line" },
    { key: "lower", name: "Bande basse", style: "line" },
  ],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length);
    const percent = Number(params.percent);
    const k = percent / 100;

    const basis = sma(closeOf(candles), length);
    const n = candles.length;

    const upper: Array<number | undefined> = new Array(n).fill(undefined);
    const lower: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 0; i < n; i++) {
      const b = basis[i];
      if (b === undefined) continue;
      upper[i] = b * (1 + k);
      lower[i] = b * (1 - k);
    }

    return { series: { basis, upper, lower } };
  },
};
