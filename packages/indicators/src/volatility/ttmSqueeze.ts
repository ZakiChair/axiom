/**
 * @axiom/indicators — volatility/ttmSqueeze.ts
 *
 * TTM Squeeze (John Carter, adapté) — détection de compression BB dans Keltner.
 *
 *   midBB = sma(close, length)
 *   bbUp/Dn = midBB ± multBB * stdev(close, length)
 *   midKC = ema(close, length)
 *   kcUp/Dn = midKC ± multKC * atr(length)
 *   squeeze ON  si bbUp < kcUp ET bbDn > kcDn  (BB entièrement dans KC)
 *   momentum    = close − sma(hlc3, length)   (histogramme directionnel)
 *
 * Sorties : `on` (1 = squeeze actif, 0 = relâché), `mom` (histogramme).
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, ema, rma, sma, stdev, trueRange } from "../utils";

export const ttmSqueeze: IndicatorDef = {
  id: "ttmSqueeze",
  name: "TTM Squeeze",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Length", type: "number", default: 20, min: 2, max: 200 },
    { key: "multBB", name: "BB mult", type: "number", default: 2, min: 0.5, max: 5 },
    { key: "multKC", name: "KC mult", type: "number", default: 1.5, min: 0.5, max: 5 },
  ],
  outputs: [
    { key: "on", name: "Squeeze ON", style: "histogram" },
    { key: "mom", name: "Momentum", style: "histogram" },
  ],
  precision: 4,
  calc(candles, params, ctx) {
    const length = Number(params.length) || 20;
    const multBB = Number(params.multBB) || 2;
    const multKC = Number(params.multKC) || 1.5;
    const close = closeOf(candles);
    const n = candles.length;
    const on: Array<number | undefined> = new Array(n).fill(undefined);
    const mom: Array<number | undefined> = new Array(n).fill(undefined);

    const midBB = sma(close, length);
    const dev = stdev(close, length);
    const midKC = ema(close, length);
    // ATR Wilder = RMA(true range) — même construction que volatility/atr.ts.
    const atrVals = rma(trueRange(candles), length);
    const midHlc3 = sma(ctx.hlc3, length);

    for (let i = 0; i < n; i++) {
      const mbb = midBB[i];
      const d = dev[i];
      const mkc = midKC[i];
      const a = atrVals[i];
      const c = close[i];
      const mh = midHlc3[i];
      if (
        mbb === undefined ||
        d === undefined ||
        mkc === undefined ||
        a === undefined ||
        c === undefined ||
        mh === undefined
      ) {
        continue;
      }
      const bbUp = mbb + multBB * d;
      const bbDn = mbb - multBB * d;
      const kcUp = mkc + multKC * a;
      const kcDn = mkc - multKC * a;
      on[i] = bbUp < kcUp && bbDn > kcDn ? 1 : 0;
      mom[i] = c - mh;
    }
    return { series: { on, mom } };
  },
};
