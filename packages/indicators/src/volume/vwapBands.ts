/**
 * @axiom/indicators — volume/vwapBands.ts
 *
 * VWAP Bands — VWAP de session encadrée par ± k écarts-types pondérés volume.
 * Source : TradingView "VWAP with standard deviation bands".
 *
 * Formules cumulatives (session = intégralité du jeu fourni, MVP sans reset) :
 *   tp[i]     = hlc3 (fourni par ctx.hlc3)
 *   cumTPV    = Σ tp*vol ; cumVol = Σ vol ; cumTP2V = Σ tp²*vol
 *   vwap[i]   = cumTPV / cumVol
 *   var[i]    = cumTP2V / cumVol - vwap²       (variance pondérée volume, clampée ≥ 0)
 *   upper[i]  = vwap + mult * sqrt(var)
 *   lower[i]  = vwap - mult * sqrt(var)
 *
 * Indéfini tant que le volume cumulé vaut 0 (cf. vwap.ts). Invariant garanti :
 * upper ≥ basis ≥ lower.
 */

import type { IndicatorDef } from "@axiom/types";

export const vwapBands: IndicatorDef = {
  id: "vwapBands",
  name: "VWAP Bands",
  category: "volume",
  pane: "overlay",
  inputs: [
    { key: "mult", name: "Multiplicateur σ", type: "number", default: 1, min: 0 },
  ],
  outputs: [
    { key: "basis", name: "VWAP", style: "line" },
    { key: "upper", name: "Bande sup.", style: "band" },
    { key: "lower", name: "Bande inf.", style: "band" },
  ],
  calc(candles, params, ctx) {
    const mult = Number(params.mult ?? 1);
    const n = candles.length;
    const basis: Array<number | undefined> = new Array(n).fill(undefined);
    const upper: Array<number | undefined> = new Array(n).fill(undefined);
    const lower: Array<number | undefined> = new Array(n).fill(undefined);

    let cumTPV = 0;
    let cumVol = 0;
    let cumTP2V = 0;

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const tp = ctx.hlc3[i];
      if (c === undefined || tp === undefined) continue;

      cumTPV += tp * c.volume;
      cumTP2V += tp * tp * c.volume;
      cumVol += c.volume;

      if (cumVol > 0) {
        const vwap = cumTPV / cumVol;
        let variance = cumTP2V / cumVol - vwap * vwap;
        if (variance < 0) variance = 0; // garde flottante (cf. stdev de utils.ts)
        const sd = Math.sqrt(variance);
        basis[i] = vwap;
        upper[i] = vwap + mult * sd;
        lower[i] = vwap - mult * sd;
      }
    }

    return { series: { basis, upper, lower } };
  },
};
