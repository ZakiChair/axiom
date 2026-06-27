/**
 * @axiom/indicators — trend/wma.ts
 *
 * WMA (Weighted Moving Average) — moyenne mobile pondérée linéairement.
 * Indicateur de tendance affiché en overlay sur les bougies.
 *
 * Formule canonique : poids 1..n (la plus récente = n),
 *   WMA = Σ(poids × close) / Σ(poids), avec Σ(poids) = n(n+1)/2.
 * Source : John J. Murphy, "Technical Analysis of the Financial Markets".
 *
 * Le calcul est entièrement délégué au helper `wma` de utils.ts.
 * Les positions précédant la première fenêtre pleine valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, wma as wmaOf } from "../utils";

export const wma: IndicatorDef = {
  id: "wma",
  name: "WMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 9, min: 1 },
  ],
  outputs: [{ key: "wma", name: "WMA", style: "line" }],
  calc(candles, params) {
    // `length` est garanti numérique par le contrat d'input (défaut 9).
    const length = Number(params.length ?? 9);
    return {
      series: {
        wma: wmaOf(closeOf(candles), length),
      },
    };
  },
};
