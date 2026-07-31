/**
 * @axiom/indicators — trend/vwma.ts
 *
 * VWMA (Volume Weighted Moving Average) — moyenne mobile pondérée par le volume.
 * Indicateur de tendance affiché en overlay sur les bougies.
 *
 * Formule canonique : VWMA = Σ(close × volume) / Σ(volume) sur `length` bougies.
 * Source : convention TradingView (ta.vwma).
 *
 * Les positions précédant la première fenêtre pleine valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, volOf, rollingSum } from "../utils";

export const vwma: IndicatorDef = {
  id: "vwma",
  name: "VWMA",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 1 },
  ],
  outputs: [{ key: "vwma", name: "VWMA", style: "line" }],
  calc(candles, params) {
    const length = Number(params.length ?? 20);
    const close = closeOf(candles);
    const vol = volOf(candles);
    const n = close.length;

    // Produit close × volume, aligné index par index.
    const pv: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const c = close[i];
      const v = vol[i];
      if (c !== undefined && v !== undefined) pv[i] = c * v;
    }

    const sumPv = rollingSum(pv, length);
    const sumVol = rollingSum(vol, length);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const num = sumPv[i];
      const den = sumVol[i];
      // Fenêtre incomplète -> undefined ; volume nul -> undefined (indéfini).
      if (num === undefined || den === undefined || den === 0) continue;
      out[i] = num / den;
    }

    return { series: { vwma: out } };
  },
};
