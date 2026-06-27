/**
 * @axiom/indicators — momentum/momentum.ts
 *
 * Momentum — différence absolue de prix sur `length` périodes.
 * Source : Investopedia / pandas-ta `mom`.
 *
 * Formule :
 *   MOM[i] = close[i] - close[i - length]
 *
 * Alignement : les `length` premières positions valent `undefined`
 * (pas de clôture de référence `length` bougies plus tôt).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, change } from "../utils";

export const momentum: IndicatorDef = {
  id: "momentum",
  name: "Momentum",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 10, min: 1 },
  ],
  outputs: [{ key: "mom", name: "Momentum", style: "line" }],

  calc(candles, params) {
    const length = Number(params.length ?? 10);
    const close = closeOf(candles);
    // change() renvoie déjà close[i] - close[i - length], undefined avant la fenêtre.
    const mom = change(close, length);
    return { series: { mom } };
  },
};
