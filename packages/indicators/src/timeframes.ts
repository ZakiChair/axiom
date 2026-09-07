import type { Timeframe } from "@axiom/types";

/** Contrat commun chart / alertes / backtest. Pas d'inférence du TF depuis des trous. */
export function supportsIndicatorTimeframe(id: string, timeframe: Timeframe | undefined): boolean {
  return id !== "rvolSeasonal" || timeframe === "1h";
}
