/**
 * @axiom/indicators — volume/kyleLambda.ts
 *
 * Lambda de Kyle approché sur bougies : impact de prix par unité de DÉSÉQUILIBRE
 * de flux agresseur (taker), en points de base. Catégorie `orderflow` (comme les
 * autres defs qui dépendent du split taker), données OHLCV + buyVolume/sellVolume.
 *
 *   q_j = (buyVolume_j − sellVolume_j) / (buyVolume_j + sellVolume_j)   ∈ [−1, 1]
 *   r_j = ln(close_j / close_{j−1})
 *   λ   = 10^4 · cov(r, q) / var(q)          (cov/var de population)
 *
 * q est NORMALISÉ par le volume de la barre : λ se lit alors en « points de base
 * par unité de déséquilibre », comparable entre actifs et entre échelles de volume.
 * Un λ élevé = chaque unité d'agression déplace le prix davantage (carnet mince).
 *
 * Différence avec Amihud (amihudIlliq) : Amihud mesure |prix|/volume TOTAL (impact
 * moyen, sans direction) ; Kyle λ ne regarde que le flux NET signé — c'est le
 * coefficient de la relation Δp ≈ λ · flux des études de microstructure [acad].
 *
 * RÉGRESSION de population sur la fenêtre positionnelle des `length` rendements ;
 * `undefined` si la fenêtre est incomplète, si une barre n'a pas de split taker
 * (buyVolume/sellVolume), si un volume est nul, ou si var(q) = 0 (déséquilibre
 * constant → pente non identifiable). Dépend du split taker : l'app marque cet
 * indicateur UNUSABLE hors Binance, comme le CVD.
 *
 * Approximation assumée : la barre agrège plusieurs trades ; le flux signé exact
 * (tick par tick) n'est pas reconstruit — la fenêtre doit être assez longue pour
 * moyenner ce bruit (défaut 100).
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";

export const kyleLambda: IndicatorDef = {
  id: "kyleLambda",
  name: "Lambda de Kyle (impact)",
  category: "orderflow",
  pane: "separate",
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 100, min: 20, max: 500 },
  ],
  outputs: [{ key: "lambda", name: "λ (pb / déséquilibre)", style: "line" }],
  precision: 2,
  calc(candles, params) {
    const length = clampInt(params.length, 100, 20, 500);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // q_j et r_j par barre — undefined dès qu'une entrée manque.
    const q: Array<number | undefined> = new Array(n).fill(undefined);
    const r: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      const buy = c.buyVolume;
      const sell = c.sellVolume;
      if (buy === undefined || sell === undefined) continue;
      if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy < 0 || sell < 0) continue;
      const total = buy + sell;
      if (!(total > 0)) continue;
      q[i] = (buy - sell) / total;

      const prev = candles[i - 1];
      if (i > 0 && prev !== undefined && prev.close > 0 && c.close > 0) {
        r[i] = Math.log(c.close / prev.close);
      }
    }

    for (let i = length; i < n; i++) {
      let sumQ = 0;
      let sumR = 0;
      let ok = true;
      for (let j = i - length + 1; j <= i; j++) {
        const qj = q[j];
        const rj = r[j];
        if (qj === undefined || rj === undefined) {
          ok = false;
          break;
        }
        sumQ += qj;
        sumR += rj;
      }
      if (!ok) continue;

      const moyQ = sumQ / length;
      const moyR = sumR / length;
      let cov = 0;
      let varQ = 0;
      for (let j = i - length + 1; j <= i; j++) {
        const dq = q[j]! - moyQ;
        cov += dq * (r[j]! - moyR);
        varQ += dq * dq;
      }
      cov /= length;
      varQ /= length;
      // Garde RELATIVE : q constant laisse une variance de bruit (~1e-32) qui
      // produirait un λ arbitraire. q ∈ [−1, 1] : 1e-12 est très en dessous de
      // toute dispersion réelle et très au-dessus du bruit flottant.
      if (!(varQ > 1e-12)) continue;

      out[i] = 1e4 * (cov / varQ);
    }

    return { series: { lambda: out } };
  },
};
