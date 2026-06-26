/**
 * Types partagés des fournisseurs MACRO / « masse monétaire » d'AXIOM.
 *
 * Trois mesures (toutes gratuites) implémentent la même interface `IMacroProvider` :
 *   1. capitalisation totale du marché crypto (CoinGecko),
 *   2. supply agrégée des stablecoins (DefiLlama),
 *   3. M2 / liquidité globale (FRED, US extensible).
 *
 * Donnée BASSE fréquence (snapshot, journalier, hebdo ou mensuel selon la source) :
 * rien à voir avec les flux tick haute fréquence — ces séries peuvent vivre dans
 * le state React sans enfreindre le BUILD-CONTRACT.
 */

/** Un point d'une série temporelle macro. */
export interface MacroPoint {
  /** Horodatage en MILLISECONDES depuis l'époque (cohérent avec Candle.time de @axiom/types). */
  time: number;
  /** Valeur de la mesure. UNITÉ propre à chaque fournisseur — voir la doc de chacun. */
  value: number;
}

/** Série temporelle macro, triée par `time` croissant. */
export type MacroSeries = MacroPoint[];

/** Options communes à tous les `fetchSeries`. Tous les champs sont optionnels. */
export interface MacroFetchOptions {
  /**
   * Clé API. Obligatoire pour FRED (sinon série vide gracieuse) ;
   * OPTIONNELLE pour CoinGecko (relève seulement les quotas Demo) ;
   * inutile pour DefiLlama (endpoint sans clé).
   * À défaut, chaque fournisseur tente `localStorage` (voir sa doc).
   */
  apiKey?: string;
  /** Borne basse incluse (ms epoch) — filtrage de la série quand la source le permet. */
  start?: number;
  /** Borne haute incluse (ms epoch). */
  end?: number;
  /** Annulation de la requête `fetch` sous-jacente. */
  signal?: AbortSignal;
}

/** Contrat d'un fournisseur de donnée macro. */
export interface IMacroProvider {
  /** Identifiant stable du fournisseur (ex. "coingecko-total", "fred-wm2ns"). */
  id: string;
  /** Récupère la série temporelle de la mesure. */
  fetchSeries(opts?: MacroFetchOptions): Promise<MacroSeries>;
}
