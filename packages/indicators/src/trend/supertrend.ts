/**
 * @axiom/indicators — trend/supertrend.ts
 *
 * SuperTrend — suiveur de tendance basé sur l'ATR, superposé au prix (pane overlay).
 * Source canonique : Olivier Seban ; implémentation TradingView/ATR de Wilder.
 *
 * Paramètres : période ATR = 10, multiplicateur = 3.
 *
 * Calcul :
 *   hl2          = (high + low) / 2
 *   ATR          = rma(trueRange, period)            (lissage de Wilder)
 *   bandeHaute0  = hl2 + mult * ATR
 *   bandeBasse0  = hl2 - mult * ATR
 *   bandeHaute[i]= (bandeHaute0[i] < bandeHaute[i-1] || close[i-1] > bandeHaute[i-1])
 *                    ? bandeHaute0[i] : bandeHaute[i-1]
 *   bandeBasse[i]= (bandeBasse0[i] > bandeBasse[i-1] || close[i-1] < bandeBasse[i-1])
 *                    ? bandeBasse0[i] : bandeBasse[i-1]
 *   La ligne SuperTrend suit la bande basse en tendance haussière (direction +1)
 *   et la bande haute en tendance baissière (direction -1) ; bascule au franchissement.
 *
 * Sorties : `line` (valeur de la ligne) et `direction` (+1 haussier / -1 baissier).
 * Les positions précédant la première fenêtre ATR pleine valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { trueRange, rma } from "../utils";

export const supertrend: IndicatorDef = {
  id: "supertrend",
  name: "SuperTrend",
  category: "trend",
  pane: "overlay",
  inputs: [
    { key: "period", name: "Période ATR", type: "number", default: 10, min: 1 },
    { key: "multiplier", name: "Multiplicateur", type: "number", default: 3, min: 0 },
  ],
  outputs: [
    { key: "line", name: "SuperTrend", style: "line" },
    { key: "direction", name: "Direction", style: "line" },
  ],
  calc(candles, params) {
    const period = Number(params.period ?? 10);
    const mult = Number(params.multiplier ?? 3);
    const n = candles.length;

    const line: Array<number | undefined> = new Array(n).fill(undefined);
    const direction: Array<number | undefined> = new Array(n).fill(undefined);

    const atr = rma(trueRange(candles), period);

    // Bandes de base et finales.
    const finalUpper: Array<number | undefined> = new Array(n).fill(undefined);
    const finalLower: Array<number | undefined> = new Array(n).fill(undefined);

    let prevDir = 0; // direction de la bougie précédente (+1/-1)
    let started = false;

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const a = atr[i];
      if (c === undefined || a === undefined) continue;

      const hl2 = (c.high + c.low) / 2;
      const basicUpper = hl2 + mult * a;
      const basicLower = hl2 - mult * a;

      const prevUpper = finalUpper[i - 1];
      const prevLower = finalLower[i - 1];
      const prevClose = i > 0 ? candles[i - 1]?.close : undefined;

      // Bande haute finale.
      let fu: number;
      if (prevUpper === undefined || prevClose === undefined) {
        fu = basicUpper;
      } else {
        fu =
          basicUpper < prevUpper || prevClose > prevUpper
            ? basicUpper
            : prevUpper;
      }
      // Bande basse finale.
      let fl: number;
      if (prevLower === undefined || prevClose === undefined) {
        fl = basicLower;
      } else {
        fl =
          basicLower > prevLower || prevClose < prevLower
            ? basicLower
            : prevLower;
      }
      finalUpper[i] = fu;
      finalLower[i] = fl;

      if (!started) {
        // Première valeur ATR définie : amorce en tendance haussière par convention.
        prevDir = 1;
        line[i] = fl;
        direction[i] = 1;
        started = true;
        continue;
      }

      // Bascule de tendance selon la position de la clôture vs bande retenue.
      let dir: number;
      if (prevDir === 1) {
        dir = c.close < fl ? -1 : 1;
      } else {
        dir = c.close > fu ? 1 : -1;
      }

      line[i] = dir === 1 ? fl : fu;
      direction[i] = dir;
      prevDir = dir;
    }

    return { series: { line, direction } };
  },
};
