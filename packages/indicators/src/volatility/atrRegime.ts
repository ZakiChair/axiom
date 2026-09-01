/**
 * @axiom/indicators — volatility/atrRegime.ts
 *
 * ATR Régime (id: atrRegime) — rang percentile roulant de l'ATR : la volatilité
 * courante est-elle haute ou basse par rapport à son historique récent ?
 *
 * Calcul :
 *   ATR = rma(trueRange(candles), period)
 *   — exactement le même calcul que volatility/atr.ts (True Range + lissage de
 *   Wilder), en réutilisant `trueRange` et `rma` déjà exportés par utils.ts.
 *   Aucune réimplémentation du lissage : ceci reproduit bit-à-bit la série ATR.
 *
 *   Pour chaque index i où au moins `lookback` valeurs d'ATR consécutives sont
 *   disponibles (fenêtre [i-lookback+1, i], toutes définies) :
 *     pct[i] = 100 × (nb de ATR[j] ≤ ATR[i] dans la fenêtre − 1) / (lookback − 1)
 *   Sinon (fenêtre pas encore pleine, ou ATR pas encore amorcé) : pct[i] = undefined.
 *
 * Choix documenté (pas un bug) : en cas d'égalité — ex. ATR constant sur toute
 * la fenêtre — TOUTES les valeurs de la fenêtre sont ≤ la valeur courante, donc
 * pct = 100. La formule compte les valeurs "≤ courante" ; une série plate se
 * classe donc au rang maximal (interprétation standard du rang percentile en
 * cas d'égalités : la valeur courante ne descend jamais sous une valeur qui lui
 * est strictement inférieure ou égale).
 *
 * Coût : O(lookback) par bougie (comptage direct dans la fenêtre glissante),
 * borné par `lookback` (max 1000) — indépendant de la longueur totale de la
 * série, donc pas de O(n²) global.
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { rma, trueRange } from "../utils";

export const atrRegime: IndicatorDef = {
  id: "atrRegime",
  name: "ATR Régime",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "period", name: "Période ATR", type: "number", default: 14, min: 2, max: 100 },
    { key: "lookback", name: "Fenêtre", type: "number", default: 100, min: 20, max: 1000 },
  ],
  outputs: [{ key: "pct", name: "Régime ATR %", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const period = Number(params.period);
    // Quantifie : boucle `i = lookback - 1` fractionnaire n'atteint aucun index entier.
    const lookback = Math.round(Number(params.lookback));
    const n = candles.length;

    const out: Array<number | undefined> = new Array(n).fill(undefined);
    if (lookback <= 1) return { series: { pct: out } };

    const atrSeries = rma(trueRange(candles), period);

    for (let i = lookback - 1; i < n; i++) {
      const current = atrSeries[i];
      if (current === undefined) continue;

      let countLte = 0;
      let windowFull = true;
      for (let j = i - lookback + 1; j <= i; j++) {
        const v = atrSeries[j];
        if (v === undefined) {
          windowFull = false;
          break;
        }
        if (v <= current) countLte++;
      }
      if (!windowFull) continue;

      out[i] = (100 * (countLte - 1)) / (lookback - 1);
    }

    return { series: { pct: out } };
  },
};
