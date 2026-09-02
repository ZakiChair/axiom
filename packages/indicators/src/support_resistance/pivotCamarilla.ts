/**
 * @axiom/indicators — support_resistance/pivotCamarilla.ts
 *
 * Pivot Points Camarilla.
 * Source canonique : équations Camarilla (Nick Scott), reprises par TradingView
 * "Pivot Points Standard", méthode Camarilla.
 *
 *   range = H − L
 *   H1 = C + range·(1.1/12)   L1 = C − range·(1.1/12)
 *   H2 = C + range·(1.1/6)    L2 = C − range·(1.1/6)
 *   H3 = C + range·(1.1/4)    L3 = C − range·(1.1/4)
 *   H4 = C + range·(1.1/2)    L4 = C − range·(1.1/2)
 *   PP = (H + L + C) / 3       (ancre overlay ; non requise par les niveaux H/L)
 *
 * Nommage canonique Camarilla : H1..H4 / L1..L4 (et non R/S).
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

// Coefficients Camarilla (1.1 / {12, 6, 4, 2}).
const C1 = 1.1 / 12;
const C2 = 1.1 / 6;
const C3 = 1.1 / 4;
const C4 = 1.1 / 2;

export const pivotCamarilla: IndicatorDef = {
  id: "pivotCamarilla",
  name: "Pivot Points Camarilla",
  category: "support_resistance",
  pane: "overlay",
  inputs: [],
  outputs: [
    { key: "pp", name: "PP", style: "line" },
    { key: "h1", name: "H1", style: "line" },
    { key: "h2", name: "H2", style: "line" },
    { key: "h3", name: "H3", style: "line" },
    { key: "h4", name: "H4", style: "line" },
    { key: "l1", name: "L1", style: "line" },
    { key: "l2", name: "L2", style: "line" },
    { key: "l3", name: "L3", style: "line" },
    { key: "l4", name: "L4", style: "line" },
  ],

  calc(candles) {
    const n = candles.length;
    const pp: Array<number | undefined> = new Array(n).fill(undefined);
    const h1: Array<number | undefined> = new Array(n).fill(undefined);
    const h2: Array<number | undefined> = new Array(n).fill(undefined);
    const h3: Array<number | undefined> = new Array(n).fill(undefined);
    const h4: Array<number | undefined> = new Array(n).fill(undefined);
    const l1: Array<number | undefined> = new Array(n).fill(undefined);
    const l2: Array<number | undefined> = new Array(n).fill(undefined);
    const l3: Array<number | undefined> = new Array(n).fill(undefined);
    const l4: Array<number | undefined> = new Array(n).fill(undefined);

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
      const range = h - l;

      pp[i] = (h + l + c) / 3;
      h1[i] = c + range * C1;
      h2[i] = c + range * C2;
      h3[i] = c + range * C3;
      h4[i] = c + range * C4;
      l1[i] = c - range * C1;
      l2[i] = c - range * C2;
      l3[i] = c - range * C3;
      l4[i] = c - range * C4;
    }

    return { series: { pp, h1, h2, h3, h4, l1, l2, l3, l4 } };
  },
};
