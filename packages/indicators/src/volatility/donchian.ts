/**
 * @axiom/indicators — volatility/donchian.ts
 *
 * Donchian Channels (id: donchian) — canal des extrêmes superposé au prix.
 *
 * Formule canonique (Richard Donchian) :
 *   upper = plus haut des `length` derniers highs   (rollingHighest)
 *   lower = plus bas  des `length` derniers lows     (rollingLowest)
 *   basis = (upper + lower) / 2                       (ligne médiane)
 *
 * Défaut : length = 20.
 * Source : StockCharts « Donchian Channels ».
 *
 * Alignement : les `length - 1` premières positions valent undefined
 * (fenêtre roulante non pleine).
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { highOf, lowOf, rollingHighest, rollingLowest } from "../utils";

export const donchian: IndicatorDef = {
  id: "donchian",
  name: "Donchian Channels",
  category: "volatility",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 20, min: 1 },
  ],
  outputs: [
    { key: "basis", name: "Basis", style: "line" },
    { key: "upper", name: "Upper", style: "line" },
    { key: "lower", name: "Lower", style: "line" },
  ],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length);
    const n = candles.length;

    const upper = rollingHighest(highOf(candles), length);
    const lower = rollingLowest(lowOf(candles), length);

    const basis: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const u = upper[i];
      const l = lower[i];
      // Médiane définie seulement quand les deux extrêmes le sont.
      if (u === undefined || l === undefined) continue;
      basis[i] = (u + l) / 2;
    }

    return { series: { basis, upper, lower } };
  },
};
