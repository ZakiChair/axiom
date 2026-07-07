/**
 * @axiom/indicators — utils-session.ts
 *
 * Helpers de découpage par SESSION (jour UTC), PURS et réutilisables.
 * Utilisés par les indicateurs de pivots (support_resistance/pivot*) pour
 * agréger les extents H/L/C du jour UTC précédent.
 *
 * NB : `noUncheckedIndexedAccess` est actif — tout accès indexé est traité
 * comme potentiellement `undefined` et gardé explicitement.
 */

import type { Candle } from "@axiom/types";

const DAY_MS = 86_400_000;

/** Index de jour UTC d'un timestamp ms (`Math.floor(timeMs / 86_400_000)`). */
export function utcDayOf(timeMs: number): number {
  return Math.floor(timeMs / DAY_MS);
}

/** Agrégat H/L/C d'un jour UTC (bornes temporelles incluses pour référence). */
export interface SessionExtent {
  dayIdx: number;
  high: number;
  low: number;
  close: number;
  from: number;
  to: number;
}

/**
 * Agrège les bougies par jour UTC (High = max, Low = min, Close = clôture de
 * la dernière bougie du jour). Suppose `candles` trié par ordre chronologique
 * croissant. Résultat trié par `dayIdx` croissant (ordre chronologique).
 */
export function sessionExtents(candles: Candle[]): SessionExtent[] {
  const out: SessionExtent[] = [];
  let current: SessionExtent | undefined;

  for (const c of candles) {
    const dayIdx = utcDayOf(c.time);
    if (current === undefined || current.dayIdx !== dayIdx) {
      current = { dayIdx, high: c.high, low: c.low, close: c.close, from: c.time, to: c.time };
      out.push(current);
    } else {
      if (c.high > current.high) current.high = c.high;
      if (c.low < current.low) current.low = c.low;
      current.close = c.close; // dernière clôture rencontrée pour ce jour
      current.to = c.time;
    }
  }
  return out;
}
