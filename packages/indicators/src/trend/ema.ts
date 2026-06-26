/**
 * @axiom/indicators — EMA (Exponential Moving Average)
 *
 * Moyenne mobile exponentielle des clôtures. Indicateur de tendance tracé en
 * overlay sur le prix. Le calcul délègue entièrement au helper `ema` de
 * `../utils` (source de vérité unique : amorce par SMA, coefficient 2/(L+1)).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, ema as emaCalc } from "../utils";

export const ema: IndicatorDef = {
  id: "ema",
  name: "EMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 20, min: 1 },
  ],
  outputs: [{ key: "ema", name: "EMA", style: "line" }],
  calc(candles, params) {
    // `length` est garanti numérique par le moteur ; repli sur 20 par sécurité.
    const length = typeof params.length === "number" ? params.length : 20;
    return {
      series: {
        // Les positions précédant la première fenêtre pleine restent undefined.
        ema: emaCalc(closeOf(candles), length),
      },
    };
  },
};
