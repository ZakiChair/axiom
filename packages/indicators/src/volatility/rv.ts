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
 *
 * `periodesParAn` est un paramètre explicite (non auto-dérivé) car `CalcContext`
 * n'expose pas le timeframe du chart aux indicateurs : le calcul ne peut donc
 * pas déduire seul la fréquence d'échantillonnage des bougies. L'utilisateur
 * doit fournir la valeur correspondant à son timeframe : 365 pour du daily ou
 * du crypto 24-7 (défaut), 8760 pour des bougies 1h (24 × 365), 252 pour des
 * marchés actions (jours de bourse), etc.
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

    const close = closeOf(candles);
    const n = close.length;

    // Rendements logarithmiques compacts : logRet[j] correspond à la bougie j+1.
    const logRet: number[] = [];
    for (let i = 1; i < n; i++) {
      const cur = close[i];
      const prev = close[i - 1];
      if (cur === undefined || prev === undefined || prev <= 0 || cur <= 0) {
        logRet.push(0);
        continue;
      }
      logRet.push(Math.log(cur / prev));
    }

    // Écart-type populationnel (N) sur la fenêtre `length`.
    const sd = stdev(logRet, length, true);
    const factor = Math.sqrt(periodesParAn) * 100;

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let j = 0; j < sd.length; j++) {
      const s = sd[j];
      if (s === undefined) continue;
      // Décalage de +1 : le rendement j provient de la bougie j+1.
      out[j + 1] = s * factor;
    }

    return { series: { rv: out } };
  },
};
