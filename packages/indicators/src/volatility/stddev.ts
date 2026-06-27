/**
 * @axiom/indicators — volatility/stddev.ts
 *
 * Standard Deviation (id: stddev) — écart-type roulant des clôtures, pane séparé.
 *
 * Formule canonique :
 *   stddev = stdev(close, length, population = true)   // divise par N
 *
 * Convention « population » (divise par N), identique à Bollinger / TradingView.
 * Défaut : length = 20.
 * Source : TradingView « Standard Deviation ».
 *
 * Alignement : les `length - 1` premières positions valent undefined.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, stdev } from "../utils";

export const stddev: IndicatorDef = {
  id: "stddev",
  name: "Standard Deviation",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 20, min: 1 },
  ],
  outputs: [{ key: "stddev", name: "StdDev", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length);
    // population = true : convention TradingView (cohérent avec Bollinger).
    const out = stdev(closeOf(candles), length, true);
    return { series: { stddev: out } };
  },
};
