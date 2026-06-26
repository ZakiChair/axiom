/**
 * Point d'entrée des fournisseurs MACRO / « masse monétaire » d'AXIOM.
 *
 * Trois mesures, toutes GRATUITES :
 *   1. Capitalisation totale du marché crypto (CoinGecko)  → coingecko.ts
 *   2. Supply agrégée des stablecoins (DefiLlama)          → stablecoins.ts
 *   3. M2 / liquidité (US extensible, via FRED)            → fred.ts
 *
 * Ne ré-exporte QUE le contenu de ce dossier (macro/) — aucune dépendance
 * vers le reste de apps/web (propriété « chart » dans le BUILD-CONTRACT).
 */
export type { IMacroProvider, MacroFetchOptions, MacroPoint, MacroSeries } from "./types";

export {
  type GlobalMcapSnapshot,
  type McapMeasure,
  coinGeckoTotal2Provider,
  coinGeckoTotal3Provider,
  coinGeckoTotalProvider,
  createCoinGeckoMcapProvider,
  fetchGlobalMcapSnapshot,
} from "./coingecko";

export { stablecoinsSupplyProvider } from "./stablecoins";

export { createFredM2Provider, fredM2MonthlyProvider, fredM2WeeklyProvider } from "./fred";
