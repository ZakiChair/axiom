/**
 * @axiom/indicators — volatility/yangZhangVol.ts
 *
 * Volatilité de Yang-Zhang (OHLC + saut overnight) sur fenêtre glissante, annualisable.
 *
 *   σ²_YZ = σ²_o + k·σ²_c + (1 − k)·σ²_RS
 *   k = 0,34 / (1,34 + (N+1)/(N−1))
 *
 *   σ²_o  = variance des rendements OVERNIGHT  ln(O_t / C_{t−1})
 *   σ²_c  = variance des rendements OPEN→CLOSE  ln(C_t / O_t)
 *   σ²_RS = moyenne du terme de Rogers-Satchell (voir rogersSatchellVol)
 *
 * C'est le seul des trois estimateurs OHLC à capter le saut d'ouverture. En crypto
 * 24/7 il est proche de Rogers-Satchell (pas de vraie coupure de séance) ; sur les
 * marchés à horaires, il est le plus complet [acad].
 *
 * Conventions de fenêtre :
 *  - les N rendements overnight de la fenêtre exigent la clôture PRÉCÉDANT la
 *    première barre : le premier point est calculé à l'index `length` (pas
 *    `length − 1`), aucune valeur n'est fabriquée ;
 *  - variances de POPULATION (diviseur N), convention du package — l'article
 *    original utilise l'estimateur d'échantillon (N−1), l'écart est documenté ;
 *  - σ²_RS est une moyenne de termes (déjà des variances par barre), pas une
 *    variance de rendements.
 *
 * Défaut periodesParAn = 365 (crypto 24/7) ; 252 pour actions.
 */

import type { IndicatorDef } from "@axiom/types";

export const yangZhangVol: IndicatorDef = {
  id: "yangZhangVol",
  name: "Volatilité de Yang-Zhang",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 2, max: 200 },
    {
      key: "periodsPerYear",
      name: "Périodes par an",
      type: "number",
      default: 365,
      min: 1,
      max: 525600,
    },
  ],
  outputs: [{ key: "vol", name: "σ ann.", style: "line" }],
  precision: 2,
  calc(candles, params) {
    const length = Math.max(2, Math.floor(Number(params.length) || 20));
    const ppy = Math.max(1, Number(params.periodsPerYear) || 365);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // Termes par barre : overnight (nécessite la clôture précédente), open→close, RS.
    const overnight: Array<number | undefined> = new Array(n).fill(undefined);
    const openClose: Array<number | undefined> = new Array(n).fill(undefined);
    const rs: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      if (!(c.high > 0) || !(c.low > 0) || !(c.open > 0) || !(c.close > 0)) continue;
      const prev = candles[i - 1];
      if (i > 0 && prev !== undefined && prev.close > 0) {
        overnight[i] = Math.log(c.open / prev.close);
      }
      openClose[i] = Math.log(c.close / c.open);
      rs[i] =
        Math.log(c.high / c.close) * Math.log(c.high / c.open) +
        Math.log(c.low / c.close) * Math.log(c.low / c.open);
    }

    const k = 0.34 / (1.34 + (length + 1) / (length - 1));

    for (let i = length; i < n; i++) {
      // Fenêtre [i−length+1 .. i] : la barre i−length porte le premier overnight.
      let sumO = 0;
      let sumC = 0;
      let sumRS = 0;
      let ok = true;
      for (let j = i - length + 1; j <= i; j++) {
        const o = overnight[j];
        const c = openClose[j];
        const r = rs[j];
        if (o === undefined || c === undefined || r === undefined) {
          ok = false;
          break;
        }
        sumO += o;
        sumC += c;
        sumRS += r;
      }
      if (!ok) continue;

      const moyO = sumO / length;
      const moyC = sumC / length;
      let varO = 0;
      let varC = 0;
      for (let j = i - length + 1; j <= i; j++) {
        const o = overnight[j]!;
        const c = openClose[j]!;
        varO += (o - moyO) * (o - moyO);
        varC += (c - moyC) * (c - moyC);
      }
      varO /= length;
      varC /= length;
      const varRS = sumRS / length;

      const variance = varO + k * varC + (1 - k) * varRS;
      if (!(variance >= 0)) continue;
      out[i] = 100 * Math.sqrt(variance) * Math.sqrt(ppy);
    }
    return { series: { vol: out } };
  },
};
