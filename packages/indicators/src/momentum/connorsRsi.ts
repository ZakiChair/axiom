/**
 * @axiom/indicators — momentum/connorsRsi.ts
 *
 * Connors RSI — moyenne de trois composantes (Larry Connors).
 * Source : Connors Research / pandas-ta `crsi` (logique de référence).
 *
 * Composantes (chacune bornée [0, 100]) :
 *   1. RSI(close, rsiLength)                      — momentum de prix (défaut 3)
 *   2. RSI(streak, streakLength)                  — momentum de la « série » (défaut 2)
 *   3. percentRank(roc1, rankLength)              — rang du rendement 1-période (défaut 100)
 *
 *   streak[i] : longueur de la série de clôtures consécutives en hausse (+) ou
 *               en baisse (-) ; 0 si clôture inchangée.
 *   roc1[i]   = 100 * (close[i] / close[i-1] - 1)
 *   percentRank[i] = 100 * (#{j ∈ [i-length, i-1] | roc1[j] < roc1[i]}) / length
 *
 *   CRSI[i] = (composante1 + composante2 + composante3) / 3
 *
 * Borne théorique : [0, 100] (moyenne de trois grandeurs bornées [0, 100]).
 * Une valeur n'apparaît que lorsque les trois composantes sont définies.
 */

import type { IndicatorDef } from "@axiom/types";
import { closeOf, rma } from "../utils";

/** RSI de Wilder sur une série de valeurs quelconque (aligné, undefined avant la fenêtre). */
function rsiOfValues(values: number[], length: number): Array<number | undefined> {
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);

  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < n; i++) {
    const cur = values[i];
    const prev = values[i - 1];
    if (cur === undefined || prev === undefined) {
      gains.push(0);
      losses.push(0);
      continue;
    }
    const delta = cur - prev;
    gains.push(delta > 0 ? delta : 0);
    losses.push(delta < 0 ? -delta : 0);
  }

  const avgGain = rma(gains, length);
  const avgLoss = rma(losses, length);
  for (let j = 0; j < gains.length; j++) {
    const g = avgGain[j];
    const l = avgLoss[j];
    if (g === undefined || l === undefined) continue;
    out[j + 1] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export const connorsRsi: IndicatorDef = {
  id: "connorsRsi",
  name: "Connors RSI",
  category: "momentum",
  pane: "separate",
  inputs: [
    { key: "rsiLength", name: "RSI", type: "number", default: 3, min: 1 },
    { key: "streakLength", name: "Streak", type: "number", default: 2, min: 1 },
    { key: "rankLength", name: "PercentRank", type: "number", default: 100, min: 1 },
  ],
  outputs: [{ key: "crsi", name: "Connors RSI", style: "line" }],

  calc(candles, params) {
    const rsiLength = Number(params.rsiLength ?? 3);
    const streakLength = Number(params.streakLength ?? 2);
    const rankLength = Number(params.rankLength ?? 100);

    const closes = closeOf(candles);
    const n = closes.length;

    // Composante 1 : RSI du prix.
    const rsiPrice = rsiOfValues(closes, rsiLength);

    // Série « streak » : compteur de clôtures consécutives en hausse/baisse.
    const streak: number[] = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const cur = closes[i];
      const prev = closes[i - 1];
      if (cur === undefined || prev === undefined) {
        streak[i] = 0;
        continue;
      }
      const prevStreak = streak[i - 1] ?? 0;
      if (cur > prev) streak[i] = prevStreak > 0 ? prevStreak + 1 : 1;
      else if (cur < prev) streak[i] = prevStreak < 0 ? prevStreak - 1 : -1;
      else streak[i] = 0;
    }

    // Composante 2 : RSI de la série streak.
    const rsiStreak = rsiOfValues(streak, streakLength);

    // Rendement 1-période, défini à partir de l'index 1.
    const roc1: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 1; i < n; i++) {
      const cur = closes[i];
      const prev = closes[i - 1];
      if (cur === undefined || prev === undefined || prev === 0) continue;
      roc1[i] = 100 * (cur / prev - 1);
    }

    // Composante 3 : percentRank du rendement sur `rankLength` valeurs antérieures.
    const pctRank: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const cur = roc1[i];
      if (cur === undefined) continue;
      if (i - rankLength < 1) continue; // fenêtre antérieure incomplète.
      let count = 0;
      let ok = true;
      for (let j = i - rankLength; j <= i - 1; j++) {
        const v = roc1[j];
        if (v === undefined) {
          ok = false;
          break;
        }
        if (v < cur) count++;
      }
      if (!ok) continue;
      pctRank[i] = (100 * count) / rankLength;
    }

    // Moyenne des trois composantes (seulement si toutes définies).
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const a = rsiPrice[i];
      const b = rsiStreak[i];
      const c = pctRank[i];
      if (a === undefined || b === undefined || c === undefined) continue;
      out[i] = (a + b + c) / 3;
    }

    return { series: { crsi: out } };
  },
};
