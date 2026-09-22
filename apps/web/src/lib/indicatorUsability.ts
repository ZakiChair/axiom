import type { ExchangeId, IndicatorDef, Timeframe } from "@axiom/types";
import { supportsIndicatorTimeframe } from "@axiom/indicators";
import { tfAtLeast } from "../chart/tfOrder";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { daemonSupporte } from "../data/daemon";

export interface ContexteIndicateur {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
}

const SPLIT_VOLUME = new Set([
  "cvd",
  "volumeDelta",
  "takerBuyRatio",
  "cvdDivergence",
  "cvdSpotPerp",
  "takerNetPct",
  "stratSpotBreakout",
  "vpin",
  "kyleLambda",
  "trappedVolume",
]);

/** Indicateurs dont le calcul repose sur le volume réel des bougies (0/absent en synthétique).
 *  Exporté : `chart/indicators.ts` écarte les mêmes defs du chart synthétique (source unique). */
export const VOLUME_REEL: ReadonlySet<string> = new Set([
  "volume",
  "rvolSeasonal",
  "trappedVolume",
  "amihudIlliq",
  "vpin",
  "kyleLambda",
]);

const VOLUME_FOREX = new Set([
  "vwma",
  "easeOfMovement",
  "forceIndex",
  "mfi",
  "marketFacilitationIndex",
  "netVolume",
  "mfiDivergence",
  "obvDivergence",
]);

const ONCHAIN_BTC = new Set([
  "nvt",
  "mvrv",
  "mvrvZScore",
  "nupl",
  "puell",
  "sopr",
  "reserveRisk",
  "realizedPrice",
  "asopr",
  "sthSopr",
  "lthSopr",
  "rhodlRatio",
  "cvdd",
  "balancedPrice",
  "ssr",
  // — Lot 2 : hashrate + métriques de cycle BGeometrics (BTC uniquement)
  "hashRibbons",
  "mvrvCohortes",
  "nrpl",
  "vddMultiple",
  "aviv",
  "offreEnProfit",
]);

const AUX_PERP = new Set([
  "oi",
  "funding",
  "mark",
  "perpDelta",
  "lsAccount",
  "lsTopTrader",
  "lsTaker",
]);

const QUOTES = ["FDUSD", "USDT", "USDC", "BUSD", "USD", "EUR", "GBP", "BTC", "ETH"];

function actifDe(symbol: string): string {
  const normalise = symbol.trim().toUpperCase();
  const slash = normalise.indexOf("/");
  if (slash > 0) return normalise.slice(0, slash);
  const sansPerp = normalise.replace(/_?PERP$/, "");
  const quote = QUOTES.find((q) => sansPerp.endsWith(q) && sansPerp.length > q.length);
  return quote === undefined ? sansPerp : sansPerp.slice(0, -quote.length);
}

function symboleUsdtCompatible(exchange: ExchangeId, symbol: string): boolean {
  return exchange !== "twelvedata" && exchange !== "synthetic" && /^[A-Z0-9]+USDT$/.test(symbol.trim().toUpperCase());
}

export function raisonUnusableIndicateur(
  def: IndicatorDef,
  { exchange, symbol, timeframe }: ContexteIndicateur,
): string | null {
  if (def.minTimeframe !== undefined && !tfAtLeast(timeframe, def.minTimeframe)) {
    return `Nécessite ≥ ${def.minTimeframe}`;
  }
  if (exchange === "synthetic" && VOLUME_REEL.has(def.id)) {
    return "Volume non défini sur une série synthétique";
  }
  if (SPLIT_VOLUME.has(def.id) && exchange !== "binance") {
    return "Volumes acheteur/vendeur historiques complets disponibles uniquement sur Binance";
  }
  if (
    exchange === "twelvedata" &&
    symbol.includes("/") &&
    (def.category === "volume" || VOLUME_FOREX.has(def.id))
  ) {
    return "Twelve Data ne fournit pas de volume pour le forex";
  }
  if (!supportsIndicatorTimeframe(def.id, timeframe)) {
    return "RVOL saisonnier : nécessite l’intervalle 1h (références en UTC)";
  }
  if (def.aux?.includes("mark") && ["3M", "6M", "12M"].includes(timeframe)) {
    return "Mark perp indisponible pour cet intervalle";
  }
  const actif = actifDe(symbol);
  if (ONCHAIN_BTC.has(def.id) && actif !== "BTC") {
    return "Métrique on-chain disponible uniquement pour BTC";
  }
  if (def.id === "quarterlyBasis" && actif !== "BTC" && actif !== "ETH") {
    return "Basis trimestriel disponible uniquement pour BTC et ETH";
  }
  if (def.aux?.some((id) => AUX_PERP.has(id)) && !symboleUsdtCompatible(exchange, symbol)) {
    return "Nécessite un symbole crypto USDT compatible";
  }
  // Flux liquidations Coinalyze : `hasKey` reflète déjà le repli `.env` du proxy
  // local (même prédicat que `rawFetch("oi")` dans chart/auxProvider.ts).
  if (def.id === "liqParBougie" && !coinalyzeKeyStore.getState().hasKey) {
    return "Nécessite une clé Coinalyze";
  }
  if (def.id === "hlWhalesNet" && !daemonSupporte("hl")) {
    return "Nécessite le daemon axiomd (collecte des niveaux HL)";
  }
  return null;
}
