/**
 * @axiom/indicators — trend/vortex.ts
 *
 * Vortex Indicator (Etienne Botes & Douglas Siepman, 2010).
 * Source canonique : StockCharts / article original « Technical Analysis of Stocks
 * & Commodities ». Affiché dans un pane séparé.
 *
 * Calcul (n = 14) :
 *   VM+ = |high[i] - low[i-1]|
 *   VM- = |low[i]  - high[i-1]|
 *   TR  = trueRange
 *   VI+ = somme(VM+, n) / somme(TR, n)
 *   VI- = somme(VM-, n) / somme(TR, n)
 *
 * Alignement : VM+/VM-/TR définis à partir de i=1 ; compactés (longueur n-1), sommés
 * en fenêtre roulante, puis ré-alignés (+1). Première valeur à l'index n. Avant : `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf, trueRange, rollingSum } from "../utils";

export const vortex: IndicatorDef = {
  id: "vortex",
  name: "Vortex",
  category: "trend",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 1 },
  ],
  outputs: [
    { key: "viPlus", name: "VI+", style: "line" },
    { key: "viMinus", name: "VI-", style: "line" },
  ],
  calc(candles, params) {
    const length = Number(params.length ?? 14);
    const highs = highOf(candles);
    const lows = lowOf(candles);
    const tr = trueRange(candles);
    const n = candles.length;

    const viPlus: Array<number | undefined> = new Array(n).fill(undefined);
    const viMinus: Array<number | undefined> = new Array(n).fill(undefined);

    // Séries compactées (index j -> bougie j+1).
    const vmP: number[] = [];
    const vmM: number[] = [];
    const trC: number[] = [];
    for (let i = 1; i < n; i++) {
      const h = highs[i];
      const l = lows[i];
      const hPrev = highs[i - 1];
      const lPrev = lows[i - 1];
      const t = tr[i];
      if (
        h === undefined ||
        l === undefined ||
        hPrev === undefined ||
        lPrev === undefined ||
        t === undefined
      ) {
        vmP.push(0);
        vmM.push(0);
        trC.push(0);
        continue;
      }
      vmP.push(Math.abs(h - lPrev));
      vmM.push(Math.abs(l - hPrev));
      trC.push(t);
    }

    const sumP = rollingSum(vmP, length);
    const sumM = rollingSum(vmM, length);
    const sumT = rollingSum(trC, length);

    for (let j = 0; j < sumT.length; j++) {
      const p = sumP[j];
      const m = sumM[j];
      const t = sumT[j];
      if (p === undefined || m === undefined || t === undefined || t === 0) continue;
      // Décalage +1 : la valeur compacte j correspond à la bougie j+1.
      viPlus[j + 1] = p / t;
      viMinus[j + 1] = m / t;
    }

    return { series: { viPlus, viMinus } };
  },
};
