/**
 * @axiom/indicators — momentum/cci.ts
 *
 * CCI (Commodity Channel Index).
 * Source : Donald Lambert / Investopedia / pandas-ta `cci`.
 *
 * Formule :
 *   tp = hlc3 = (high + low + close) / 3        (prix typique)
 *   CCI[i] = (tp[i] - SMA(tp, length)[i]) / (0.015 * meanDev[i])
 *   meanDev[i] = moyenne sur la fenêtre de |tp - SMA(tp, length)[i]|
 *
 * Le facteur 0.015 (constante de Lambert) cale ~70-80 % des valeurs dans [-100, 100].
 * Si meanDev == 0 (prix typiques constants sur la fenêtre) -> `undefined`.
 * Alignement : les `length - 1` premières positions valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { sma } from "../utils";

const LAMBERT = 0.015;

export const cci: IndicatorDef = {
  id: "cci",
  name: "CCI",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 1 },
  ],
  outputs: [{ key: "cci", name: "CCI", style: "line" }],

  calc(candles, params, ctx) {
    const length = Number(params.length ?? 20);
    const tp = ctx.hlc3; // prix typique fourni par le moteur.
    const n = tp.length;

    const tpSma = sma(tp, length);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = length - 1; i < n; i++) {
      const avg = tpSma[i];
      if (avg === undefined) continue;

      // Déviation moyenne absolue autour de la SMA sur la fenêtre.
      let devSum = 0;
      for (let j = i - length + 1; j <= i; j++) {
        const v = tp[j];
        if (v === undefined) continue;
        devSum += Math.abs(v - avg);
      }
      const meanDev = devSum / length;
      if (meanDev === 0) continue; // déviation nulle : CCI non défini.

      const cur = tp[i];
      if (cur === undefined) continue;
      out[i] = (cur - avg) / (LAMBERT * meanDev);
    }

    return { series: { cci: out } };
  },
};
