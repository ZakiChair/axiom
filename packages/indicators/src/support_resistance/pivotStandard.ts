/**
 * @axiom/indicators — support_resistance/pivotStandard.ts
 *
 * Pivot Points Standard (« Floor pivots »), SESSIONNÉS.
 * Source canonique : formules de pivots planchers classiques (TradingView
 * "Pivot Points Standard", méthode Traditional).
 *
 *   PP = (H + L + C) / 3
 *   R1 = 2·PP − L            S1 = 2·PP − H
 *   R2 = PP + (H − L)        S2 = PP − (H − L)
 *   R3 = H + 2·(PP − L)      S3 = L − 2·(H − PP)
 *
 * H/L/C proviennent des EXTENTS AGRÉGÉS DU JOUR UTC PRÉCÉDENT (J-1), via
 * `sessionExtents`/`utcDayOf` (utils-session.ts) — et non de la bougie
 * précédente. Conséquence : les niveaux sont constants sur toute la durée
 * d'une session (jour UTC courant) et changent une fois par jour, à minuit
 * UTC. Les bougies du premier jour du buffer (pas de jour J-1 disponible)
 * restent `undefined` — de même quand le jour J-1 présent dans le buffer est
 * TRONQUÉ (backfill démarrant en milieu de journée).
 */

import type { IndicatorDef } from "@axiom/types";
import { sessionExtents, utcDayOf, type SessionExtent } from "../utils-session";

export const pivotStandard: IndicatorDef = {
  id: "pivotStandard",
  name: "Pivot Points Standard",
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
      pp[i] = p;
      r1[i] = 2 * p - l;
      s1[i] = 2 * p - h;
      r2[i] = p + (h - l);
      s2[i] = p - (h - l);
      r3[i] = h + 2 * (p - l);
      s3[i] = l - 2 * (h - p);
    }

    return { series: { pp, r1, s1, r2, s2, r3, s3 } };
  },
};
