import type { Timeframe } from "@axiom/types";

/**
 * Indicateurs réservés à UNE unité de temps : RVOL saisonnier (références horaires UTC),
 * impression de stablecoins (points quotidiens : intrajournalier anticipé, 1w décalé d'une
 * période) et AXIS (seule unité couverte par son test sur données jamais vues du
 * 7 octobre 2026 — scripts/axis/rapport-v2-2026-10-07.md).
 */
export const TIMEFRAME_REQUIS: Readonly<Partial<Record<string, Timeframe>>> = {
  rvolSeasonal: "1h",
  stablecoinPrint: "1d",
  stratAxis: "4h",
};

/** Contrat commun chart / alertes / backtest. Pas d'inférence du TF depuis des trous. */
export function supportsIndicatorTimeframe(id: string, timeframe: Timeframe | undefined): boolean {
  const requis = TIMEFRAME_REQUIS[id];
  return requis === undefined || timeframe === requis;
}
