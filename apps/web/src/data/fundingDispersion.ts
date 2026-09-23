/** Échantillonnage causal des quatre places à l'instant demandé. */
import { calculerDispersionFunding } from "@axiom/indicators";
import type { PointFundingHoraire, VenueFunding } from "./fundingHistory";

export interface PointDispersionFunding {
  time: number;
  knownCount: number;
  sigma: number | undefined;
  min: number | undefined;
  max: number | undefined;
}

const VENUES: readonly VenueFunding[] = ["binance", "bybit", "okx", "hyperliquid"];

export function construireSerieDispersion(
  historiques: Record<VenueFunding, PointFundingHoraire[]>,
  times: number[],
): PointDispersionFunding[] {
  const cursors = Object.fromEntries(VENUES.map((venue) => [venue, 0])) as Record<VenueFunding, number>;
  const ordonnes = Object.fromEntries(VENUES.map((venue) => [venue, historiques[venue].slice().sort((a, b) => a.time - b.time)])) as Record<VenueFunding, PointFundingHoraire[]>;
  return times.map((time) => {
    const valeurs = VENUES.map((venue) => {
      const points = ordonnes[venue];
      while (cursors[venue] < points.length && points[cursors[venue]]!.time <= time) cursors[venue]++;
      const point = points[cursors[venue] - 1];
      return point !== undefined && point.validUntil !== undefined && time < point.validUntil &&
        point.value !== undefined && Number.isFinite(point.value) ? point.value : undefined;
    });
    const d = calculerDispersionFunding(valeurs as [number | undefined, number | undefined, number | undefined, number | undefined]);
    return { time, knownCount: d.knownCount, sigma: d.sigma, min: d.min, max: d.max };
  });
}
