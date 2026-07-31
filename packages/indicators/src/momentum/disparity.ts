/**
 * @axiom/indicators — momentum/disparity.ts
 *
 * Disparity Index — écart en % du prix à sa moyenne mobile :
 *   disparity[i] = 100 · (source[i] − SMA(source, length)[i]) / SMA[i]
 * > 0 le prix est AU-DESSUS de sa MM (momentum haussier) ; < 0 en-dessous. Les
 * extrêmes signalent une sur-extension (retour à la moyenne probable). Oscille autour de 0.
 *
 * Défaut length = 14. Réutilise `sma` (utils).
 */

import type { Candle, CalcContext, IndicatorDef, IndicatorResult } from "@axiom/types";
import { sma } from "../utils";

export const disparity: IndicatorDef = {
  id: "disparity",
  name: "Indice de disparité",
  category: "momentum",
  pane: "separate",
  inputs: [{ key: "length", name: "Longueur", type: "number", default: 14, min: 1 }],
  outputs: [{ key: "disparity", name: "Disparity %", style: "line" }],
  calc(candles: Candle[], params: Record<string, number | boolean | string>, ctx: CalcContext): IndicatorResult {
    const length = Number(params.length);
    const n = candles.length;
    const src = ctx.source;
    const moy = sma(src, length);
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const m = moy[i];
      const v = src[i];
      if (m === undefined || v === undefined || m === 0) continue;
      out[i] = (100 * (v - m)) / m;
    }
    return { series: { disparity: out } };
  },
};
