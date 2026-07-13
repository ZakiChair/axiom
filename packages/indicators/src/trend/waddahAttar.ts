/**
 * @axiom/indicators — trend/waddahAttar.ts
 *
 * Waddah Attar Explosion — combinaison MACD-like + bandes de Bollinger :
 *   trendUp   = max(0,  macd − macd[1]) · sens haussier
 *   trendDown = max(0,  macd[1] − macd) · sens baissier
 *   explosion = upperBB − lowerBB
 *   deadZone  = paramètre (filtre bruit)
 * Histogrammes up/down + ligne explosion. Gratuit OHLCV.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, ema, sma, stdev } from "../utils";

export const waddahAttar: IndicatorDef = {
  id: "waddahAttar",
  name: "Waddah Attar Explosion",
  category: "trend",
  pane: "separate",
  precision: 4,
  inputs: [
    { key: "fast", name: "MACD fast", type: "number", default: 20, min: 2, max: 100 },
    { key: "slow", name: "MACD slow", type: "number", default: 40, min: 2, max: 200 },
    { key: "bbLength", name: "BB length", type: "number", default: 20, min: 2, max: 100 },
    { key: "bbMult", name: "BB mult", type: "number", default: 2, min: 0.5, max: 5 },
    { key: "sensitivity", name: "Sensibilité", type: "number", default: 150, min: 1, max: 500 },
  ],
  outputs: [
    { key: "up", name: "Trend Up", style: "histogram" },
    { key: "down", name: "Trend Down", style: "histogram" },
    { key: "explosion", name: "Explosion", style: "line" },
  ],
  calc(candles, params) {
    const fast = Math.max(2, Math.floor(Number(params.fast) || 20));
    const slow = Math.max(fast + 1, Math.floor(Number(params.slow) || 40));
    const bbLength = Math.max(2, Math.floor(Number(params.bbLength) || 20));
    const bbMult = Number(params.bbMult) || 2;
    const sens = Number(params.sensitivity) || 150;
    const close = closeOf(candles);
    const n = candles.length;
    const up: Array<number | undefined> = new Array(n).fill(undefined);
    const down: Array<number | undefined> = new Array(n).fill(undefined);
    const explosion: Array<number | undefined> = new Array(n).fill(undefined);

    const ef = ema(close, fast);
    const es = ema(close, slow);
    const macd: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const f = ef[i];
      const s = es[i];
      if (f !== undefined && s !== undefined) macd[i] = f - s;
    }

    const mid = sma(close, bbLength);
    const sd = stdev(close, bbLength);

    for (let i = 1; i < n; i++) {
      const m0 = macd[i];
      const m1 = macd[i - 1];
      const b = mid[i];
      const s = sd[i];
      if (m0 === undefined || m1 === undefined) continue;
      const t1 = (m0 - m1) * sens;
      if (t1 >= 0) {
        up[i] = t1;
        down[i] = 0;
      } else {
        up[i] = 0;
        down[i] = -t1;
      }
      if (b !== undefined && s !== undefined) {
        explosion[i] = 2 * bbMult * s; // largeur BB = upper−lower
      }
    }
    return { series: { up, down, explosion } };
  },
};
