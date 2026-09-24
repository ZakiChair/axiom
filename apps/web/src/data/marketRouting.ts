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
/** Le rafraîchissement en vol passe-t-il outre les échecs mémorisés par source (`force`) ? */
let pendingForce = false;
let cachedCatalog: { value: MarketCatalog; expires: number; signature: string } | undefined;
const catalogListeners = new Set<(catalog: MarketCatalog) => void>();

/** Abonnement aux changements de contenu ; lecture du cache ou rafraîchissement identique ne republient pas. */
export function subscribeMarketCatalog(listener: (catalog: MarketCatalog) => void): () => void {
  catalogListeners.add(listener);
  return () => { catalogListeners.delete(listener); };
}

/** Contenu comparable : instruments par source (ordre du catalogue) et sources indisponibles. */
function signatureCatalogue(catalog: MarketCatalog): string {
  return `${catalog.unavailableSources.join()}|${catalog.instruments.map((p) => `${p.exchange}:${p.symbol}`).join()}`;
}

/**
 * Catalogue commun, servi même expiré (stale-while-revalidate) : la lecture est immédiate
 * et le rafraîchissement part en arrière-plan, une seule fois à la fois. Seule la toute
 * première lecture attend le réseau ; `force` l'attend toujours.
 */
export function fetchMarketCatalog(options: { force?: boolean } = {}): Promise<MarketCatalog> {
  if (!options.force && cachedCatalog) {
    if (cachedCatalog.expires <= Date.now()) void rafraichirCatalogue(options);
    return Promise.resolve(cachedCatalog.value);
  }
  return rafraichirCatalogue(options);
}

function rafraichirCatalogue(options: { force?: boolean }): Promise<MarketCatalog> {
  if (pendingCatalog) {
    // Un rafraîchissement ordinaire rejoue les échecs mémorisés : `force` le laisse finir puis réinterroge.
    return options.force && !pendingForce ? pendingCatalog.then(() => rafraichirCatalogue(options)) : pendingCatalog;
  }
  pendingForce = options.force === true;
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
    const fresh = { instruments, unavailableSources };
    // Les échecs restent réessayables sans marteler une place bloquée à chaque slot/clic.
    const sourceExpirations = SOURCES.map(pairsCacheExpiresAt).filter((expires): expires is number => expires !== undefined);
    const expires = Math.min(Date.now() + (unavailableSources.length ? 30_000 : 5 * 60_000), ...sourceExpirations);
    // Contenu inchangé : même objet (aucune vue ne relance ses sondes), seule l'échéance avance.
    const signature = signatureCatalogue(fresh);
    const changed = cachedCatalog?.signature !== signature;
    const value = changed || !cachedCatalog ? fresh : cachedCatalog.value;
    cachedCatalog = { value, expires, signature };
    if (changed) for (const listener of [...catalogListeners]) {
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

/** Identité normalisée une fois : casse, alias, migration `-PERP` et nature du marché. */
interface IdentitePreparee { exchange?: ExchangeId; symbol: string; timeframe: Timeframe; kind: MarketCandidate["kind"] }

function preparerIdentite(identity: { exchange?: ExchangeId; symbol: string; timeframe: Timeframe }): IdentitePreparee {
  let symbol = identity.symbol.trim();
  if (!symbol.includes("|")) symbol = symbol.toUpperCase();
  if (estSymboleCapitalisation(symbol) || parseSyntheticSymbol(symbol)) return { ...identity, symbol, kind: "synthetic" };
  if (identity.exchange === "hyperliquid" && !symbol.endsWith("-PERP") && !TWELVEDATA_SYMBOLS.includes(symbol)) {
    const base = basePerp(symbol) ?? (/^[A-Z0-9]{2,20}$/.test(symbol) ? symbol : null);
    if (base) symbol = `${base}-PERP`; // anciennes sessions : perp déjà explicitement identifié
  }
  // Une provenance TradFi restaurée porte déjà la nature du marché : son ticker
  // libre peut finir par une devise crypto sans désigner une paire (ex. GBTC).
  const kind = symbol.endsWith("-PERP") ? "perp" : identity.exchange === "twelvedata" || isTradfiMarketSymbol(symbol) ? "tradfi" : "spot";
  return { ...identity, symbol: kind === "spot" ? normalizeSpot(symbol) : symbol, kind };
}

/** Synthétiques et TradFi (catalogue curé, saisie libre) se résolvent sans catalogue. */
const sansCatalogue = (id: IdentitePreparee) => id.kind === "synthetic" || id.kind === "tradfi";
const CATALOGUE_VIDE: MarketCatalog = { instruments: [], unavailableSources: [] };

/**
 * Instruments confirmés prioritaires, puis support du timeframe, Binance confirmé (seule
 * place au split taker : une provenance héritée d'un autre actif ne l'évince pas),
 * provenance courante entre les replis, et ordre du catalogue. Aucun passage spot/perp
 * ni USD/USDT/USDC : même instrument.
 */
function candidatsDepuisCatalogue(id: IdentitePreparee, loaded: MarketCatalog): ResolvedMarket[] {
  const { symbol, kind } = id;
  if (kind === "synthetic") {
    const supported = supportedTimeframesFor("synthetic", symbol);
    const timeframe = supported.includes(id.timeframe) ? id.timeframe : supported.includes("1h") ? "1h" : supported[0];
    return timeframe ? [{ exchange: "synthetic", symbol, timeframe }] : [];
  }
  let candidates: Array<MarketCandidate & { speculative?: true }>;
  if (kind === "tradfi") candidates = [{ exchange: "twelvedata", symbol, kind }];
  else {
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
  const supportsRequestedTimeframe = (candidate: MarketCandidate) => supportedTimeframesFor(candidate.exchange, symbol).includes(id.timeframe);
  candidates.sort((a, b) => Number(!!a.speculative) - Number(!!b.speculative)
    || Number(supportsRequestedTimeframe(b)) - Number(supportsRequestedTimeframe(a))
    // Binance non confirmé (catalogue en panne) reste un essai comme les autres : la
    // provenance restaurée garde alors la tête, sans basculer ni perdre ses limites.
    || Number(b.exchange === "binance" && !b.speculative) - Number(a.exchange === "binance" && !a.speculative)
    || Number(b.exchange === id.exchange) - Number(a.exchange === id.exchange)
    || SOURCES.indexOf(a.exchange) - SOURCES.indexOf(b.exchange));
  // Un timeframe propre à une place (ex. Binance 1s) ne doit pas éliminer les
  // autres sources : leur backfill peut réussir avec le repli 1h déjà supporté.
  return candidates.map((candidate) => ({
    exchange: candidate.exchange,
    symbol,
    timeframe: supportsRequestedTimeframe(candidate) ? id.timeframe : "1h",
    ...(candidate.speculative ? { speculative: true as const } : {}),
  }));
}

/**
 * Le catalogue optionnel permet les usages déjà chargés et les tests sans réseau.
 * Catalogue périmé servi pendant son rafraîchissement : un actif qu'il ne confirme pas
 * (nouvelle cotation) attend ce rafraîchissement au lieu d'être déclaré introuvable.
 */
export async function resolveMarketCandidates(
  identity: { exchange?: ExchangeId; symbol: string; timeframe: Timeframe },
  catalog?: MarketCatalog,
): Promise<ResolvedMarket[]> {
  const id = preparerIdentite(identity);
  if (catalog || sansCatalogue(id)) return candidatsDepuisCatalogue(id, catalog ?? CATALOGUE_VIDE);
  const liste = candidatsDepuisCatalogue(id, await fetchMarketCatalog());
  return pendingCatalog && !liste.some((candidat) => !candidat.speculative)
    ? candidatsDepuisCatalogue(id, await pendingCatalog)
    : liste;
}

/** Premiers essais disponibles tout de suite, liste complète habituelle à la demande. */
export interface CandidatsProgressifs {
  immediats: ResolvedMarket[];
  complets: () => Promise<ResolvedMarket[]>;
}

/**
 * Chemin rapide du backfill. Catalogue en cache (même périmé) : liste complète habituelle ;
 * s'il est périmé, `complets` attend le rafraîchissement que sa lecture a lancé (un actif
 * coté depuis, ou retiré, trouve ainsi son repli). À froid : les huit catalogues partent, mais seul celui de la source prioritaire
 * (Binance au comptant, Hyperliquid pour -PERP) est attendu ; s'il confirme symbole et
 * unité de temps, ce candidat — déjà premier de la liste complète — part sans attendre
 * les autres places. `complets` attend le catalogue entier pour les replis.
 */
export async function resolveMarketCandidatesProgressifs(
  identity: { exchange?: ExchangeId; symbol: string; timeframe: Timeframe },
): Promise<CandidatsProgressifs> {
  const id = preparerIdentite(identity);
  const deja = (liste: ResolvedMarket[]): CandidatsProgressifs => ({ immediats: liste, complets: () => Promise.resolve(liste) });
  if (sansCatalogue(id)) return deja(candidatsDepuisCatalogue(id, CATALOGUE_VIDE));
  if (cachedCatalog) {
    const liste = candidatsDepuisCatalogue(id, await fetchMarketCatalog());
    if (!pendingCatalog) return deja(liste);
    return { immediats: liste, complets: () => (pendingCatalog ?? fetchMarketCatalog()).then((loaded) => candidatsDepuisCatalogue(id, loaded)) };
  }
  const complet = fetchMarketCatalog();
  const prioritaire: ExchangeId = id.kind === "perp" ? "hyperliquid" : "binance";
  // Requête partagée avec le catalogue en vol ; Hyperliquid y enregistre aussi sa casse (kPEPE).
  const paires = await fetchPairs(prioritaire).catch((): string[] => []);
  const confirme = paires.includes(id.symbol) && supportedTimeframesFor(prioritaire, id.symbol).includes(id.timeframe);
  return {
    immediats: confirme ? [{ exchange: prioritaire, symbol: id.symbol, timeframe: id.timeframe }] : [],
    complets: () => complet.then((loaded) => candidatsDepuisCatalogue(id, loaded)),
  };
}
