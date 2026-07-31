/**
 * @axiom/indicators — trend/sma.ts
 *
 * SMA (Simple Moving Average) — moyenne mobile simple d'une série de prix
 * configurable (input "source", défaut close). Indicateur de tendance affiché
 * en overlay sur les bougies.
 *
 * Calcul : series.sma = sma(ctx.source, length).
 * Les positions précédant la première fenêtre pleine valent `undefined`
 * (convention commune des helpers de utils.ts).
 */

import type { IndicatorDef } from "@axiom/types";
import { sma as smaOf } from "../utils";

export const sma: IndicatorDef = {
  id: "sma",
  name: "SMA",
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
  outputs: [{ key: "sma", name: "SMA", style: "line" }],
  calc(candles, params, ctx) {
    // `length` est garanti numérique par le contrat d'input (défaut 20).
    const length = Number(params.length ?? 20);
    return {
      series: {
        sma: smaOf(ctx.source, length),
      },
    };
  },
};
