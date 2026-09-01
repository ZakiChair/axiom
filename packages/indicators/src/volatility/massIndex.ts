/**
 * @axiom/indicators — volatility/massIndex.ts
 *
 * Mass Index (id: massIndex) — détection de renversement par expansion des
 * amplitudes (Donald Dorsey), pane séparé.
 *
 * Formule canonique :
 *   hl     = high - low
 *   ema1   = ema(hl, emaLength)
 *   ema2   = ema(ema1, emaLength)          (double lissage)
 *   ratio  = ema1 / ema2
 *   mass   = Σ ratio sur `sumLength` bougies
 *
 * Défauts : emaLength = 9, sumLength = 25.
 * Source : Donald Dorsey, « The Mass Index » (Stocks & Commodities, 1992).
 *
 * Remarque d'amorçage : notre `ema` s'amorce par une SMA. ema1 est défini dès
 * l'index `emaLength - 1` ; ema2, appliqué aux valeurs DÉFINIES de ema1 (compaction
 * façon MACD), n'est défini qu'à l'index `2*(emaLength - 1)` ; la somme glissante
 * livre sa première valeur à l'index `2*(emaLength - 1) + sumLength - 1`
 * (= 40 avec les défauts).
 */

import type {
  Candle,
  CalcContext,
  IndicatorDef,
  IndicatorResult,
} from "@axiom/types";
import { ema, highOf, lowOf } from "../utils";

export const massIndex: IndicatorDef = {
  id: "massIndex",
  name: "Mass Index",
  category: "volatility",
  pane: "separate",
  inputs: [
    { key: "emaLength", name: "Longueur EMA", type: "number", default: 9, min: 1 },
    { key: "sumLength", name: "Sum Length", type: "number", default: 25, min: 1 },
  ],
  outputs: [{ key: "massIndex", name: "Mass Index", style: "line" }],

  calc(
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    _ctx: CalcContext
  ): IndicatorResult {
    const emaLength = Number(params.emaLength);
    // Quantifie : boucle `i = sumLength - 1` fractionnaire n'atteint aucun index entier.
    const sumLength = Math.round(Number(params.sumLength));

    const highs = highOf(candles);
    const lows = lowOf(candles);
    const n = candles.length;

    // Amplitude high - low par bougie.
    const hl: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const h = highs[i];
      const l = lows[i];
      if (h === undefined || l === undefined) continue;
      hl[i] = h - l;
    }

    const ema1 = ema(hl, emaLength);

    // ema2 : EMA appliquée aux seules valeurs DÉFINIES de ema1, puis ré-alignée
    // (même technique que la ligne signal du MACD pour respecter l'amorçage SMA).
    const definedIdx: number[] = [];
    const definedVals: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = ema1[i];
      if (v !== undefined) {
        definedIdx.push(i);
        definedVals.push(v);
      }
    }
    const ema2Compact = ema(definedVals, emaLength);
    const ema2: Array<number | undefined> = new Array(n).fill(undefined);
    for (let j = 0; j < definedIdx.length; j++) {
      const idx = definedIdx[j];
      if (idx === undefined) continue; // garde explicite (noUncheckedIndexedAccess)
      ema2[idx] = ema2Compact[j];
    }

    // Ratio ema1 / ema2, défini quand les deux existent et ema2 != 0.
    const ratio: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const a = ema1[i];
      const b = ema2[i];
      if (a === undefined || b === undefined || b === 0) continue;
      ratio[i] = a / b;
    }

    // Somme glissante sur `sumLength` valeurs de ratio (toutes doivent exister).
    const out: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = sumLength - 1; i < n; i++) {
      let sum = 0;
      let complete = true;
      for (let j = i - sumLength + 1; j <= i; j++) {
        const r = ratio[j];
        if (r === undefined) {
          complete = false;
          break;
        }
        sum += r;
      }
      if (complete) out[i] = sum;
    }

    return { series: { massIndex: out } };
  },
};
