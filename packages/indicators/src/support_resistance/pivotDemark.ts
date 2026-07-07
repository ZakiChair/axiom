/**
 * @axiom/indicators — support_resistance/pivotDemark.ts
 *
 * Pivot Points DeMark.
 * Source canonique : TradingView "Pivot Points Standard", méthode DeMark.
 *
 * On choisit X selon la position de la clôture vs l'ouverture de la bougie :
 *   si C < O :  X = H + 2·L + C
 *   si C > O :  X = 2·H + L + C
 *   si C = O :  X = H + L + 2·C
 * Puis :
 *   PP = X / 4
 *   R1 = X/2 − L
 *   S1 = X/2 − H
 *
 * DeMark ne définit qu'un seul couple support/résistance (R1/S1) autour du pivot.
 *
 * O/H/L/C proviennent des EXTENTS AGRÉGÉS DU JOUR UTC PRÉCÉDENT (J-1), via
 * `sessionExtents`/`utcDayOf` (utils-session.ts) — et non de la bougie
 * précédente (`open` = ouverture de la première bougie du jour J-1). Les
 * niveaux sont constants sur toute la durée d'une session (jour UTC
 * courant). Les bougies du premier jour du buffer (pas de jour J-1
 * disponible) restent `undefined`.
 */

import type { IndicatorDef } from "@axiom/types";
import { sessionExtents, utcDayOf, type SessionExtent } from "../utils-session";

export const pivotDemark: IndicatorDef = {
  id: "pivotDemark",
  name: "Pivot Points DeMark",
  category: "support_resistance",
  pane: "overlay",
  inputs: [],
  outputs: [
    { key: "pp", name: "PP", style: "line" },
    { key: "r1", name: "R1", style: "line" },
    { key: "s1", name: "S1", style: "line" },
  ],

  calc(candles) {
    const n = candles.length;
    const pp: Array<number | undefined> = new Array(n).fill(undefined);
    const r1: Array<number | undefined> = new Array(n).fill(undefined);
    const s1: Array<number | undefined> = new Array(n).fill(undefined);

    const extentsByDay = new Map<number, SessionExtent>();
    for (const e of sessionExtents(candles)) extentsByDay.set(e.dayIdx, e);

    for (let i = 0; i < n; i++) {
      const candle = candles[i];
      if (candle === undefined) continue; // garde explicite (noUncheckedIndexedAccess)

      const dayIdx = utcDayOf(candle.time);
      const prevDay = extentsByDay.get(dayIdx - 1);
      if (prevDay === undefined) continue; // pas de jour J-1 dans le buffer

      const { open: o, high: h, low: l, close: c } = prevDay;

      let x: number;
      if (c < o) x = h + 2 * l + c;
      else if (c > o) x = 2 * h + l + c;
      else x = h + l + 2 * c;

      pp[i] = x / 4;
      r1[i] = x / 2 - l;
      s1[i] = x / 2 - h;
    }

    return { series: { pp, r1, s1 } };
  },
};
