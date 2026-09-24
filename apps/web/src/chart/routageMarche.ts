import type { Candle } from "@axiom/types";
import type { CandidatsProgressifs, ResolvedMarket } from "../data/marketRouting";

export interface MarcheCharge { identity: ResolvedMarket; candles: Candle[] }

/**
 * Essaie chaque provenance une fois, sans fusionner de prix entre places. La publication
 * de l'identité résolue est laissée au contrôleur, AVANT l'abonnement live/pagination.
 * Candidats progressifs : les immédiats d'abord ; s'ils échouent tous (ou s'il n'y en a
 * pas), la liste complète, sans réessayer une identité déjà essayée.
 */
export async function chargerAvecRepli(
  candidats: readonly ResolvedMarket[] | CandidatsProgressifs,
  fetchCandles: (identity: ResolvedMarket) => Promise<Candle[]>,
  isCancelled: () => boolean,
): Promise<MarcheCharge | null> {
  const essayes: ResolvedMarket[] = [];
  let lastError: unknown;
  // `undefined` : liste épuisée sans succès ; `null` : demande annulée.
  const essayer = async (liste: readonly ResolvedMarket[]): Promise<MarcheCharge | null | undefined> => {
    for (const identity of liste) {
      if (isCancelled()) return null;
      if (essayes.some((p) => p.exchange === identity.exchange && p.symbol === identity.symbol && p.timeframe === identity.timeframe)) continue;
      essayes.push(identity);
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
    return undefined;
  };
  const progressif = "immediats" in candidats;
  let resultat = await essayer(progressif ? candidats.immediats : candidats);
  if (resultat === undefined && progressif) {
    if (isCancelled()) return null;
    const complets = await candidats.complets();
    if (isCancelled()) return null;
    resultat = await essayer(complets);
  }
  if (resultat !== undefined) return resultat;
  if (essayes.length === 1 && lastError instanceof Error) throw lastError;
  throw new Error(essayes.length
    ? `Aucune source compatible ne fournit cet historique (${essayes.map((p) => p.exchange).join(", ")}).`
    : "Actif indisponible dans les catalogues chargés. Vérifiez le symbole ou réessayez.");
}
