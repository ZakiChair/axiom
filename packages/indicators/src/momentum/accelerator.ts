/**
 * @axiom/indicators — momentum/accelerator.ts
 *
 * Accelerator Oscillator (Bill Williams).
 *
 * Source : formule canonique (Bill Williams, reprise par TradingView / pandas-ta).
 *
 * Calcul :
 *   median[i] = (high + low) / 2                  (hl2)
 *   AO        = SMA(median, fast) - SMA(median, slow)
 *   AC        = AO - SMA(AO, smaLength)
 *
 * Paramètres canoniques : fast = 5, slow = 34, smaLength = 5. Rendu en histogramme.
 *
 * Alignement : AO débute à l'index `slow - 1` ; AC ajoute encore `smaLength - 1`
 * positions pour la SMA de l'AO. Les positions sans valeur valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { sma } from "../utils";

export const accelerator: IndicatorDef = {
  id: "accelerator",
  name: "Accelerator Oscillator",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "fast", name: "Fast", type: "number", default: 5, min: 1 },
    { key: "slow", name: "Slow", type: "number", default: 34, min: 1 },
    { key: "smaLength", name: "SMA AO", type: "number", default: 5, min: 1 },
  ],
  outputs: [{ key: "ac", name: "AC", style: "histogram" }],

  calc(candles, params, ctx) {
    const fast = Number(params.fast);
    const slow = Number(params.slow);
    const smaLength = Number(params.smaLength);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // Awesome Oscillator = SMA(hl2, fast) - SMA(hl2, slow).
    const median = ctx.hl2;
    const smaFast = sma(median, fast);
    const smaSlow = sma(median, slow);
    const ao: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const f = smaFast[i];
      const s = smaSlow[i];
      if (f !== undefined && s !== undefined) ao[i] = f - s;
    }

    // SMA de l'AO appliquée aux seules valeurs définies, puis ré-alignée.
    const definedIdx: number[] = [];
    const definedVals: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = ao[i];
      if (v !== undefined) {
        definedIdx.push(i);
        definedVals.push(v);
      }
    }
    const smaAoCompact = sma(definedVals, smaLength);
    const smaAo: Array<number | undefined> = new Array(n).fill(undefined);
    for (let j = 0; j < definedIdx.length; j++) {
      const idx = definedIdx[j];
      if (idx === undefined) continue;
      smaAo[idx] = smaAoCompact[j];
    }

    for (let i = 0; i < n; i++) {
      const a = ao[i];
      const m = smaAo[i];
      if (a === undefined || m === undefined) continue;
      out[i] = a - m;
    }

    return { series: { ac: out } };
  },
};
