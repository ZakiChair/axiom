/**
 * @axiom/indicators — volatility/rv.ts
 *
 * RV (Realized Volatility / Volatilité Réalisée) — mesure annualisée de la
 * volatilité passée basée sur les log-rendements.
 *
 * Calcul :
 *   logReturns[i] = ln(close[i] / close[i-1])
 *   rv[i] = stdev_population(logReturns[i-length+1..i]) × √periodesParAn × 100
 *
 * Sortie en % (volatilité annualisée). Les `length` premières positions valent
 * `undefined` (fenêtre pleine requise pour le premier calcul).
 *
 * Alignement : conforme convention du package — `undefined` tant que la fenêtre
 * n'est pas pleine.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, stdev } from "../utils";

export const rv: IndicatorDef = {
  id: "rv",
  name: "RV (Volatilité Réalisée)",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 30, min: 2 },
    {
      key: "periodesParAn",
      name: "Périodes par an",
      type: "number",
      default: 365,
      min: 1,
    },
  ],
  outputs: [{ key: "rv", name: "RV (%)", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const length = Number(params.length);
    const periodesParAn = Number(params.periodesParAn);

    // Extraire les closes
    const closes = closeOf(candles);
    const n = closes.length;

    // Calculer les log-rendements : logReturns[i] = ln(close[i] / close[i-1])
    // logReturns est aligné sur les closes (logReturns[0] = undefined, logReturns[i] correspond au rendement jusqu'à close[i])
    const logReturns: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 1; i < n; i++) {
      const prev = closes[i - 1];
      const curr = closes[i];
      if (prev !== undefined && curr !== undefined && prev > 0) {
        logReturns[i] = Math.log(curr / prev);
      }
    }

    // Calculer la volatilité réalisée annualisée par fenêtre glissante
    // À position i, on utilise la fenêtre [i-length+1..i] des log-rendements.
    // Cela requiert length valeurs de log-rendements (donc length+1 closes).
    // La première position définie est donc à i = length.
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    const annualizationFactor = Math.sqrt(periodesParAn) * 100;

    for (let i = length; i < n; i++) {
      // Fenêtre de log-rendements : [i-length+1..i]
      let sum = 0;
      let sumSq = 0;
      let count = 0;

      for (let j = i - length + 1; j <= i; j++) {
        const v = logReturns[j];
        if (v !== undefined) {
          sum += v;
          sumSq += v * v;
          count += 1;
        }
      }

      // Calculer la variance (population) seulement si on a effectivement length valeurs
      if (count === length) {
        // Variance populationnelle = (Σx² - (Σx)²/N) / N
        let variance = (sumSq - (sum * sum) / length) / length;
        if (variance < 0) variance = 0; // Clamp contre erreurs flottantes
        const s = Math.sqrt(variance);
        out[i] = s * annualizationFactor;
      }
    }

    return { series: { rv: out } };
  },
};
