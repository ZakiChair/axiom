/**
 * @axiom/indicators — volatility/relativeVolatilityIndex.ts
 *
 * Relative Volatility Index (id: relativeVolatilityIndex) — RVI de Donald Dorsey,
 * pane séparé, borné [0, 100].
 *
 * Formule canonique (Donald Dorsey, 1993) :
 *   sd  = stdev(close, stdevLength, population = true)
 *   Pour chaque bougie, direction donnée par le PRIX (close), amplitude par sd :
 *     si close[i] >  close[i-1] :  Uval = sd[i], Dval = 0
 *     si close[i] <= close[i-1] :  Uval = 0,     Dval = sd[i]
 *   U   = rma(Uval, smoothLength)        (lissage de Wilder, cf. RSI)
 *   D   = rma(Dval, smoothLength)
 *   RVI = 100 * U / (U + D)              (U + D == 0  ->  undefined)
 *
 * Défauts : stdevLength = 10, smoothLength = 14.
 * Source : Donald Dorsey, « The Relative Volatility Index » (Stocks & Commodities,
 * 1993). C'est bien un RSI dont les variations de prix sont remplacées par
 * l'écart-type — la direction reste celle du prix.
 *
 * Alignement : sd démarre à l'index `stdevLength - 1` ; le lissage RMA décale
 * encore la première valeur RVI.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { closeOf, rma, stdev } from "../utils";

export const relativeVolatilityIndex: IndicatorDef = {
  id: "relativeVolatilityIndex",
  name: "Relative Volatility Index",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "stdevLength", name: "StdDev Length", type: "number", default: 10, min: 1 },
    { key: "smoothLength", name: "Smooth Length", type: "number", default: 14, min: 1 },
  ],
  outputs: [{ key: "rvi", name: "RVI", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const stdevLength = Number(params.stdevLength);
    const smoothLength = Number(params.smoothLength);

    const close = closeOf(candles);
    const n = close.length;

    const sd = stdev(close, stdevLength, true);

    // Répartition de l'écart-type selon la direction du prix.
    // 0 par défaut là où sd ou la direction ne sont pas définis.
    const up: number[] = new Array(n).fill(0);
    const down: number[] = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const s = sd[i];
      const cur = close[i];
      const prev = close[i - 1];
      if (s === undefined || cur === undefined || prev === undefined) continue;
      if (cur > prev) up[i] = s;
      else down[i] = s;
    }

    const u = rma(up, smoothLength);
    const d = rma(down, smoothLength);

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    // La première fenêtre RMA pleine commence quand sd est déjà amorcé : on
    // n'émet une valeur que lorsque les deux moyennes existent.
    for (let i = 0; i < n; i++) {
      const uu = u[i];
      const dd = d[i];
      if (uu === undefined || dd === undefined) continue;
      const sum = uu + dd;
      if (sum === 0) continue; // aucune volatilité directionnelle -> indéfini
      out[i] = (100 * uu) / sum;
    }

    return { series: { rvi: out } };
  },
};
