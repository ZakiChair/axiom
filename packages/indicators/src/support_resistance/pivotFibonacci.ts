/**
 * @axiom/indicators — support_resistance/pivotFibonacci.ts
 *
 * Pivot Points Fibonacci.
 * Source canonique : TradingView "Pivot Points Standard", méthode Fibonacci.
 *
 *   PP    = (H + L + C) / 3
 *   range = H − L
 *   R1 = PP + 0.382·range    S1 = PP − 0.382·range
 *   R2 = PP + 0.618·range    S2 = PP − 0.618·range
 *   R3 = PP + 1.000·range    S3 = PP − 1.000·range
 *
 * H/L/C proviennent des EXTENTS AGRÉGÉS DU JOUR UTC PRÉCÉDENT (J-1), via
 * `sessionExtents`/`utcDayOf` (utils-session.ts) — et non de la bougie
 * précédente. Les niveaux sont constants sur toute la durée d'une session
 * (jour UTC courant). Les bougies du premier jour du buffer (pas de jour J-1
 * disponible) restent `undefined` — de même quand le jour J-1 présent dans
 * le buffer est TRONQUÉ (backfill démarrant en milieu de journée).
 */

import type { IndicatorDef } from "@axiom/types";
import { sessionExtents, utcDayOf, type SessionExtent } from "../utils-session";

// Niveaux de retracement Fibonacci utilisés par les pivots.
const FIB1 = 0.382;
const FIB2 = 0.618;
const FIB3 = 1.0;

export const pivotFibonacci: IndicatorDef = {
  id: "pivotFibonacci",
  name: "Pivot Points Fibonacci",
  category: "support_resistance",
  pane: "overlay",
  inputs: [],
  outputs: [
    { key: "pp", name: "PP", style: "line" },
    { key: "r1", name: "R1", style: "line" },
    { key: "s1", name: "S1", style: "line" },
    { key: "r2", name: "R2", style: "line" },
    { key: "s2", name: "S2", style: "line" },
    { key: "r3", name: "R3", style: "line" },
    { key: "s3", name: "S3", style: "line" },
  ],

  calc(candles) {
    const n = candles.length;
    const pp: Array<number | undefined> = new Array(n).fill(undefined);
    const r1: Array<number | undefined> = new Array(n).fill(undefined);
    const s1: Array<number | undefined> = new Array(n).fill(undefined);
    const r2: Array<number | undefined> = new Array(n).fill(undefined);
    const s2: Array<number | undefined> = new Array(n).fill(undefined);
    const r3: Array<number | undefined> = new Array(n).fill(undefined);
    const s3: Array<number | undefined> = new Array(n).fill(undefined);

    const extentsByDay = new Map<number, SessionExtent>();
    for (const e of sessionExtents(candles)) extentsByDay.set(e.dayIdx, e);

    for (let i = 0; i < n; i++) {
      const candle = candles[i];
      if (candle === undefined) continue; // garde explicite (noUncheckedIndexedAccess)

      const dayIdx = utcDayOf(candle.time);
      const prevDay = extentsByDay.get(dayIdx - 1);
      // Veille absente OU tronquée (buffer démarrant en milieu de journée) :
      // ses H/L/C ne sont pas ceux d'un jour entier -> niveaux non rendus.
      if (prevDay === undefined || prevDay.partiel) continue;

      const { high: h, low: l, close: c } = prevDay;

      const p = (h + l + c) / 3;
      const range = h - l;
      pp[i] = p;
      r1[i] = p + FIB1 * range;
      s1[i] = p - FIB1 * range;
      r2[i] = p + FIB2 * range;
      s2[i] = p - FIB2 * range;
      r3[i] = p + FIB3 * range;
      s3[i] = p - FIB3 * range;
    }

    return { series: { pp, r1, s1, r2, s2, r3, s3 } };
  },
};
