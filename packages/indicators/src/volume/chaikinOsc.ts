/**
 * @axiom/indicators — volume/chaikinOsc.ts
 *
 * Chaikin Oscillator — Marc Chaikin.
 * Source : StockCharts "Chaikin Oscillator".
 *
 * Formules :
 *   ADL    = cumul de CLV*volume  (cf. adLine ; recalculé ici pour rester autonome)
 *   osc[i] = EMA(ADL, fast)[i] - EMA(ADL, slow)[i]   (fast=3, slow=10 par défaut)
 *
 * L'ADL étant définie dès la 1re bougie, l'EMA lente (slow) impose
 * `slow - 1` positions `undefined` en tête ; l'oscillateur démarre à l'index slow-1.
 */

import type { IndicatorDef } from "@axiom/types";
import { ema } from "../utils";

export const chaikinOsc: IndicatorDef = {
  id: "chaikinOsc",
  name: "Chaikin Oscillator",
  category: "volume",
  pane: "separate",
  inputs: [
    { key: "fast", name: "Rapide", type: "number", default: 3, min: 1 },
    { key: "slow", name: "Lente", type: "number", default: 10, min: 1 },
  ],
  outputs: [{ key: "chaikinOsc", name: "Chaikin Osc", style: "line" }],
  calc(candles, params) {
    const fast = Number(params.fast ?? 3);
    const slow = Number(params.slow ?? 10);
    const n = candles.length;

    // ADL recalculée inline (autonomie du fichier).
    const adl: number[] = new Array(n).fill(0);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c !== undefined) {
        const range = c.high - c.low;
        const clv = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
        acc += clv * c.volume;
      }
      adl[i] = acc;
    }

    const emaFast = ema(adl, fast);
    const emaSlow = ema(adl, slow);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const f = emaFast[i];
      const s = emaSlow[i];
      if (f !== undefined && s !== undefined) out[i] = f - s;
    }
    return { series: { chaikinOsc: out } };
  },
};
