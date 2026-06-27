/**
 * @axiom/indicators — volatility/bbPercentB.ts
 *
 * Bollinger %B (id: bbPercentB) — position relative du prix dans les bandes,
 * pane séparé.
 *
 * Formule canonique (John Bollinger) :
 *   basis = sma(close, length)
 *   dev   = mult * stdev(close, length, population = true)
 *   upper = basis + dev ; lower = basis - dev
 *   %B    = (close - lower) / (upper - lower)
 *
 * %B = 1 au contact de la bande haute, 0 au contact de la basse ; peut sortir de
 * [0, 1] (non borné). Défauts : length = 20, mult = 2.
 * Source : John Bollinger, « Bollinger on Bollinger Bands ».
 *
 * Note : bandes recalculées en interne (sma + stdev) ; on n'importe PAS
 * bollinger.ts (fichier d'un autre agent).
 *
 * Alignement : les `length - 1` premières positions valent undefined.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, sma, stdev } from "../utils";

export const bbPercentB: IndicatorDef = {
  id: "bbPercentB",
  name: "Bollinger %B",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 20, min: 1 },
    { key: "mult", name: "StdDev", type: "number", default: 2, min: 0 },
  ],
  outputs: [{ key: "percentB", name: "%B", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length);
    const mult = Number(params.mult);

    const close = closeOf(candles);
    const basis = sma(close, length);
    const dev = stdev(close, length, true);
    const n = close.length;

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const b = basis[i];
      const d = dev[i];
      const c = close[i];
      if (b === undefined || d === undefined || c === undefined) continue;
      const upper = b + mult * d;
      const lower = b - mult * d;
      const width = upper - lower;
      // Bandes plates (width = 0) : %B indéfini.
      if (width === 0) continue;
      out[i] = (c - lower) / width;
    }

    return { series: { percentB: out } };
  },
};
