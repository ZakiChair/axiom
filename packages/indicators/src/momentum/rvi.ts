/**
 * @axiom/indicators — momentum/rvi.ts
 *
 * RVI (Relative Vigor Index) — John F. Ehlers (« Cybernetic Analysis », 2004).
 * Idée : sur un marché haussier, la clôture tend à être > à l'ouverture
 * (et inversement). On normalise (close - open) par l'amplitude (high - low).
 *
 * Formule canonique (length par défaut = 10) :
 *   co[i] = close[i] - open[i]
 *   hl[i] = high[i] - low[i]
 *   Lissage 4 barres (poids symétriques 1,2,2,1) :
 *     num4[i] = (co[i] + 2*co[i-1] + 2*co[i-2] + co[i-3]) / 6
 *     den4[i] = (hl[i] + 2*hl[i-1] + 2*hl[i-2] + hl[i-3]) / 6
 *   RVI[i]  = Σ num4 (length) / Σ den4 (length)
 *   Signal[i] = (RVI[i] + 2*RVI[i-1] + 2*RVI[i-2] + RVI[i-3]) / 6
 *
 * Alignement : num4/den4 définis dès i >= 3 ; RVI dès i >= length + 2 (fenêtre
 * de somme pleine sur des num4 définis) ; Signal dès i >= length + 5.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, highOf, lowOf } from "../utils";

export const rvi: IndicatorDef = {
  id: "rvi",
  name: "Relative Vigor Index",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 10, min: 1 },
  ],
  outputs: [
    { key: "rvi", name: "RVI", style: "line" },
    { key: "signal", name: "Signal", style: "line" },
  ],

  calc(candles, params) {
    // Quantifie : `start`/`i - length` fractionnaires n'atteignent aucun index entier.
    const length = Math.round(Number(params.length ?? 10));
    const n = candles.length;
    const closes = closeOf(candles);
    const highs = highOf(candles);
    const lows = lowOf(candles);

    // co = clôture - ouverture ; hl = amplitude. Définis pour toutes les bougies.
    const co: number[] = new Array(n).fill(0);
    const hl: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const cl = closes[i];
      const h = highs[i];
      const l = lows[i];
      if (c === undefined || cl === undefined || h === undefined || l === undefined) continue;
      co[i] = cl - c.open;
      hl[i] = h - l;
    }

    // Lissage symétrique 4 barres (poids 1,2,2,1 -> /6), défini dès i >= 3.
    const num4: Array<number | undefined> = new Array(n).fill(undefined);
    const den4: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 3; i < n; i++) {
      const a0 = co[i];
      const a1 = co[i - 1];
      const a2 = co[i - 2];
      const a3 = co[i - 3];
      const b0 = hl[i];
      const b1 = hl[i - 1];
      const b2 = hl[i - 2];
      const b3 = hl[i - 3];
      if (
        a0 === undefined || a1 === undefined || a2 === undefined || a3 === undefined ||
        b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined
      ) {
        continue;
      }
      num4[i] = (a0 + 2 * a1 + 2 * a2 + a3) / 6;
      den4[i] = (b0 + 2 * b1 + 2 * b2 + b3) / 6;
    }

    // RVI = Σ num4 / Σ den4 sur `length` valeurs définies (donc i >= length + 2).
    const rviLine: Array<number | undefined> = new Array(n).fill(undefined);
    const start = length + 2;
    for (let i = start; i < n; i++) {
      let sumNum = 0;
      let sumDen = 0;
      let full = true;
      for (let k = i - length + 1; k <= i; k++) {
        const num = num4[k];
        const den = den4[k];
        if (num === undefined || den === undefined) {
          full = false;
          break;
        }
        sumNum += num;
        sumDen += den;
      }
      if (full && sumDen !== 0) rviLine[i] = sumNum / sumDen;
    }

    // Signal = lissage symétrique 4 barres du RVI.
    const signal: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 3; i < n; i++) {
      const r0 = rviLine[i];
      const r1 = rviLine[i - 1];
      const r2 = rviLine[i - 2];
      const r3 = rviLine[i - 3];
      if (r0 === undefined || r1 === undefined || r2 === undefined || r3 === undefined) continue;
      signal[i] = (r0 + 2 * r1 + 2 * r2 + r3) / 6;
    }

    return { series: { rvi: rviLine, signal } };
  },
};
