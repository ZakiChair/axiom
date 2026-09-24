/**
 * Liste des paires négociables par source, pour la barre de recherche.
 *
 * Chaque source expose son catalogue via REST public (CORS direct, ou proxy /extapi
 * comme les bougies de l'adaptateur quand l'hôte n'expose aucun CORS). On NORMALISE tout au format d'ENTRÉE attendu par les adaptateurs
 * (style Binance concaténé, ex. "BTCUSDT", "BTCUSD") : c'est ce format qui circule
 * partout (store marché, watchlist). Chaque adaptateur reconvertit ensuite vers son
 * propre format (Kraken "BTC/USD", Coinbase "BTC-USD").
 *
 * Cache mémoire par source : succès valables cinq minutes, requêtes simultanées
 * dédupliquées. Un échec est mémorisé 30 s (une place muette ne recoûte pas 12 s à
 * chaque ouverture) ; `force` passe outre. Les listes vides restent réessayables.
 *
 * Sources :
 *  - Binance  : GET /api/v3/exchangeInfo (TRADING seul, sans permissionSets) -> symbols[].symbol.
 *  - Kraken   : GET /0/public/AssetPairs            -> result[].wsname "BASE/QUOTE" (status "online").
 *  - Coinbase : GET /api/v3/brokerage/market/products (via /extapi) -> products[].product_id "BASE-QUOTE" (SPOT).
 */
import type { ExchangeId } from "@axiom/types";
import { extUrl } from "./extapi";
import { registerHyperliquidCoin, splitSymbol } from "./symbol";

// Mêmes 1 372 paires TRADING que la réponse complète (17,6 Mo décodés), pour 2,5 Mo.
const BINANCE_EXCHANGE_INFO = "https://api.binance.com/api/v3/exchangeInfo?symbolStatus=TRADING&showPermissionSets=false";
const KRAKEN_ASSET_PAIRS = "https://api.kraken.com/0/public/AssetPairs";
// api.coinbase.com n'expose aucun en-tête CORS : même route /extapi que les bougies
// (coinbase.ts). api.exchange.coinbase.com ne liste pas les paires USDC Advanced Trade.
const COINBASE_PRODUCTS_HOST = "api.coinbase.com";
const COINBASE_PRODUCTS_PATH = "api/v3/brokerage/market/products";
// MEXC : via le proxy (pas de CORS) ; inclut crypto + actions tokenisées (…X / …ON).
const MEXC_EXCHANGE_INFO = "/mexcapi/api/v3/exchangeInfo";

/**
 * Alias d'actif Kraken -> ticker courant (base ET quote). Le `wsname` REST emploie
 * encore "XBT"/"XDG" ; on rétablit "BTC"/"DOGE" pour coller au format d'entrée des
 * adaptateurs (ex. "XBT/USD" -> "BTCUSD", "AAVE/XBT" -> "AAVEBTC").
 */
const KRAKEN_ASSET_ALIAS: Record<string, string> = { XBT: "BTC", XDG: "DOGE" };

const CACHE_TTL_MS = 5 * 60_000;
const ECHEC_TTL_MS = 30_000;
/** Dernier succès par source : conservé même périmé, jamais effacé par un échec. */
const cache = new Map<ExchangeId, { value: string[]; expires: number }>();
/** Dernier échec, plus récent que le succès en cache ; levé au succès suivant. */
const echecs = new Map<ExchangeId, { erreur: unknown; jusqua: number }>();
const pendingPairs = new Map<ExchangeId, Promise<string[]>>();

/**
 * Le catalogue agrégé ne doit pas prolonger la durée de vie d'une source déjà en cache.
 * Source en échec : fin de sa fenêtre d'échec (un ancien succès périmé ferait expirer
 * l'agrégat aussitôt, donc un rafraîchissement à chaque lecture).
 */
export function pairsCacheExpiresAt(exchange: ExchangeId): number | undefined {
  const echec = echecs.get(exchange);
  if (echec) return echec.jusqua;
  const cached = cache.get(exchange);
  return cached && cached.expires > Date.now() ? cached.expires : undefined;
}

/**
 * Renvoie (et met en cache) la liste des symboles de la source, au format d'entrée
 * concaténé. `force` renouvelle un résultat terminé, sans doubler un appel en cours.
 * Un échec récent est rejoué tel quel pendant 30 s ; l'ancien succès n'est pas resservi.
 */
export function fetchPairs(exchange: ExchangeId, options: { force?: boolean } = {}): Promise<string[]> {
  const inFlight = pendingPairs.get(exchange);
  if (inFlight) return inFlight;
  const now = Date.now();
  const echec = echecs.get(exchange);
  const cached = cache.get(exchange);
  if (!options.force && echec && echec.jusqua > now) return Promise.reject(echec.erreur);
  if (!options.force && !echec && cached && cached.expires > now) return Promise.resolve(cached.value);
  const pending = loadPairs(exchange).then((value) => {
    echecs.delete(exchange);
    if (value.length > 0) cache.set(exchange, { value, expires: Date.now() + CACHE_TTL_MS });
    else if (cached) cached.expires = 0; // anomalie fournisseur : succès gardé, plus resservi
    return value;
  }, (erreur: unknown) => {
    echecs.set(exchange, { erreur, jusqua: Date.now() + ECHEC_TTL_MS });
    throw erreur;
  }).finally(() => { pendingPairs.delete(exchange); });
  pendingPairs.set(exchange, pending);
  return pending;
}

/** Chaque catalogue décrit uniquement les instruments de sa propre source. */
function loadPairs(exchange: ExchangeId): Promise<string[]> {
  switch (exchange) {
    case "kraken":
      return loadKrakenPairs();
    case "coinbase":
      return loadCoinbasePairs();
    case "twelvedata":
      // Twelve Data n'a pas de listing global pratique → catalogue CURÉ. Saisie libre
      // (cf. PairSearch) possible pour tout symbole Twelve Data (ex. "NVDA", "USD/SEK").
      return Promise.resolve([...TWELVEDATA_SYMBOLS]);
    case "mexc":
      return loadMexcPairs();
    case "binance":
      return loadBinancePairs();
    case "bybit":
      return loadBybitPairs();
    case "okx":
      return loadOkxPairs();
    case "hyperliquid":
      return loadHyperliquidPairs();
    case "synthetic":
      return Promise.resolve([]);
  }
}

/**
 * Catalogue MEXC (via proxy) : toutes les paires spot tradables, incluant les ACTIONS
 * TOKENISÉES (familles `…X` ex. AAPLXUSDT, et `…ON` ex. TSLAONUSDT) — cherchables comme
 * n'importe quelle paire. Format Binance concaténé, déjà compatible avec l'adaptateur.
 */
async function loadMexcPairs(): Promise<string[]> {
  const res = await catalogueFetch(MEXC_EXCHANGE_INFO);
  if (!res.ok) throw new Error(`MEXC exchangeInfo ${res.status} ${res.statusText}`);
  const data = (await res.json()) as {
    symbols?: Array<{ symbol?: string; status?: string; isSpotTradingAllowed?: boolean }>;
  };
  const out: string[] = [];
  for (const s of data.symbols ?? []) {
    // status "1" = en ligne ; isSpotTradingAllowed garantit une paire réellement tradable.
    if (typeof s.symbol === "string" && s.status === "1" && s.isSpotTradingAllowed === true) {
      out.push(s.symbol);
    }
  }
  return out.sort();
}

/**
 * Catalogue tradfi CURÉ (format Twelve Data). Les ETF, actions, matières premières
 * spot et forex restent des instruments distincts. L'accès aux historiques dépend
 * de l'abonnement fournisseur. Non exhaustif — saisie libre OK.
 */
export const TWELVEDATA_SYMBOLS: string[] = [
  // Indices via ETF (S&P500→SPY, Nasdaq100→QQQ, Dow→DIA, Russell2000→IWM, EAFE→EFA,
  // émergents→EEM, Europe→VGK, Japon→EWJ).
  "SPY", "QQQ", "DIA", "IWM", "EFA", "EEM", "VGK", "EWJ",
  // ETF crypto : instruments TradFi distincts de leurs sous-jacents.
  "GBTC", "IBIT", "ETHA", "ETHE",
  // Commodités via ETF (or→GLD, argent→SLV, pétrole WTI→USO, Brent→BNO, gaz→UNG,
  // cuivre→CPER, platine→PPLT, palladium→PALL, agriculture→DBA, large→DBC, blé→WEAT,
  // maïs→CORN, sucre→CANE).
  "GLD", "SLV", "USO", "BNO", "UNG", "CPER", "PPLT", "PALL", "DBA", "DBC", "WEAT", "CORN", "CANE",
  // Pétrole WTI spot, distinct de l'ETF USO et de l'action WTI.
  "WTI/USD",
  // Dollar US via ETF (proxy DXY pour les synthétiques BTC/DXY).
  "UUP",
  // Forex (BASE/QUOTE)
  "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD", "USD/CAD",
  "NZD/USD", "EUR/GBP", "EUR/JPY", "USD/CNY", "USD/MXN",
  // Actions US
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "NFLX", "AMD", "INTC",
  "JPM", "V", "MA", "DIS", "KO", "PEP", "XOM", "BA", "WMT", "BABA", "WTI",
].sort();

/** Aide à la recherche uniquement : ne réécrit ni symboles stockés ni requêtes de prix. */
export const TRADFI_SEARCH_METADATA: Readonly<Record<string, { label: string; aliases: readonly string[] }>> = {
  "WTI/USD": { label: "Pétrole WTI — spot", aliases: ["USOIL"] },
  WTI: { label: "W&T Offshore — action", aliases: [] },
};

async function loadBinancePairs(): Promise<string[]> {
  const res = await catalogueFetch(BINANCE_EXCHANGE_INFO);
  if (!res.ok) throw new Error(`Binance exchangeInfo ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { symbols?: Array<{ symbol?: string; status?: string }> };
  const out: string[] = [];
  for (const s of data.symbols ?? []) {
    if (typeof s.symbol === "string" && s.status === "TRADING") out.push(s.symbol);
  }
  return out.sort();
}

async function loadKrakenPairs(): Promise<string[]> {
  const res = await catalogueFetch(KRAKEN_ASSET_PAIRS);
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
  const res = await catalogueFetch(extUrl(COINBASE_PRODUCTS_HOST, COINBASE_PRODUCTS_PATH));
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


/** Borne le réseau ET la lecture JSON ; un serveur muet ne bloque pas les autres places. */
const CATALOGUE_TIMEOUT_MS = 12_000;
async function catalogueFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }).then(async (res) => {
        // Consommer le corps sous le même délai, sans changer l'interface des chargeurs.
        const data: unknown = await res.json();
        return { ok: res.ok, status: res.status, statusText: res.statusText, json: async () => data } as Response;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Catalogue indisponible (délai dépassé)")); }, CATALOGUE_TIMEOUT_MS);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

// API officielles : bybit-exchange.github.io/docs/v5/market/instrument (spot sans pagination).
async function loadBybitPairs(): Promise<string[]> {
  const res = await catalogueFetch("https://api.bybit.com/v5/market/instruments-info?category=spot");
  if (!res.ok) throw new Error(`Catalogue Bybit ${res.status}`);
  const data = await res.json() as { retCode?: number; result?: { list?: Array<{ symbol?: string; status?: string }> } };
  if (data.retCode !== 0) throw new Error("Catalogue Bybit indisponible");
  return (data.result?.list ?? []).filter((p) => p.status === "Trading" && typeof p.symbol === "string")
    .map((p) => p.symbol!).sort();
}

// www.okx.com/docs-v5/en/#rest-api-public-data-get-instruments — SPOT uniquement.
async function loadOkxPairs(): Promise<string[]> {
  const res = await catalogueFetch("https://www.okx.com/api/v5/public/instruments?instType=SPOT");
  if (!res.ok) throw new Error(`Catalogue OKX ${res.status}`);
  const data = await res.json() as { code?: string; data?: Array<{ instId?: string; instType?: string; state?: string }> };
  if (data.code !== "0") throw new Error("Catalogue OKX indisponible");
  return (data.data ?? []).filter((p) => p.instType === "SPOT" && p.state === "live" && typeof p.instId === "string")
    .map((p) => p.instId!.replace("-", "")).sort();
}

// hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
async function loadHyperliquidPairs(): Promise<string[]> {
  const res = await catalogueFetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "meta" }),
  });
  if (!res.ok) throw new Error(`Catalogue Hyperliquid ${res.status}`);
  const data = await res.json() as { universe?: Array<{ name?: string; isDelisted?: boolean }> };
  if (!Array.isArray(data.universe)) throw new Error("Catalogue Hyperliquid indisponible");
  return data.universe.filter((p) => typeof p.name === "string" && !p.isDelisted).map((p) => {
    registerHyperliquidCoin(p.name!);
    return `${p.name!.toUpperCase()}-PERP`;
  }).sort();
}

const DEVISES_FOREX = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "MXN", "SEK", "NOK", "DKK", "HKD", "SGD", "ZAR", "TRY", "INR", "BRL", "PLN"]);
/** Actions/ETF libres et forex explicite : ne confond pas XBT/USD avec EUR/USD. */
export function isTradfiMarketSymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  if (s.endsWith("-PERP") || s.includes("|")) return false;
  if (TWELVEDATA_SYMBOLS.includes(s) || /[\^=.]/.test(s)) return true;
  const [base, quote] = s.split("/");
  if (base && quote && DEVISES_FOREX.has(base) && DEVISES_FOREX.has(quote)) return true;
  try { splitSymbol(s.replace("-", "/"), "actif"); return false; }
  catch { return /^[A-Z][A-Z0-9]{0,9}$/.test(s); }
}
