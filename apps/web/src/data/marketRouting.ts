/** Catalogue et sélection automatiques : une seule paire, une seule devise, un seul marché. */
import type { ExchangeId, Timeframe } from "@axiom/types";
import { fetchPairs, isTradfiMarketSymbol, pairsCacheExpiresAt, TRADFI_SEARCH_METADATA, TWELVEDATA_SYMBOLS } from "./pairs";
import { supportedTimeframesFor } from "./adapters";
import { debutAccessible, lireProfondeur, mesurerProfondeurs, toleranceProfondeurMs } from "./profondeurHistorique";
import { estSymboleCapitalisation, SYMBOLES_CAPITALISATION } from "./mcap";
import { parseSyntheticSymbol } from "./synthetic";
import { basePerp, splitSymbol } from "./symbol";
import { timeframeProche } from "./adapters";

export interface MarketCandidate {
  exchange: ExchangeId;
  symbol: string;
  kind: "spot" | "perp" | "tradfi" | "synthetic";
  /** Libellé de découverte ; l'identité utilisée pour les données reste `symbol`. */
  label?: string;
  /** Recherche : places confirmées classées (au moins deux). */
  places?: ExchangeId[];
  /** Recherche : au moins une de ces places sans mesure de profondeur en cache. */
  profondeurIncomplete?: true;
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

/**
 * Ordre de départage final. Au comptant, la profondeur d'historique décide d'abord (cf.
 * `classer`) ; Binance, seule place au split taker, ne départage qu'à profondeur équivalente.
 */
const SOURCES: readonly ExchangeId[] = ["binance", "kraken", "coinbase", "bybit", "okx", "mexc", "twelvedata", "hyperliquid"];
const SPOT = SOURCES.slice(0, 6);
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

/**
 * Un résultat par instrument (`kind:symbol`), dans l'ordre habituel ; son représentant est la
 * place la mieux classée d'après le cache de profondeur (`timeframe`), sans aucune mesure réseau.
 */
export function searchMarkets(catalog: MarketCatalog, query: string, limit = 30, timeframe: Timeframe = "1h"): MarketCandidate[] {
  const q = query.trim().toUpperCase();
  const groupes = new Map<string, MarketCandidate[]>();
  const metadata = (candidate: MarketCandidate) => candidate.exchange === "twelvedata" ? TRADFI_SEARCH_METADATA[candidate.symbol] : undefined;
  const rank = (candidate: MarketCandidate) => candidate.symbol === q ? 3
    : metadata(candidate)?.aliases.includes(q) ? 2 : candidate.symbol.startsWith(q) ? 1 : 0;
  catalog.instruments
    .filter((candidate) => {
      const details = metadata(candidate);
      return candidate.symbol.toUpperCase().includes(q)
        || details?.label.toUpperCase().includes(q)
        || details?.aliases.some((alias) => alias.includes(q));
    })
    .sort((a, b) => SOURCES.indexOf(a.exchange) - SOURCES.indexOf(b.exchange))
    .forEach((candidate) => {
      const key = `${candidate.kind}:${candidate.symbol}`;
      groupes.get(key)?.push(candidate) ?? groupes.set(key, [candidate]);
    });
  return [...groupes.values()]
    .sort((a, b) => rank(b[0]!) - rank(a[0]!))
    .slice(0, limit)
    .map((groupe) => {
      const candidate = (groupe.length > 1 ? classer(groupe, groupe[0]!.symbol, timeframe) : groupe)[0]!;
      const details = metadata(candidate);
      return {
        ...candidate,
        ...(details ? { label: details.label } : {}),
        ...(groupe.length > 1 ? { places: groupe.map((c) => c.exchange) } : {}),
        ...(groupe.length > 1 && groupe.some((c) => lireProfondeur(c.exchange, c.symbol) === undefined) ? { profondeurIncomplete: true as const } : {}),
      };
    });
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
 * Classement transitif par clés propres à chaque candidat : essai spéculatif hors provenance en
 * dernier, unité de temps supportée, palier de profondeur (0 : début accessible à la tolérance près
 * du plus profond, ou inconnu — une mesure absente ne fait jamais perdre la tête ; 1 : au-delà,
 * par début croissant ; 2 : aucune bougie), puis Binance confirmé, provenance, ordre SOURCES.
 * La profondeur accessible dépend de l'unité de temps : la place retenue la suit (HYPEUSD :
 * Kraken en 1d, Coinbase en 1h), même contre la provenance.
 */
function classer<T extends { exchange: ExchangeId; speculative?: true }>(liste: T[], symbol: string, timeframe: Timeframe, provenance?: ExchangeId): T[] {
  const debuts = liste.map((c) => debutAccessible(c.exchange, symbol, timeframe));
  const limite = Math.min(...debuts.map((d) => d ?? Infinity)) + toleranceProfondeurMs(timeframe);
  const cles = new Map(liste.map((c, i): [T, number[]] => {
    const d = debuts[i];
    const palier = d === undefined ? 0 : d === null ? 2 : d <= limite ? 0 : 1;
    return [c, [
      Number(!!c.speculative && c.exchange !== provenance),
      Number(!supportedTimeframesFor(c.exchange, symbol).includes(timeframe)),
      palier, palier === 1 ? d! : 0,
      Number(c.exchange !== "binance" || !!c.speculative),
      Number(c.exchange !== provenance),
      SOURCES.indexOf(c.exchange),
    ]];
  }));
  return liste.sort((a, b) => {
    const x = cles.get(a)!, y = cles.get(b)!;
    return x.reduce((ecart, v, i) => ecart || v - y[i]!, 0);
  });
}

/**
 * Instruments confirmés (et provenance restaurée, même sans catalogue) classés par `classer`.
 * Aucun passage spot/perp ni USD/USDT/USDC : même instrument.
 */
function candidatsDepuisCatalogue(id: IdentitePreparee, loaded: MarketCatalog): ResolvedMarket[] {
  const { symbol, kind } = id;
  if (kind === "synthetic") {
    const supported = supportedTimeframesFor("synthetic", symbol);
    const timeframe = timeframeProche(supported, id.timeframe); // unité retirée (÷SPY 4h) : la suivante
    return timeframe ? [{ exchange: "synthetic", symbol, timeframe }] : [];
  }
  let candidates: Array<MarketCandidate & { speculative?: true }>;
  if (kind === "tradfi") candidates = [{ exchange: "twelvedata", symbol, kind }];
  else {
    candidates = loaded.instruments.filter((p) => p.kind === kind && p.symbol === symbol);
    // Une panne de catalogue ne prouve pas l'absence de l'actif. Toutes les sources
    // du même type peuvent encore être vérifiées, après les instruments confirmés.
    for (const source of SOURCES) {
      const sameKind = kind === "perp" ? source === "hyperliquid" : SPOT.includes(source);
      if (sameKind && loaded.unavailableSources.includes(source) && !candidates.some((candidate) => candidate.exchange === source)) {
        candidates.push({ exchange: source, symbol, kind, speculative: true });
      }
    }
  }
  const supportsRequestedTimeframe = (candidate: MarketCandidate) => supportedTimeframesFor(candidate.exchange, symbol).includes(id.timeframe);
  // Seule la provenance restaurée garde son rang sans catalogue : Binance non confirmé (catalogue
  // en panne) reste un essai comme les autres, sans basculer ni perdre ses limites.
  classer(candidates, symbol, id.timeframe, id.exchange);
  // Un timeframe propre à une place (ex. Binance 1s) ne doit pas éliminer les
  // autres sources : leur backfill peut réussir avec le repli 1h déjà supporté.
  return candidates.map((candidate) => ({
    exchange: candidate.exchange,
    symbol,
    timeframe: supportsRequestedTimeframe(candidate) ? id.timeframe : "1h",
    ...(candidate.speculative ? { speculative: true as const } : {}),
  }));
}

/** Classement après mesure bornée (2,5 s) des places spot confirmées, dès qu'il y en a deux. */
async function avecProfondeurs(id: IdentitePreparee, loaded: MarketCatalog): Promise<ResolvedMarket[]> {
  const confirmes = id.kind === "spot" ? loaded.instruments.filter((p) => p.kind === "spot" && p.symbol === id.symbol) : [];
  if (confirmes.length > 1) await mesurerProfondeurs(confirmes);
  return candidatsDepuisCatalogue(id, loaded);
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
  if (sansCatalogue(id)) return candidatsDepuisCatalogue(id, CATALOGUE_VIDE);
  let loaded = catalog ?? await fetchMarketCatalog();
  if (!catalog && pendingCatalog && !candidatsDepuisCatalogue(id, loaded).some((candidat) => !candidat.speculative)) loaded = await pendingCatalog;
  return avecProfondeurs(id, loaded);
}

/** Premiers essais disponibles tout de suite, liste complète habituelle à la demande. */
export interface CandidatsProgressifs {
  immediats: ResolvedMarket[];
  complets: () => Promise<ResolvedMarket[]>;
}

/**
 * Backfill du graphe. Catalogue en cache (même périmé) : liste complète classée après mesure
 * bornée ; s'il est périmé, `complets` attend le rafraîchissement que sa lecture a lancé (un actif
 * coté depuis, ou retiré, trouve ainsi son repli) ; sans aucun instrument confirmé, rien ne part
 * avant elle. À froid : les huit catalogues partent ; le perp n'attend qu'Hyperliquid. Au
 * comptant, une profondeur déjà en cache prouve la cotation : la meilleure place part sans
 * attendre les autres catalogues (Binance non mesuré : son catalogue puis sa sonde bornée, pour
 * conclure comme `resolveMarketCandidates`). Sinon Binance (référence, parfois lent) est attendu,
 * les autres places spot jusqu'à une échéance commune (2,5 s après le début, ou l'arrivée de
 * Binance) ; celles-là sont mesurées puis classées, les retardataires ne comptent que dans
 * `complets` (catalogue entier).
 */
export async function resolveMarketCandidatesProgressifs(
  identity: { exchange?: ExchangeId; symbol: string; timeframe: Timeframe },
): Promise<CandidatsProgressifs> {
  const id = preparerIdentite(identity);
  const deja = (liste: ResolvedMarket[]): CandidatsProgressifs => ({ immediats: liste, complets: () => Promise.resolve(liste) });
  if (sansCatalogue(id)) return deja(candidatsDepuisCatalogue(id, CATALOGUE_VIDE));
  if (cachedCatalog) {
    const loaded = await fetchMarketCatalog();
    // Rafraîchissement lancé par cette lecture, capté avant la mesure (il peut finir pendant).
    const rafraichissement = pendingCatalog;
    const liste = await avecProfondeurs(id, loaded);
    if (!rafraichissement) return deja(liste);
    // Copie périmée sans instrument confirmé (actif coté depuis) : attendre la liste fraîche
    // plutôt que le chien de garde d'un essai spéculatif sur une place muette.
    return { immediats: liste.some((c) => !c.speculative) ? liste : [], complets: () => rafraichissement.then((frais) => avecProfondeurs(id, frais)) };
  }
  const debut = Date.now();
  const complet = fetchMarketCatalog();
  const complets = () => complet.then((loaded) => avecProfondeurs(id, loaded));
  const places = (liste: ExchangeId[]): MarketCatalog => ({ instruments: liste.map((exchange) => ({ exchange, symbol: id.symbol, kind: id.kind })), unavailableSources: [] });
  const retenus = (liste: ResolvedMarket[]) => liste.filter((c) => c.timeframe === id.timeframe);
  // Requêtes partagées avec le catalogue en vol ; Hyperliquid y enregistre aussi sa casse (kPEPE).
  const cote = (place: ExchangeId) => fetchPairs(place).then((paires) => paires.includes(id.symbol), () => false);
  if (id.kind === "perp") return { immediats: await cote("hyperliquid") ? retenus(candidatsDepuisCatalogue(id, places(["hyperliquid"]))) : [], complets };
  const connues = SPOT.filter((place) => typeof lireProfondeur(place, id.symbol) === "object");
  // Binance sans mesure (sonde échouée, entrée élaguée) : comme la résolution complète, son
  // catalogue puis sa sonde bornée ; encore inconnu, il garde le bénéfice du doute.
  if (connues.length && lireProfondeur("binance", id.symbol) === undefined && await cote("binance")) {
    await mesurerProfondeurs([{ exchange: "binance", symbol: id.symbol }]);
    connues.push("binance");
  }
  const [meilleure] = retenus(candidatsDepuisCatalogue(id, places(connues)));
  if (meilleure) return { immediats: [meilleure], complets };
  const confirmees: ExchangeId[] = [];
  const suivis = SPOT.map((place) => cote(place).then((oui) => { if (oui) confirmees.push(place); }));
  await suivis[0];
  const reste = debut + 2_500 - Date.now();
  if (reste > 0) await Promise.race([Promise.all(suivis), new Promise((fin) => setTimeout(fin, reste))]);
  // Comme sur main, sans aucune place confirmée, la provenance spot reste attendue au-delà de
  // l'échéance : un actif propre à une place lente (okx:CARDSUSDT) n'attend pas le catalogue le
  // plus lent de la liste complète.
  const rang = id.exchange ? SPOT.indexOf(id.exchange) : -1;
  if (rang > 0 && !confirmees.length) await suivis[rang];
  return { immediats: retenus(await avecProfondeurs(id, places(SPOT.filter((place) => confirmees.includes(place))))), complets };
}
