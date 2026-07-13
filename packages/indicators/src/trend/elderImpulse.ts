/**
 * @axiom/indicators — trend/elderImpulse.ts
 *
 * Elder Impulse System (A. Elder) — code couleur de tendance/momentum :
 *   +1 (vert)  : EMA croît ET MACD hist croît
 *   −1 (rouge) : EMA décroît ET MACD hist décroît
 *    0 (bleu)  : sinon (mixte)
 * Sortie unique `impulse` pour coloriser / filtrer les trades (pane séparé).
 */

import type { IndicatorDef } from "@axiom/types";
import { ema as emaOf } from "../utils";

export const elderImpulse: IndicatorDef = {
  id: "elderImpulse",
  name: "Elder Impulse",
  category: "trend",
  pane: "separate",
  precision: 0,
  inputs: [
    { key: "emaLength", name: "EMA", type: "number", default: 13, min: 2, max: 100 },
    { key: "macdFast", name: "MACD fast", type: "number", default: 12, min: 2, max: 50 },
    { key: "macdSlow", name: "MACD slow", type: "number", default: 26, min: 3, max: 100 },
    { key: "macdSignal", name: "MACD signal", type: "number", default: 9, min: 2, max: 50 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  outputs: [{ key: "impulse", name: "Impulse", style: "histogram" }],
  calc(candles, params, ctx) {
    const emaLen = Math.max(2, Math.floor(Number(params.emaLength) || 13));
    const fast = Math.max(2, Math.floor(Number(params.macdFast) || 12));
    const slow = Math.max(fast + 1, Math.floor(Number(params.macdSlow) || 26));
    const sig = Math.max(2, Math.floor(Number(params.macdSignal) || 9));
    const src = ctx.source;
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    const e = emaOf(src, emaLen);
    const ef = emaOf(src, fast);
    const es = emaOf(src, slow);
    const macd: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const f = ef[i];
      const s = es[i];
      if (f !== undefined && s !== undefined) macd[i] = f - s;
    }
    // Signal EMA sur valeurs MACD définies
    const idx: number[] = [];
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = macd[i];
      if (v !== undefined) {
        idx.push(i);
        vals.push(v);
      }
    }
    const sigE = emaOf(vals, sig);
    const signal: Array<number | undefined> = new Array(n).fill(undefined);
    for (let j = 0; j < sigE.length; j++) {
      const v = sigE[j];
      const i = idx[j];
      if (v !== undefined && i !== undefined) signal[i] = v;
    }
    const hist: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const m = macd[i];
      const s = signal[i];
      if (m !== undefined && s !== undefined) hist[i] = m - s;
    }

    for (let i = 1; i < n; i++) {
      const e0 = e[i];
      const e1 = e[i - 1];
      const h0 = hist[i];
      const h1 = hist[i - 1];
      if (e0 === undefined || e1 === undefined || h0 === undefined || h1 === undefined) continue;
      const emaUp = e0 > e1;
      const emaDn = e0 < e1;
      const histUp = h0 > h1;
      const histDn = h0 < h1;
      if (emaUp && histUp) out[i] = 1;
      else if (emaDn && histDn) out[i] = -1;
      else out[i] = 0;
    }
    return { series: { impulse: out } };
  },
};
