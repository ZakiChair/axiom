/**
 * @axiom/indicators — momentum/smi.ts
 *
 * Stochastic Momentum Index (W. Blau) :
 *   mid = (high + low) / 2 sur la fenêtre
 *   D = close − mid_range   (mid_range = (HH + LL) / 2)
 *   SMI = 100 · EMA(EMA(D)) / (0.5 · EMA(EMA(HH−LL)))
 * Signal = EMA(SMI). Oscillateur ≈ −100..100.
 */

import type { IndicatorDef } from "@axiom/types";
import { ema, highOf, lowOf, closeOf } from "../utils";

/** Double EMA compactée puis ré-alignée (undefined contigus en tête). */
function doubleEma(
  series: Array<number | undefined>,
  len1: number,
  len2: number
): Array<number | undefined> {
  const n = series.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  const idx: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = series[i];
    if (v !== undefined) {
      idx.push(i);
      vals.push(v);
    }
  }
  if (vals.length === 0) return out;
  const e1 = ema(vals, len1);
  const dense: number[] = [];
  const denseIdx: number[] = [];
  for (let j = 0; j < e1.length; j++) {
    const v = e1[j];
    if (v !== undefined) {
      dense.push(v);
      denseIdx.push(idx[j]!);
    }
  }
  const e2 = ema(dense, len2);
  for (let j = 0; j < e2.length; j++) {
    const v = e2[j];
    const i = denseIdx[j];
    if (v !== undefined && i !== undefined) out[i] = v;
  }
  return out;
}

export const smi: IndicatorDef = {
  id: "smi",
  name: "SMI (Stochastic Momentum)",
  category: "momentum",
  pane: "separate",
  precision: 2,
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 10, min: 2, max: 100 },
    { key: "smooth1", name: "EMA 1", type: "number", default: 3, min: 1, max: 50 },
    { key: "smooth2", name: "EMA 2", type: "number", default: 3, min: 1, max: 50 },
    { key: "signal", name: "Signal", type: "number", default: 3, min: 1, max: 50 },
  ],
  outputs: [
    { key: "smi", name: "SMI", style: "line" },
    { key: "signal", name: "Signal", style: "line" },
  ],
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 10));
    const s1 = Math.max(1, Math.floor(Number(params.smooth1) || 3));
    const s2 = Math.max(1, Math.floor(Number(params.smooth2) || 3));
    const sigLen = Math.max(1, Math.floor(Number(params.signal) || 3));
    const highs = highOf(candles);
    const lows = lowOf(candles);
    const closes = closeOf(candles);
    const n = candles.length;
    const rel: Array<number | undefined> = new Array(n).fill(undefined);
    const diff: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = length - 1; i < n; i++) {
      let hh = -Infinity;
      let ll = Infinity;
      let ok = true;
      for (let k = 0; k < length; k++) {
        const h = highs[i - length + 1 + k];
        const l = lows[i - length + 1 + k];
        if (h === undefined || l === undefined) {
          ok = false;
          break;
        }
        if (h > hh) hh = h;
        if (l < ll) ll = l;
      }
      const c = closes[i];
      if (!ok || c === undefined) continue;
      const mid = (hh + ll) / 2;
      rel[i] = c - mid;
      diff[i] = hh - ll;
    }

    const smRel = doubleEma(rel, s1, s2);
    const smDiff = doubleEma(diff, s1, s2);
    const smiOut: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const r = smRel[i];
      const d = smDiff[i];
      if (r === undefined || d === undefined) continue;
      smiOut[i] = d === 0 ? 0 : 100 * (r / (0.5 * d));
    }

    // Signal = EMA des valeurs SMI définies
    const sig: Array<number | undefined> = new Array(n).fill(undefined);
    const idx: number[] = [];
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = smiOut[i];
      if (v !== undefined) {
        idx.push(i);
        vals.push(v);
      }
    }
    const e = ema(vals, sigLen);
    for (let j = 0; j < e.length; j++) {
      const v = e[j];
      const i = idx[j];
      if (v !== undefined && i !== undefined) sig[i] = v;
    }

    return { series: { smi: smiOut, signal: sig } };
  },
};
