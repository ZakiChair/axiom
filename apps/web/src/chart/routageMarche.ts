import type { Candle } from "@axiom/types";
import type { ResolvedMarket } from "../data/marketRouting";

export interface MarcheCharge { identity: ResolvedMarket; candles: Candle[] }

/**
 * Essaie chaque provenance une fois, sans fusionner de prix entre places. La publication
 * de l'identité résolue est laissée au contrôleur, AVANT l'abonnement live/pagination.
 */
export async function chargerAvecRepli(
  candidates: readonly ResolvedMarket[],
  fetchCandles: (identity: ResolvedMarket) => Promise<Candle[]>,
  isCancelled: () => boolean,
): Promise<MarcheCharge | null> {
  let lastError: unknown;
  for (const identity of candidates) {
    if (isCancelled()) return null;
    try {
      const candles = await fetchCandles(identity);
      if (isCancelled()) return null;
      if (candles.length === 0) throw new Error("historique vide");
      return { identity, candles };
    } catch (error) {
      if (isCancelled()) return null;
      lastError = error;
    }
  }
  if (candidates.length === 1 && lastError instanceof Error) throw lastError;
  throw new Error(candidates.length
    ? `Aucune source compatible ne fournit cet historique (${candidates.map((p) => p.exchange).join(", ")}).`
    : "Actif indisponible dans les catalogues chargés. Vérifiez le symbole ou réessayez.");
}
