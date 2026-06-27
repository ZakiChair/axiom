/**
 * @axiom/indicators — volatility/bbBandwidth.ts
 *
 * Bollinger Bandwidth (id: bbBandwidth) — largeur relative des bandes, pane séparé.
 *
 * Formule canonique (John Bollinger) :
 *   basis     = sma(close, length)
 *   dev       = mult * stdev(close, length, population = true)
 *   upper     = basis + dev ; lower = basis - dev
 *   bandwidth = (upper - lower) / basis     (= 2·mult·stdev / sma)
 *
 * Toujours >= 0 (basis > 0 pour des prix positifs). Défauts : length = 20, mult = 2.
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

export const bbBandwidth: IndicatorDef = {
  id: "bbBandwidth",
  name: "Bollinger Bandwidth",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 20, min: 1 },
    { key: "mult", name: "StdDev", type: "number", default: 2, min: 0 },
  ],
  outputs: [{ key: "bandwidth", name: "Bandwidth", style: "line" }],

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
      if (b === undefined || d === undefined || b === 0) continue;
      const upper = b + mult * d;
      const lower = b - mult * d;
      out[i] = (upper - lower) / b;
    }

    return { series: { bandwidth: out } };
  },
};
