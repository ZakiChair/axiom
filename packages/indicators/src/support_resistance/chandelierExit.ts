/**
 * @axiom/indicators — support_resistance/chandelierExit.ts
 *
 * Chandelier Exit (Chuck LeBeau) — stops ATR trailing :
 *   long  = max(high, length) − mult · ATR
 *   short = min(low, length)  + mult · ATR
 * Overlay : niveaux de sortie / trailing (pas un signal d'entrée).
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf, rma, rollingHighest, rollingLowest, trueRange } from "../utils";

export const chandelierExit: IndicatorDef = {
  id: "chandelierExit",
  name: "Chandelier Exit",
  category: "support_resistance",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 22, min: 2, max: 200 },
    { key: "mult", name: "ATR mult", type: "number", default: 3, min: 0.5, max: 10 },
  ],
  outputs: [
    { key: "long", name: "Stop long", style: "line" },
    { key: "short", name: "Stop short", style: "line" },
  ],
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 22));
    const mult = Number(params.mult) || 3;
    const highs = highOf(candles);
    const lows = lowOf(candles);
    const atrVals = rma(trueRange(candles), length);
    const hh = rollingHighest(highs, length);
    const ll = rollingLowest(lows, length);
    const n = candles.length;
    const longS: Array<number | undefined> = new Array(n).fill(undefined);
    const shortS: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const a = atrVals[i];
      const h = hh[i];
      const l = ll[i];
      if (a === undefined || h === undefined || l === undefined) continue;
      longS[i] = h - mult * a;
      shortS[i] = l + mult * a;
    }
    return { series: { long: longS, short: shortS } };
  },
};
