/**
 * @axiom/indicators — trend/smma.ts
 *
 * SMMA (Smoothed Moving Average) — moyenne mobile lissée de Wilder.
 * Indicateur de tendance affiché en overlay sur les bougies.
 *
 * Formule canonique : la SMMA est identique au lissage de Wilder (RMA),
 *   SMMA[i] = SMMA[i-1] + (close[i] − SMMA[i-1]) / n,
 *   amorcé par la SMA des `n` premières clôtures.
 * Source : J. Welles Wilder, "New Concepts in Technical Trading Systems".
 *
 * Le calcul est délégué au helper `rma` de utils.ts.
 * Les positions précédant la première fenêtre pleine valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, rma } from "../utils";

export const smma: IndicatorDef = {
  id: "smma",
  name: "SMMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 7, min: 1 },
  ],
  outputs: [{ key: "smma", name: "SMMA", style: "line" }],
  calc(candles, params) {
    const length = Number(params.length ?? 7);
    return {
      series: {
        smma: rma(closeOf(candles), length),
      },
    };
  },
};
