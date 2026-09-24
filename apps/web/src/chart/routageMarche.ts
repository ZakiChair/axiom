import type { Candle, IExchangeAdapter, Timeframe } from "@axiom/types";
import type { CandidatsProgressifs, ResolvedMarket } from "../data/marketRouting";
import { fetchKlinesTwelveData, twelveDataAdapter } from "../data/twelvedata";

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

/**
 * Backfill soumis à un quota (Twelve Data, 8 req/min) : attendre un créneau n'est pas
 * une panne. Le chien de garde `garder` n'est armé qu'à l'obtention du créneau ;
 * `couper` (démontage) comme un délai dépassé abandonnent la demande, qui sort alors
 * de la file sans consommer de créneau, ou arrête le fetch déjà parti.
 */
export function chargerAuCreneau<T>(
  lancer: (controle: { signal: AbortSignal; onCreneau: () => void }) => Promise<T>,
  garder: (travail: Promise<T>) => { promesse: Promise<T>; annuler: () => void },
): { promesse: Promise<T>; couper: () => void } {
  const controleur = new AbortController();
  let annulerGarde: (() => void) | undefined;
  let signalerCreneau = (): void => {};
  const creneau = new Promise<void>((resolve) => { signalerCreneau = resolve; });
  const requete = lancer({ signal: controleur.signal, onCreneau: () => signalerCreneau() });
  const promesse = Promise.race([requete, creneau.then(() => {
    if (controleur.signal.aborted) return requete;
    const garde = garder(requete);
    annulerGarde = garde.annuler;
    return garde.promesse;
  })]);
  const couper = (): void => { annulerGarde?.(); controleur.abort(); };
  promesse.catch(couper);
  return { promesse, couper };
}

/**
 * Page d'historique plus ancienne (scroll, extension de session). L'adaptateur Twelve Data (hors
 * rejeu) passe, comme le backfill, devant les cotations du quota 8/min ; `signal` (démontage)
 * retire la demande de la file sans consommer de crédit, ou arrête le fetch déjà parti.
 */
export function chargerPageAncienne(
  adapter: IExchangeAdapter,
  symbol: string,
  timeframe: Timeframe,
  opts: { limit: number; endTime: number },
  signal: AbortSignal,
): Promise<Candle[]> {
  return adapter === twelveDataAdapter
    ? fetchKlinesTwelveData(symbol, timeframe, opts, { priorite: "graphe", signal })
    : adapter.fetchKlines(symbol, timeframe, opts);
}
