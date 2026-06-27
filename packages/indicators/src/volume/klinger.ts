/**
 * @axiom/indicators — volume/klinger.ts
 *
 * Klinger Volume Oscillator (KVO) — Stephen Klinger.
 * Source : Klinger (1997) ; cf. Investopedia/TradingView "Klinger Oscillator".
 *
 * Volume Force (vf) :
 *   hlc[i]   = high + low + close
 *   trend[i] = +1 si hlc[i] > hlc[i-1], sinon -1   (trend[0] = +1)
 *   dm[i]    = high[i] - low[i]                      (daily measurement)
 *   cm[i]    = cm[i-1] + dm[i]      si trend[i] == trend[i-1]
 *            = dm[i-1] + dm[i]      sinon            (cm[0] = dm[0])
 *   vf[i]    = volume[i] * |2 * (dm[i]/cm[i] - 1)| * trend[i] * 100   (0 si cm == 0)
 *
 * Oscillateur et signal :
 *   kvo[i]    = EMA(vf, fast)[i] - EMA(vf, slow)[i]   (fast=34, slow=55)
 *   signal[i] = EMA(kvo, signalLen)[i]               (signalLen=13)
 *
 * Indicateur complexe : le test vérifie longueur/amorçage/finitude, pas une
 * valeur de référence (politique anti fausse-précision §15.4).
 */

import type { IndicatorDef } from "@axiom/types";
import { volOf, ema } from "../utils";

export const klinger: IndicatorDef = {
  id: "klinger",
  name: "Klinger Oscillator",
  category: "volume",
  pane: "separate",
  inputs: [
    { key: "fast", name: "Fast", type: "number", default: 34, min: 1 },
    { key: "slow", name: "Slow", type: "number", default: 55, min: 1 },
    { key: "signal", name: "Signal", type: "number", default: 13, min: 1 },
  ],
  outputs: [
    { key: "klinger", name: "Klinger", style: "line" },
    { key: "signal", name: "Signal", style: "line" },
  ],
  calc(candles, params) {
    const fast = Number(params.fast ?? 34);
    const slow = Number(params.slow ?? 55);
    const signalLen = Number(params.signal ?? 13);
    const n = candles.length;
    const vol = volOf(candles);

    // --- Volume Force ---
    const vf: number[] = new Array(n).fill(0);
    let prevTrend = 1;
    let prevCm = 0;
    let prevDm = 0;
    let prevHlc: number | undefined;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const v = vol[i];
      if (c === undefined || v === undefined) {
        vf[i] = 0;
        continue;
      }
      const hlc = c.high + c.low + c.close;
      const dm = c.high - c.low;
      let trend: number;
      let cm: number;
      if (prevHlc === undefined) {
        trend = 1; // amorce
        cm = dm;
      } else {
        trend = hlc > prevHlc ? 1 : -1;
        cm = trend === prevTrend ? prevCm + dm : prevDm + dm;
      }
      vf[i] = cm === 0 ? 0 : v * Math.abs(2 * (dm / cm - 1)) * trend * 100;
      prevTrend = trend;
      prevCm = cm;
      prevDm = dm;
      prevHlc = hlc;
    }

    // --- KVO = EMA(vf, fast) - EMA(vf, slow) ---
    const emaFast = ema(vf, fast);
    const emaSlow = ema(vf, slow);
    const kvo: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const f = emaFast[i];
      const s = emaSlow[i];
      if (f !== undefined && s !== undefined) kvo[i] = f - s;
    }

    // --- Signal : EMA des valeurs DÉFINIES de kvo, ré-alignées (cf. macd.ts) ---
    const definedIdx: number[] = [];
    const definedVals: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = kvo[i];
      if (v !== undefined) {
        definedIdx.push(i);
        definedVals.push(v);
      }
    }
    const signalCompact = ema(definedVals, signalLen);
    const signal: Array<number | undefined> = new Array(n).fill(undefined);
    for (let j = 0; j < definedIdx.length; j++) {
      const idx = definedIdx[j];
      if (idx === undefined) continue;
      signal[idx] = signalCompact[j];
    }

    return { series: { klinger: kvo, signal } };
  },
};
