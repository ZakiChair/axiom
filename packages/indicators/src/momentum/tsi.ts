/**
 * @axiom/indicators — momentum/tsi.ts
 *
 * TSI (True Strength Index) de William Blau.
 *
 * Source : formule canonique (Blau 1991, reprise par TradingView / pandas-ta).
 *
 * Calcul :
 *   mom[i]   = close[i] - close[i-1]                         (momentum à 1 période)
 *   ema1     = EMA(mom, long)                                (double lissage)
 *   ema2     = EMA(ema1, short)
 *   aema1    = EMA(|mom|, long)
 *   aema2    = EMA(aema1, short)
 *   TSI      = 100 * ema2 / aema2                            (≈ borné -100..100)
 *
 * Paramètres par défaut : long = 25 (lissage lent), short = 13 (lissage rapide).
 *
 * Alignement : `mom` n'existe qu'à partir de l'index 1 ; le double EMA est calculé
 * sur la série compacte des momentums puis ré-aligné (décalage +1). Les positions
 * sans valeur valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, ema } from "../utils";

export const tsi: IndicatorDef = {
  id: "tsi",
  name: "TSI",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "long", name: "Long", type: "number", default: 25, min: 1 },
    { key: "short", name: "Short", type: "number", default: 13, min: 1 },
  ],
  outputs: [{ key: "tsi", name: "TSI", style: "line" }],

  calc(candles, params) {
    const long = Number(params.long);
    const short = Number(params.short);
    const closes = closeOf(candles);
    const n = closes.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    if (n < 2) return { series: { tsi: out } };

    // Série compacte des momentums : momVals[j] correspond à la bougie j+1.
    const momVals: number[] = new Array(n - 1).fill(0);
    const absMomVals: number[] = new Array(n - 1).fill(0);
    for (let i = 1; i < n; i++) {
      const cur = closes[i];
      const prev = closes[i - 1];
      const m = cur !== undefined && prev !== undefined ? cur - prev : 0;
      momVals[i - 1] = m;
      absMomVals[i - 1] = Math.abs(m);
    }

    // Double lissage exponentiel (long puis short) du momentum et de sa valeur absolue.
    const ema1 = ema(momVals, long);
    const aema1 = ema(absMomVals, long);

    // ema() compacte déjà : on extrait les valeurs définies pour la 2e passe en
    // mémorisant leur position d'origine (les undefined initiaux sont contigus).
    const ema2 = smoothDefined(ema1, short);
    const aema2 = smoothDefined(aema1, short);

    for (let j = 0; j < n - 1; j++) {
      const num = ema2[j];
      const den = aema2[j];
      if (num === undefined || den === undefined) continue;
      // Décalage +1 : momVals[j] provient de la bougie j+1.
      out[j + 1] = den === 0 ? 0 : 100 * (num / den);
    }

    return { series: { tsi: out } };
  },
};

/**
 * Applique une EMA aux seules valeurs DÉFINIES de `series`, puis ré-aligne le
 * résultat sur les indices d'origine (même technique que la ligne signal du MACD).
 */
function smoothDefined(
  series: Array<number | undefined>,
  length: number
): Array<number | undefined> {
  const definedIdx: number[] = [];
  const definedVals: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v !== undefined) {
      definedIdx.push(i);
      definedVals.push(v);
    }
  }
  const compact = ema(definedVals, length);
  const out: Array<number | undefined> = new Array(series.length).fill(undefined);
  for (let j = 0; j < definedIdx.length; j++) {
    const idx = definedIdx[j];
    if (idx === undefined) continue;
    out[idx] = compact[j];
  }
  return out;
}
