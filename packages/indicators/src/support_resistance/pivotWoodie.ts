/**
 * @axiom/indicators — support_resistance/pivotWoodie.ts
 *
 * Pivot Points Woodie.
 * Source canonique : TradingView "Pivot Points Standard", méthode Woodie.
 *
 *   PP = (H + L + 2·C) / 4          (la clôture est pondérée double)
 *   R1 = 2·PP − L      S1 = 2·PP − H
 *   R2 = PP + (H − L)  S2 = PP − (H − L)
 *
 * H/L/C proviennent des EXTENTS AGRÉGÉS DU JOUR UTC PRÉCÉDENT (J-1), via
 * `sessionExtents`/`utcDayOf` (utils-session.ts) — et non de la bougie
 * précédente. Les niveaux sont constants sur toute la durée d'une session
 * (jour UTC courant). Les bougies du premier jour du buffer (pas de jour J-1
 * disponible) restent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { sessionExtents, utcDayOf, type SessionExtent } from "../utils-session";

export const pivotWoodie: IndicatorDef = {
  id: "pivotWoodie",
  name: "Pivot Points Woodie",
  category: "support_resistance",
  pane: "overlay",
  inputs: [],
  outputs: [
    { key: "pp", name: "PP", style: "line" },
    { key: "r1", name: "R1", style: "line" },
    { key: "s1", name: "S1", style: "line" },
    { key: "r2", name: "R2", style: "line" },
    { key: "s2", name: "S2", style: "line" },
  ],

  calc(candles) {
    const n = candles.length;
    const pp: Array<number | undefined> = new Array(n).fill(undefined);
    const r1: Array<number | undefined> = new Array(n).fill(undefined);
    const s1: Array<number | undefined> = new Array(n).fill(undefined);
    const r2: Array<number | undefined> = new Array(n).fill(undefined);
    const s2: Array<number | undefined> = new Array(n).fill(undefined);

    const extentsByDay = new Map<number, SessionExtent>();
    for (const e of sessionExtents(candles)) extentsByDay.set(e.dayIdx, e);

    for (let i = 0; i < n; i++) {
      const candle = candles[i];
      if (candle === undefined) continue; // garde explicite (noUncheckedIndexedAccess)

      const dayIdx = utcDayOf(candle.time);
      const prevDay = extentsByDay.get(dayIdx - 1);
      if (prevDay === undefined) continue; // pas de jour J-1 dans le buffer

      const { high: h, low: l, close: c } = prevDay;

      const p = (h + l + 2 * c) / 4;
      pp[i] = p;
      r1[i] = 2 * p - l;
      s1[i] = 2 * p - h;
      r2[i] = p + (h - l);
      s2[i] = p - (h - l);
    }

    return { series: { pp, r1, s1, r2, s2 } };
  },
};
