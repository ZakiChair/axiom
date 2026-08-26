import type { ExchangeId, IndicatorDef, Timeframe } from "@axiom/types";
import { tfAtLeast } from "../chart/tfOrder";

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
  if (exchange === "synthetic" && def.id === "volume") {
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
  return null;
}
