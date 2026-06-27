/**
 * @axiom/indicators — momentum/williamsR.ts
 *
 * Williams %R — position de la clôture dans l'amplitude haut/bas sur `length`.
 * Source : Larry Williams / Investopedia / pandas-ta `willr`.
 *
 * Formule :
 *   %R[i] = -100 * (HH[i] - close[i]) / (HH[i] - LL[i])
 *   HH = plus haut roulant des `high` sur `length`
 *   LL = plus bas  roulant des `low`  sur `length`
 *
 * Borne théorique : [-100, 0]. Si HH == LL (amplitude nulle) -> `undefined`.
 * Alignement : les `length - 1` premières positions valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf, closeOf, rollingHighest, rollingLowest } from "../utils";

export const williamsR: IndicatorDef = {
  id: "williamsR",
  name: "Williams %R",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 1 },
  ],
  outputs: [{ key: "willr", name: "%R", style: "line" }],

  calc(candles, params) {
    const length = Number(params.length ?? 14);
    const highs = highOf(candles);
    const lows = lowOf(candles);
    const closes = closeOf(candles);
    const n = closes.length;

    const hh = rollingHighest(highs, length);
    const ll = rollingLowest(lows, length);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const h = hh[i];
      const l = ll[i];
      const c = closes[i];
      if (h === undefined || l === undefined || c === undefined) continue;
      const range = h - l;
      if (range === 0) continue; // amplitude nulle : %R non défini.
      out[i] = (-100 * (h - c)) / range;
    }

    return { series: { willr: out } };
  },
};
