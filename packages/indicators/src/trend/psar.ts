/**
 * @axiom/indicators — trend/psar.ts
 *
 * Parabolic SAR (Stop And Reverse) de J. Welles Wilder.
 * Source canonique : Wilder, « New Concepts in Technical Trading Systems » (1978) ;
 * implémentation StockCharts.
 *
 * Paramètres : AF initial/step = 0.02, AF max = 0.2.
 *
 * Algorithme itératif (un point SAR par bougie, affiché en `points`) :
 *   SAR(n+1) = SAR(n) + AF * (EP - SAR(n))
 *   - EP (Extreme Point) = plus haut atteint en tendance haussière / plus bas en baissière.
 *   - AF augmente de `step` à chaque nouvel extrême (plafonné à `max`).
 *   - En tendance haussière, le SAR ne peut dépasser les bas des 2 bougies précédentes
 *     (et inversement). Si le prix franchit le SAR -> renversement : SAR = EP précédent,
 *     EP = extrême de la bougie courante, AF réinitialisé à `step`.
 *
 * Amorce : tendance initiale déduite de close[1] vs close[0]. Index 0 -> `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf } from "../utils";

export const psar: IndicatorDef = {
  id: "psar",
  name: "Parabolic SAR",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "step", name: "AF step", type: "number", default: 0.02, min: 0 },
    { key: "max", name: "AF max", type: "number", default: 0.2, min: 0 },
  ],
  outputs: [{ key: "psar", name: "SAR", style: "points" }],
  calc(candles, params) {
    const step = Number(params.step ?? 0.02);
    const max = Number(params.max ?? 0.2);

    const highs = highOf(candles);
    const lows = lowOf(candles);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    if (n < 2) return { series: { psar: out } };

    const c0 = candles[0];
    const c1 = candles[1];
    if (c0 === undefined || c1 === undefined) return { series: { psar: out } };

    // Amorce : tendance initiale via la pente close[1] - close[0].
    let uptrend = c1.close >= c0.close;
    let af = step;
    let ep = uptrend ? c1.high : c1.low; // extrême courant
    let sar = uptrend ? c0.low : c0.high; // SAR initial
    out[1] = sar;

    for (let i = 2; i < n; i++) {
      const hi = highs[i];
      const lo = lows[i];
      const hiPrev = highs[i - 1];
      const loPrev = lows[i - 1];
      const hiPrev2 = highs[i - 2];
      const loPrev2 = lows[i - 2];
      if (
        hi === undefined ||
        lo === undefined ||
        hiPrev === undefined ||
        loPrev === undefined ||
        hiPrev2 === undefined ||
        loPrev2 === undefined
      ) {
        out[i] = sar;
        continue;
      }

      // Avancée du SAR vers l'extrême.
      sar = sar + af * (ep - sar);

      if (uptrend) {
        // Le SAR ne franchit pas les bas des 2 bougies précédentes.
        sar = Math.min(sar, loPrev, loPrev2);
        if (lo < sar) {
          // Renversement -> baissier.
          uptrend = false;
          sar = ep;
          ep = lo;
          af = step;
        } else if (hi > ep) {
          ep = hi;
          af = Math.min(af + step, max);
        }
      } else {
        // Le SAR ne franchit pas les hauts des 2 bougies précédentes.
        sar = Math.max(sar, hiPrev, hiPrev2);
        if (hi > sar) {
          // Renversement -> haussier.
          uptrend = true;
          sar = ep;
          ep = hi;
          af = step;
        } else if (lo < ep) {
          ep = lo;
          af = Math.min(af + step, max);
        }
      }
      out[i] = sar;
    }

    return { series: { psar: out } };
  },
};
