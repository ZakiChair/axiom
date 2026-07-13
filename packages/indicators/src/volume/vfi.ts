/**
 * @axiom/indicators — volume/vfi.ts
 *
 * Volume Flow Indicator (simplifié, M. Skinner / community) :
 *   typical = hlc3
 *   inter   = log(typical) − log(typical[1])
 *   vinter  = stdev(inter, length)
 *   cutoff  = coef · vinter
 *   vave    = sma(volume, length)
 *   si |inter| > cutoff → volume « directionnel » signé par inter, sinon 0
 *   VFI     = EMA( sum volume signé , length )
 * Pression volume filtrée du bruit de range.
 */

import type { IndicatorDef } from "@axiom/types";
import { ema, sma, stdev, volOf } from "../utils";

export const vfi: IndicatorDef = {
  id: "vfi",
  name: "Volume Flow (VFI)",
  category: "volume",
  pane: "separate",
  precision: 0,
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 130, min: 10, max: 300 },
    { key: "coef", name: "Cutoff coef", type: "number", default: 0.2, min: 0.01, max: 2 },
    { key: "vcoef", name: "Vol max coef", type: "number", default: 2.5, min: 1, max: 10 },
  ],
  outputs: [{ key: "vfi", name: "VFI", style: "line" }],
  calc(candles, params, ctx) {
    const length = Math.max(10, Math.floor(Number(params.length) || 130));
    const coef = Number(params.coef) || 0.2;
    const vcoef = Number(params.vcoef) || 2.5;
    const n = candles.length;
    const hlc3 = ctx.hlc3;
    const vol = volOf(candles);
    const inter: number[] = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const t = hlc3[i];
      const p = hlc3[i - 1];
      if (t === undefined || p === undefined || t <= 0 || p <= 0) continue;
      inter[i] = Math.log(t) - Math.log(p);
    }
    const vinter = stdev(inter, length);
    const vave = sma(vol, length);
    const mf: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const vi = vinter[i];
      const va = vave[i];
      const v = vol[i];
      if (vi === undefined || va === undefined || v === undefined) continue;
      const cutoff = coef * vi;
      const vmax = va * vcoef;
      const vc = Math.min(v, vmax);
      const d = inter[i] ?? 0;
      if (d > cutoff) mf[i] = vc;
      else if (d < -cutoff) mf[i] = -vc;
      else mf[i] = 0;
    }
    // Cumul puis EMA
    const cum: number[] = new Array(n).fill(0);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += mf[i] ?? 0;
      cum[i] = acc;
    }
    const smoothed = ema(cum, length);
    return { series: { vfi: smoothed } };
  },
};
