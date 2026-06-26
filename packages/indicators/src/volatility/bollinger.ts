/**
 * @axiom/indicators — Bollinger Bands (id: bollinger)
 *
 * Bandes de Bollinger : une moyenne mobile simple (la « basis ») encadrée par
 * deux bandes situées à `mult` écarts-types de part et d'autre.
 *
 * Calcul (convention TradingView) :
 *   basis = sma(close, length)
 *   dev   = mult * stdev(close, length, population = true)   // divise par N
 *   upper = basis + dev
 *   lower = basis - dev
 *
 * Les positions précédant la première fenêtre pleine (`length - 1` premières)
 * restent `undefined` : `basis` y vaut `undefined`, donc `upper`/`lower` aussi.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, sma, stdev } from "../utils";

export const bollinger: IndicatorDef = {
  id: "bollinger",
  name: "Bollinger Bands",
  category: "volatility",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 20, min: 1 },
    { key: "mult", name: "StdDev", type: "number", default: 2, min: 0 },
  ],
  outputs: [
    { key: "basis", name: "Basis", style: "line" },
    { key: "upper", name: "Upper", style: "line" },
    { key: "lower", name: "Lower", style: "line" },
  ],
  calc(candles, params) {
    const length = Number(params.length);
    const mult = Number(params.mult);

    const close = closeOf(candles);
    const basis = sma(close, length);
    const dev = stdev(close, length, true); // population = convention TradingView

    const n = candles.length;
    const upper: Array<number | undefined> = new Array(n).fill(undefined);
    const lower: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = 0; i < n; i++) {
      const b = basis[i];
      const d = dev[i];
      // Avant la fenêtre pleine, b et d valent undefined : les bandes restent undefined.
      if (b === undefined || d === undefined) continue;
      const offset = mult * d;
      upper[i] = b + offset;
      lower[i] = b - offset;
    }

    return { series: { basis, upper, lower } };
  },
};
