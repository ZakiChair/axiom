import type { Timeframe } from "@axiom/types";

/**
 * Indicateurs réservés à UNE unité de temps : RVOL saisonnier (références horaires UTC) et
 * impression de stablecoins (points quotidiens : intrajournalier anticipé, 1w décalé d'une période).
 */
export const TIMEFRAME_REQUIS: Readonly<Partial<Record<string, Timeframe>>> = { rvolSeasonal: "1h", stablecoinPrint: "1d" };

/** Contrat commun chart / alertes / backtest. Pas d'inférence du TF depuis des trous. */
export function supportsIndicatorTimeframe(id: string, timeframe: Timeframe | undefined): boolean {
  const requis = TIMEFRAME_REQUIS[id];
  return requis === undefined || timeframe === requis;
}
