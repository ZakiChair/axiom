/**
 * @axiom/indicators — trend/halfTrend.ts
 *
 * HalfTrend (logique Everget / community) — suiveur ATR :
 *   dev = ATR(atrPeriod) · amplitude / 2
 *   en tendance haussière : ligne = max des lows − dev (trailing)
 *   bascule baissière si close < maxLow − dev
 *   symétrique pour la baisse
 * Overlay : `line` + `direction` (+1 / −1).
 */

import type { IndicatorDef } from "@axiom/types";
import { rma, trueRange } from "../utils";

export const halfTrend: IndicatorDef = {
  id: "halfTrend",
  name: "HalfTrend",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "amplitude", name: "Amplitude", type: "number", default: 2, min: 1, max: 20 },
    { key: "atrPeriod", name: "ATR période", type: "number", default: 100, min: 2, max: 200 },
  ],
  outputs: [
    { key: "line", name: "HalfTrend", style: "line" },
    { key: "direction", name: "Direction", style: "line" },
  ],
  calc(candles, params) {
    const amplitude = Math.max(1, Math.floor(Number(params.amplitude) || 2));
    const atrPeriod = Math.max(2, Math.floor(Number(params.atrPeriod) || 100));
    const n = candles.length;
    const line: Array<number | undefined> = new Array(n).fill(undefined);
    const direction: Array<number | undefined> = new Array(n).fill(undefined);
    const atrVals = rma(trueRange(candles), atrPeriod);

    // 0 = up, 1 = down (convention Pine halfTrend)
    let trend = 0;
    let nextTrend = 0;
    let maxLowPrice = Number.NaN;
    let minHighPrice = Number.NaN;
    let up = Number.NaN;
    let down = Number.NaN;

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const atr = atrVals[i];
      if (c === undefined || atr === undefined) continue;

      const highPrice = c.high;
      const lowPrice = c.low;
      const close = c.close;
      const dev = (atr * amplitude) / 2;

      // High/low à lookback amplitude (barre i − amplitude)
      const back = candles[i - amplitude];
      const highBack = back?.high;
      const lowBack = back?.low;
      const prev = candles[i - 1];
      const prevLow = prev?.low;
      const prevHigh = prev?.high;

      if (Number.isNaN(maxLowPrice)) maxLowPrice = lowPrice;
      if (Number.isNaN(minHighPrice)) minHighPrice = highPrice;

      if (nextTrend === 1) {
        maxLowPrice = Math.max(lowPrice, maxLowPrice);
        if (
          highBack !== undefined &&
          highBack < maxLowPrice &&
          prevLow !== undefined &&
          close < prevLow
        ) {
          // conserve nextTrend
        }
        if (close < maxLowPrice) {
          trend = 1;
          nextTrend = 0;
          minHighPrice = highPrice;
        }
      } else {
        minHighPrice = Math.min(highPrice, minHighPrice);
        if (
          lowBack !== undefined &&
          lowBack > minHighPrice &&
          prevHigh !== undefined &&
          close > prevHigh
        ) {
          // conserve
        }
        if (close > minHighPrice) {
          trend = 0;
          nextTrend = 1;
          maxLowPrice = lowPrice;
        }
      }

      if (trend === 0) {
        const candidate = maxLowPrice - dev;
        if (Number.isNaN(up)) up = candidate;
        else {
          // au basculement depuis down, reprend l'ancien down
          const prevDir = direction[i - 1];
          if (prevDir === -1 && !Number.isNaN(down)) up = down;
          else up = Math.max(candidate, up);
        }
        line[i] = up;
        direction[i] = 1;
      } else {
        const candidate = minHighPrice + dev;
        if (Number.isNaN(down)) down = candidate;
        else {
          const prevDir = direction[i - 1];
          if (prevDir === 1 && !Number.isNaN(up)) down = up;
          else down = Math.min(candidate, down);
        }
        line[i] = down;
        direction[i] = -1;
      }
    }

    return { series: { line, direction } };
  },
};
