/**
 * @axiom/indicators — EMA (Exponential Moving Average)
 *
 * Moyenne mobile exponentielle d'une série de prix configurable (input
 * "source", défaut close). Indicateur de tendance tracé en overlay sur le
 * prix. Le calcul délègue entièrement au helper `ema` de `../utils` (source
 * de vérité unique : amorce par SMA, coefficient 2/(L+1)).
 */

import type { IndicatorDef } from "@axiom/types";
import { ema as emaCalc } from "../utils";

export const ema: IndicatorDef = {
  id: "ema",
  name: "EMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 1 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  outputs: [{ key: "ema", name: "EMA", style: "line" }],
  calc(candles, params, ctx) {
    // `length` est garanti numérique par le moteur ; repli sur 20 par sécurité.
    const length = typeof params.length === "number" ? params.length : 20;
    return {
      series: {
        // Les positions précédant la première fenêtre pleine restent undefined.
        ema: emaCalc(ctx.source, length),
      },
    };
  },
};
