/**
 * Liste des paires négociables par source, pour la barre de recherche.
 *
 * Chaque source expose son catalogue via REST public (CORS OK, déjà utilisé par les
 * adaptateurs). On NORMALISE tout au format d'ENTRÉE attendu par les adaptateurs
 * (style Binance concaténé, ex. "BTCUSDT", "BTCUSD") : c'est ce format qui circule
 * partout (store marché, watchlist). Chaque adaptateur reconvertit ensuite vers son
 * propre format (Kraken "BTC/USD", Coinbase "BTC-USD").
 *
 * Cache mémoire par source : un seul fetch par exchange et par session (la liste est
 * stable). Un échec est évincé du cache pour autoriser une nouvelle tentative.
 *
 * Sources :
 *  - Binance  : GET /api/v3/exchangeInfo            -> symbols[].symbol (status "TRADING").
 *  - Kraken   : GET /0/public/AssetPairs            -> result[].wsname "BASE/QUOTE" (status "online").
 *  - Coinbase : GET /api/v3/brokerage/market/products -> products[].product_id "BASE-QUOTE" (SPOT).
 */
import type { ExchangeId } from "@axiom/types";

const BINANCE_EXCHANGE_INFO = "https://api.binance.com/api/v3/exchangeInfo";
const KRAKEN_ASSET_PAIRS = "https://api.kraken.com/0/public/AssetPairs";
const COINBASE_PRODUCTS = "https://api.coinbase.com/api/v3/brokerage/market/products";

/**
 * Alias d'actif Kraken -> ticker courant (base ET quote). Le `wsname` REST emploie
 * encore "XBT"/"XDG" ; on rétablit "BTC"/"DOGE" pour coller au format d'entrée des
 * adaptateurs (ex. "XBT/USD" -> "BTCUSD", "AAVE/XBT" -> "AAVEBTC").
 */
const KRAKEN_ASSET_ALIAS: Record<string, string> = { XBT: "BTC", XDG: "DOGE" };

/** Cache par source (la promesse est mémorisée pour dédupliquer les appels concurrents). */
const cache = new Map<ExchangeId, Promise<string[]>>();

/**
 * Renvoie (et met en cache) la liste des symboles de la source, au format d'entrée
 * concaténé. En cas d'échec, l'entrée de cache est purgée pour permettre un réessai.
 */
export function fetchPairs(exchange: ExchangeId): Promise<string[]> {
  const cached = cache.get(exchange);
  if (cached) return cached;
  const pending = loadPairs(exchange).catch((err) => {
    cache.delete(exchange);
    throw err;
  });
  cache.set(exchange, pending);
  return pending;
}

/** Aiguillage par source (repli Binance pour toute source non câblée). */
function loadPairs(exchange: ExchangeId): Promise<string[]> {
  switch (exchange) {
    case "kraken":
      return loadKrakenPairs();
    case "coinbase":
      return loadCoinbasePairs();
    default:
      return loadBinancePairs();
  }
}

async function loadBinancePairs(): Promise<string[]> {
  const res = await fetch(BINANCE_EXCHANGE_INFO);
  if (!res.ok) throw new Error(`Binance exchangeInfo ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { symbols?: Array<{ symbol?: string; status?: string }> };
  const out: string[] = [];
  for (const s of data.symbols ?? []) {
    if (typeof s.symbol === "string" && s.status === "TRADING") out.push(s.symbol);
  }
  return out.sort();
}

async function loadKrakenPairs(): Promise<string[]> {
  const res = await fetch(KRAKEN_ASSET_PAIRS);
  if (!res.ok) throw new Error(`Kraken AssetPairs ${res.status} ${res.statusText}`);
  const data = (await res.json()) as {
    error?: string[];
    result?: Record<string, { wsname?: string; status?: string }>;
  };
  if (data.error && data.error.length > 0) {
    throw new Error(`Kraken AssetPairs: ${data.error.join("; ")}`);
  }
  const out: string[] = [];
  for (const info of Object.values(data.result ?? {})) {
    if (info.status !== undefined && info.status !== "online") continue;
    const ws = info.wsname;
    if (typeof ws !== "string") continue;
    const parts = ws.split("/");
    const base = parts[0];
    const quote = parts[1];
    if (base === undefined || quote === undefined) continue;
    // Alias appliqué aux DEUX côtés (XBT/XDG) pour rester dans le format d'entrée des adaptateurs.
    out.push(`${KRAKEN_ASSET_ALIAS[base] ?? base}${KRAKEN_ASSET_ALIAS[quote] ?? quote}`);
  }
  return out.sort();
}

async function loadCoinbasePairs(): Promise<string[]> {
  const res = await fetch(COINBASE_PRODUCTS);
  if (!res.ok) throw new Error(`Coinbase products ${res.status} ${res.statusText}`);
  const data = (await res.json()) as {
    products?: Array<{ product_id?: string; product_type?: string; trading_disabled?: boolean }>;
  };
  const out: string[] = [];
  for (const p of data.products ?? []) {
    if (typeof p.product_id !== "string") continue;
    if (p.product_type !== undefined && p.product_type !== "SPOT") continue; // spot uniquement
    if (p.trading_disabled === true) continue;
    out.push(p.product_id.replace("-", "")); // "BTC-USD" -> "BTCUSD"
  }
  return out.sort();
}
