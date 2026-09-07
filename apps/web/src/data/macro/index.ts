/**
 * Point d'entrée des fournisseurs MACRO / « masse monétaire » d'AXIOM.
 *
 * Quatre couches, toutes GRATUITES :
 *   1. Capitalisation totale du marché crypto (CoinGecko)  → coingecko.ts
 *   2. Supply agrégée des stablecoins (DefiLlama)          → stablecoins.ts
 *   3. M2 / liquidité (US extensible, via FRED)            → fred.ts
 *   4. Catalogue d'indicateurs macro mondiaux (CPI a/a, six zones), ses
 *      transports et son harmonisation temporelle
 *      → catalogueMacro.ts, chargerSerieMacro.ts, harmonisation.ts
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

export type {
  DefinitionSerieMacro,
  IndicateurMacro,
  RegionMacro,
  SourceMacro,
} from "./catalogueMacro";
export { CATALOGUE_MACRO, INDICATEURS_MACRO, ORDRE_REGIONS, seriesDeIndicateur } from "./catalogueMacro";

export type { FrequenceMacro } from "./harmonisation";
export { filtrerFenetre, finDePeriode, periodeVersMs, trierChrono } from "./harmonisation";

export type { ResultatSerieMacro } from "./chargerSerieMacro";
export { chargerSerieMacro, cleSante } from "./chargerSerieMacro";
