/**
 * @axiom/indicators — volume/cmf.ts
 *
 * Chaikin Money Flow (CMF) — Marc Chaikin.
 * Source : StockCharts "Chaikin Money Flow (CMF)".
 *
 * Formules (sur une fenêtre de `length` bougies) :
 *   CLV[i] = ((c - l) - (h - c)) / (h - l)   (0 si h == l)
 *   MFV[i] = CLV[i] * volume[i]
 *   CMF[i] = Σ(MFV, length)[i] / Σ(volume, length)[i]
 *
 * Borné dans [-1, 1] (somme pondérée de CLV ∈ [-1,1]).
 * Les `length - 1` premières positions valent `undefined` ; idem si la somme des
 * volumes de la fenêtre vaut 0 (CMF non défini).
 */

import type { IndicatorDef } from "@axiom/types";
import { volOf, rollingSum } from "../utils";

export const cmf: IndicatorDef = {
  id: "cmf",
  name: "Chaikin Money Flow",
  category: "volume",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 1 },
  ],
  outputs: [{ key: "cmf", name: "CMF", style: "line" }],
  calc(candles, params) {
    const length = Number(params.length ?? 20);
    const n = candles.length;

    const mfv: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      const range = c.high - c.low;
      const clv = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
      mfv[i] = clv * c.volume;
    }

    const sumMfv = rollingSum(mfv, length);
    const sumVol = rollingSum(volOf(candles), length);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const m = sumMfv[i];
      const v = sumVol[i];
      if (m === undefined || v === undefined || v === 0) continue;
      out[i] = m / v;
    }
    return { series: { cmf: out } };
  },
};
