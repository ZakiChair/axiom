/**
 * @axiom/indicators — trend/sma.ts
 *
 * SMA (Simple Moving Average) — moyenne mobile simple des prix de clôture.
 * Indicateur de tendance affiché en overlay sur les bougies.
 *
 * Calcul : series.sma = sma(closeOf(candles), length).
 * Les positions précédant la première fenêtre pleine valent `undefined`
 * (convention commune des helpers de utils.ts).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, sma as smaOf } from "../utils";

export const sma: IndicatorDef = {
  id: "sma",
  name: "SMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 20, min: 1 },
  ],
  outputs: [{ key: "sma", name: "SMA", style: "line" }],
  calc(candles, params) {
    // `length` est garanti numérique par le contrat d'input (défaut 20).
    const length = Number(params.length ?? 20);
    return {
      series: {
        sma: smaOf(closeOf(candles), length),
      },
    };
  },
};
