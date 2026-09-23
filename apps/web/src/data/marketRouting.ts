/** Catalogue et sélection automatiques : une seule paire, une seule devise, un seul marché. */
import type { ExchangeId, Timeframe } from "@axiom/types";
import { fetchPairs, isTradfiMarketSymbol, pairsCacheExpiresAt, TRADFI_SEARCH_METADATA, TWELVEDATA_SYMBOLS } from "./pairs";
import { supportedTimeframesFor } from "./adapters";
import { estSymboleCapitalisation, SYMBOLES_CAPITALISATION } from "./mcap";
import { parseSyntheticSymbol } from "./synthetic";
import { basePerp, splitSymbol } from "./symbol";

export interface MarketCandidate {
  exchange: ExchangeId;
  symbol: string;
  kind: "spot" | "perp" | "tradfi" | "synthetic";
  /** Libellé de découverte ; l'identité utilisée pour les données reste `symbol`. */
  label?: string;
}
export interface MarketCatalog {
  instruments: MarketCandidate[];
  unavailableSources: ExchangeId[];
}
export interface ResolvedMarket {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  /** Catalogue indisponible : vérifier l'instrument par son backfill/ticker avant publication. */
  speculative?: true;
}

/** Binance conserve le split taker ; les autres places restent des replis du même spot. */
const SOURCES: readonly ExchangeId[] = ["binance", "kraken", "coinbase", "bybit", "okx", "mexc", "twelvedata", "hyperliquid"];
let pendingCatalog: Promise<MarketCatalog> | undefined;
let cachedCatalog: { value: MarketCatalog; expires: number } | undefined;
const catalogListeners = new Set<(catalog: MarketCatalog) => void>();

/** Abonnement aux rafraîchissements terminés ; une simple lecture du cache ne republie pas. */
export function subscribeMarketCatalog(listener: (catalog: MarketCatalog) => void): () => void {
  catalogListeners.add(listener);
  return () => { catalogListeners.delete(listener); };
}

export function fetchMarketCatalog(options: { force?: boolean } = {}): Promise<MarketCatalog> {
  if (pendingCatalog) return pendingCatalog;
  if (!options.force && cachedCatalog && cachedCatalog.expires > Date.now()) return Promise.resolve(cachedCatalog.value);
  pendingCatalog = Promise.allSettled(SOURCES.map((source) => fetchPairs(source, options))).then((results) => {
    const instruments: MarketCandidate[] = [];
    const unavailableSources: ExchangeId[] = [];
    results.forEach((result, index) => {
      const exchange = SOURCES[index]!;
      if (result.status === "rejected" || result.value.length === 0) { unavailableSources.push(exchange); return; }
      const kind = exchange === "hyperliquid" ? "perp" : exchange === "twelvedata" ? "tradfi" : "spot";
      for (const symbol of new Set(result.value)) instruments.push({ exchange, symbol, kind });
    });
    for (const symbol of SYMBOLES_CAPITALISATION) instruments.push({ exchange: "synthetic", symbol, kind: "synthetic" });
    const value = { instruments, unavailableSources };
    // Les échecs restent réessayables sans marteler une place bloquée à chaque slot/clic.
    const sourceExpirations = SOURCES.map(pairsCacheExpiresAt).filter((expires): expires is number => expires !== undefined);
    const expires = Math.min(Date.now() + (unavailableSources.length ? 30_000 : 5 * 60_000), ...sourceExpirations);
    cachedCatalog = { value, expires };
    for (const listener of [...catalogListeners]) {
      try { listener(value); }
      catch { /* Une vue défaillante ne doit pas bloquer le catalogue des autres consommateurs. */ }
    }
    return value;
  }).finally(() => { pendingCatalog = undefined; });
  return pendingCatalog;
}

export function searchMarkets(catalog: MarketCatalog, query: string, limit = 30): MarketCandidate[] {
  const q = query.trim().toUpperCase();
  const seen = new Set<string>();
  const metadata = (candidate: MarketCandidate) => candidate.exchange === "twelvedata" ? TRADFI_SEARCH_METADATA[candidate.symbol] : undefined;
  const rank = (candidate: MarketCandidate) => candidate.symbol === q ? 3
    : metadata(candidate)?.aliases.includes(q) ? 2 : candidate.symbol.startsWith(q) ? 1 : 0;
  return [...catalog.instruments]
    .sort((a, b) => SOURCES.indexOf(a.exchange) - SOURCES.indexOf(b.exchange))
    .filter((candidate) => {
      const details = metadata(candidate);
      if (!candidate.symbol.toUpperCase().includes(q)
        && !details?.label.toUpperCase().includes(q)
        && !details?.aliases.some((alias) => alias.includes(q))) return false;
      const key = `${candidate.kind}:${candidate.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, limit)
    .map((candidate) => metadata(candidate) ? { ...candidate, label: metadata(candidate)!.label } : candidate);
}

function normalizeSpot(symbol: string): string {
  try {
    const { base, quote } = splitSymbol(symbol.replace("-", "/"), "actif");
    const alias = (s: string) => s === "XBT" ? "BTC" : s === "XDG" ? "DOGE" : s;
    return `${alias(base)}${alias(quote)}`;
  } catch { return symbol; }
}

/**
 * Instruments confirmés prioritaires, puis support du timeframe, provenance courante
 * et ordre du catalogue. Aucun passage spot/perp ni USD/USDT/USDC : même instrument.
 * Le catalogue optionnel permet les usages déjà chargés et les tests sans réseau.
 */
export async function resolveMarketCandidates(
  identity: { exchange?: ExchangeId; symbol: string; timeframe: Timeframe },
  catalog?: MarketCatalog,
): Promise<ResolvedMarket[]> {
  let symbol = identity.symbol.trim();
  if (!symbol.includes("|")) symbol = symbol.toUpperCase();
  if (estSymboleCapitalisation(symbol) || parseSyntheticSymbol(symbol)) {
    const supported = supportedTimeframesFor("synthetic", symbol);
    const timeframe = supported.includes(identity.timeframe) ? identity.timeframe : supported.includes("1h") ? "1h" : supported[0];
    return timeframe ? [{ exchange: "synthetic", symbol, timeframe }] : [];
  }
  if (identity.exchange === "hyperliquid" && !symbol.endsWith("-PERP") && !TWELVEDATA_SYMBOLS.includes(symbol)) {
    const base = basePerp(symbol) ?? (/^[A-Z0-9]{2,20}$/.test(symbol) ? symbol : null);
    if (base) symbol = `${base}-PERP`; // anciennes sessions : perp déjà explicitement identifié
  }
  // Une provenance TradFi restaurée porte déjà la nature du marché : son ticker
  // libre peut finir par une devise crypto sans désigner une paire (ex. GBTC).
  const kind = symbol.endsWith("-PERP") ? "perp" : identity.exchange === "twelvedata" || isTradfiMarketSymbol(symbol) ? "tradfi" : "spot";
  if (kind === "spot") symbol = normalizeSpot(symbol);
  // Catalogue TD volontairement curé : conserver les actions/forex en saisie libre.
  let candidates: Array<MarketCandidate & { speculative?: true }>;
  if (kind === "tradfi") candidates = [{ exchange: "twelvedata", symbol, kind }];
  else {
    const loaded = catalog ?? await fetchMarketCatalog();
    candidates = loaded.instruments.filter((p) => p.kind === kind && p.symbol === symbol);
    // Une panne de catalogue ne prouve pas l'absence de l'actif. Toutes les sources
    // du même type peuvent encore être vérifiées, après les instruments confirmés.
    for (const source of SOURCES) {
      const sameKind = kind === "perp" ? source === "hyperliquid" : SOURCES.slice(0, 6).includes(source);
      if (sameKind && loaded.unavailableSources.includes(source) && !candidates.some((candidate) => candidate.exchange === source)) {
        candidates.push({ exchange: source, symbol, kind, speculative: true });
      }
    }
  }
  const supportsRequestedTimeframe = (candidate: MarketCandidate) => supportedTimeframesFor(candidate.exchange, symbol).includes(identity.timeframe);
  candidates.sort((a, b) => Number(!!a.speculative) - Number(!!b.speculative)
    || Number(supportsRequestedTimeframe(b)) - Number(supportsRequestedTimeframe(a))
    || Number(b.exchange === identity.exchange) - Number(a.exchange === identity.exchange)
    || SOURCES.indexOf(a.exchange) - SOURCES.indexOf(b.exchange));
  // Un timeframe propre à une place (ex. Binance 1s) ne doit pas éliminer les
  // autres sources : leur backfill peut réussir avec le repli 1h déjà supporté.
  return candidates.map((candidate) => ({
    exchange: candidate.exchange,
    symbol,
    timeframe: supportsRequestedTimeframe(candidate) ? identity.timeframe : "1h",
    ...(candidate.speculative ? { speculative: true as const } : {}),
  }));
}
