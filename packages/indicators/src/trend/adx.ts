/**
 * @axiom/indicators — trend/adx.ts
 *
 * ADX / DMI (Average Directional Index + Directional Movement) de J. Welles Wilder.
 * Source canonique : Wilder, « New Concepts in Technical Trading Systems » (1978) ;
 * implémentation StockCharts. Affiché dans un pane séparé.
 *
 * Calcul (Wilder, length = 14) :
 *   upMove   = high[i] - high[i-1]
 *   downMove = low[i-1] - low[i]
 *   +DM = (upMove > downMove && upMove > 0)   ? upMove   : 0
 *   -DM = (downMove > upMove && downMove > 0) ? downMove : 0
 *   TR  = trueRange
 *   Lissage de Wilder (rma) de +DM, -DM, TR sur `length`.
 *   +DI = 100 * rma(+DM) / rma(TR)
 *   -DI = 100 * rma(-DM) / rma(TR)
 *   DX  = 100 * |+DI - -DI| / (+DI + -DI)
 *   ADX = rma(DX, length)
 *
 * Alignement : les séries +DM/-DM/TR sont indexées sur la bougie courante (à partir de
 * i=1) puis compactées (longueur n-1) avant lissage et ré-alignées (+1), à l'instar du RSI.
 * Les positions sans fenêtre pleine valent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { highOf, lowOf, trueRange, rma } from "../utils";

export const adx: IndicatorDef = {
  id: "adx",
  name: "ADX / DMI",
  category: "trend",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 14, min: 1 },
  ],
  outputs: [
    { key: "plusDI", name: "+DI", style: "line" },
    { key: "minusDI", name: "-DI", style: "line" },
    { key: "adx", name: "ADX", style: "line" },
  ],
  calc(candles, params) {
    const length = Number(params.length ?? 14);
    const highs = highOf(candles);
    const lows = lowOf(candles);
    const tr = trueRange(candles);
    const n = candles.length;

    const plusDI: Array<number | undefined> = new Array(n).fill(undefined);
    const minusDI: Array<number | undefined> = new Array(n).fill(undefined);
    const adxOut: Array<number | undefined> = new Array(n).fill(undefined);

    // Séries compactées (index j -> bougie j+1).
    const dmP: number[] = [];
    const dmM: number[] = [];
    const trC: number[] = [];
    for (let i = 1; i < n; i++) {
      const h = highs[i];
      const hPrev = highs[i - 1];
      const l = lows[i];
      const lPrev = lows[i - 1];
      const t = tr[i];
      if (
        h === undefined ||
        hPrev === undefined ||
        l === undefined ||
        lPrev === undefined ||
        t === undefined
      ) {
        dmP.push(0);
        dmM.push(0);
        trC.push(0);
        continue;
      }
      const upMove = h - hPrev;
      const downMove = lPrev - l;
      dmP.push(upMove > downMove && upMove > 0 ? upMove : 0);
      dmM.push(downMove > upMove && downMove > 0 ? downMove : 0);
      trC.push(t);
    }

    const smP = rma(dmP, length);
    const smM = rma(dmM, length);
    const smT = rma(trC, length);

    // DX compacté pour pouvoir lisser l'ADX sur ses seules valeurs définies.
    const dxIdx: number[] = [];
    const dxVal: number[] = [];
    for (let j = 0; j < smP.length; j++) {
      const p = smP[j];
      const m = smM[j];
      const t = smT[j];
      if (p === undefined || m === undefined || t === undefined) continue;
      const pdi = t === 0 ? 0 : (100 * p) / t;
      const mdi = t === 0 ? 0 : (100 * m) / t;
      // Décalage +1 : la valeur compacte j correspond à la bougie j+1.
      plusDI[j + 1] = pdi;
      minusDI[j + 1] = mdi;
      const denom = pdi + mdi;
      const dx = denom === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / denom;
      dxIdx.push(j + 1);
      dxVal.push(dx);
    }

    // ADX = lissage de Wilder du DX, ré-aligné sur les index d'origine.
    const adxCompact = rma(dxVal, length);
    for (let k = 0; k < dxIdx.length; k++) {
      const idx = dxIdx[k];
      if (idx === undefined) continue;
      adxOut[idx] = adxCompact[k];
    }

    return { series: { plusDI, minusDI, adx: adxOut } };
  },
};
