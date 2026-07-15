/**
 * Vue marché — agrégat CoinGecko (public, tier gratuit) pour le panneau IMAP.
 *
 * Sert trois choses au panneau treemap / secteurs :
 *   1. /global            → capitalisation totale, dominance BTC/ETH, volume 24 h.
 *   2. /coins/markets     → top ~250 par capitalisation (taille + Δ24 h des tuiles).
 *   3. /coins/categories  → performance par SECTEUR (onglet « Secteurs »).
 * Auth : publique/keyless ; une clé Demo OPTIONNELLE (query `x_cg_demo_api_key`,
 * même stockage `axiom.coingecko.demoApiKey` que data/macro/coingecko.ts) relève les
 * quotas sans jamais être requise. CoinGecko renvoie l'en-tête CORS `*` → appel DIRECT
 * (pas via /extapi). Le Fear & Greed, lui, n'a pas de CORS → via le proxy /extapi.
 *
 * BUDGET STRICT : un « refresh » = AU PLUS 3 requêtes CoinGecko. Un cache localStorage
 * (5 min) absorbe les ouvertures répétées ; en cas d'échec réseau on RETOMBE sur le
 * cache périmé (dégradation gracieuse : aucune boucle d'erreur, la santé le signale).
 *
 * Séparation testable : les PARSERS (parseGlobal/parseMarkets/parseCategories/
 * parseFearGreed) sont PURS et testés avec fixtures inline ; l'IO (fetch/cache) autour.
 */
import { healthStore } from "../store/health";
import { extUrl } from "./extapi";

// ─────────────────────────── Types de sortie ───────────────────────────

/** Instantané global du marché (en-tête du panneau). */
export interface MarketGlobal {
  /** Capitalisation totale toutes cryptos (USD). */
  totalMcapUsd: number;
  /** Volume total échangé 24 h (USD). */
  totalVolumeUsd: number;
  /** Dominance BTC (%). */
  btcDominance: number;
  /** Dominance ETH (%). */
  ethDominance: number;
  /** Variation de la capitalisation totale sur 24 h (%). */
  mcapChangePct24h: number;
}

/** Une tuile de la treemap (un actif du top par capitalisation). */
export interface CoinTile {
  /** Identifiant CoinGecko (ex. "bitcoin"). */
  id: string;
  /** Ticker en MAJUSCULES (ex. "BTC"). */
  symbol: string;
  /** Nom lisible (ex. "Bitcoin"). */
  name: string;
  /** Capitalisation (USD) — taille de la tuile. */
  mcapUsd: number;
  /** Dernier prix (USD). */
  price: number;
  /** Variation 24 h (%) — couleur de la tuile. */
  changePct24h: number;
}

/** Performance d'un secteur (catégorie CoinGecko). */
export interface SectorPerf {
  id: string;
  name: string;
  /** Variation moyenne pondérée du secteur sur 24 h (%). */
  changePct24h: number;
  /** Capitalisation agrégée du secteur (USD). */
  mcapUsd: number;
}

/** Agrégat complet servi au panneau. */
export interface MarketOverview {
  global: MarketGlobal;
  coins: CoinTile[];
  sectors: SectorPerf[];
  /** ms epoch de la récupération (âge affiché « maj il y a … »). */
  fetchedAt: number;
  /** true si servi depuis le cache périmé faute de réseau (dégradation). */
  stale: boolean;
}

/** Indice Fear & Greed (0-100 + libellé). */
export interface FearGreed {
  value: number;
  classification: string;
  /** ms epoch de la mesure. */
  time: number;
}

// ─────────────────────────── Constantes ───────────────────────────

const CG_BASE = "https://api.coingecko.com/api/v3";
const DEMO_KEY_STORAGE = "axiom.coingecko.demoApiKey";
const MARKETS_PER_PAGE = 250;

const CACHE_KEY = "axiom.marketmap.overview.v1";
const CACHE_TTL_MS = 5 * 60_000; // 5 min (cf. BUDGET)
const FNG_CACHE_KEY = "axiom.marketmap.fng.v1";
const FNG_TTL_MS = 60 * 60_000; // 1 h

/** Source santé (apparaît dans le panneau « Santé sources »). */
const HEALTH_SOURCE = "coingecko:market";

// ─────────────────────────── Parsers PURS ───────────────────────────

/** Nombre fini, sinon `fallback`. PURE. */
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Forme brute (partielle) de /global. */
interface GlobalRaw {
  data?: {
    total_market_cap?: { usd?: unknown };
    total_volume?: { usd?: unknown };
    market_cap_percentage?: { btc?: unknown; eth?: unknown };
    market_cap_change_percentage_24h_usd?: unknown;
  };
}

/** Parse /global en instantané global. PURE (tolérante aux champs manquants). */
export function parseGlobal(json: unknown): MarketGlobal {
  const d = (json as GlobalRaw | null)?.data ?? {};
  return {
    totalMcapUsd: num(d.total_market_cap?.usd),
    totalVolumeUsd: num(d.total_volume?.usd),
    btcDominance: num(d.market_cap_percentage?.btc),
    ethDominance: num(d.market_cap_percentage?.eth),
    mcapChangePct24h: num(d.market_cap_change_percentage_24h_usd),
  };
}

/** Forme brute (partielle) d'une entrée /coins/markets. */
interface MarketRaw {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
  current_price?: unknown;
  market_cap?: unknown;
  price_change_percentage_24h?: unknown;
}

/**
 * Parse /coins/markets en tuiles, triées par capitalisation décroissante. PURE.
 * Ignore les entrées sans id/symbol ou de capitalisation ≤ 0 (inutilisables en tuile).
 */
export function parseMarkets(json: unknown): CoinTile[] {
  if (!Array.isArray(json)) return [];
  const out: CoinTile[] = [];
  for (const raw of json as MarketRaw[]) {
    const id = typeof raw.id === "string" ? raw.id : "";
    const symbol = typeof raw.symbol === "string" ? raw.symbol.toUpperCase() : "";
    const mcapUsd = num(raw.market_cap);
    if (id === "" || symbol === "" || mcapUsd <= 0) continue;
    out.push({
      id,
      symbol,
      name: typeof raw.name === "string" ? raw.name : symbol,
      mcapUsd,
      price: num(raw.current_price),
      changePct24h: num(raw.price_change_percentage_24h),
    });
  }
  out.sort((a, b) => b.mcapUsd - a.mcapUsd);
  return out;
}

/** Forme brute (partielle) d'une entrée /coins/categories. */
interface CategoryRaw {
  id?: unknown;
  name?: unknown;
  market_cap?: unknown;
  market_cap_change_24h?: unknown;
}

/**
 * Parse /coins/categories en performances sectorielles, triées par |Δ24 h| décroissant
 * (les secteurs qui bougent le plus en tête). PURE. Ignore les entrées sans nom.
 */
export function parseCategories(json: unknown): SectorPerf[] {
  if (!Array.isArray(json)) return [];
  const out: SectorPerf[] = [];
  for (const raw of json as CategoryRaw[]) {
    const name = typeof raw.name === "string" ? raw.name : "";
    if (name === "") continue;
    // Certaines catégories renvoient market_cap_change_24h = null → 0 (neutre).
    out.push({
      id: typeof raw.id === "string" ? raw.id : name,
      name,
      changePct24h: num(raw.market_cap_change_24h),
      mcapUsd: num(raw.market_cap),
    });
  }
  out.sort((a, b) => Math.abs(b.changePct24h) - Math.abs(a.changePct24h));
  return out;
}

/** Forme brute (partielle) de la réponse Fear & Greed (alternative.me). */
interface FngRaw {
  data?: Array<{ value?: unknown; value_classification?: unknown; timestamp?: unknown }>;
}

/**
 * Parse la réponse Fear & Greed (le champ `value` est une CHAÎNE "0"-"100",
 * `timestamp` une chaîne en SECONDES epoch). PURE. Renvoie null si vide/invalide.
 */
export function parseFearGreed(json: unknown): FearGreed | null {
  const first = (json as FngRaw | null)?.data?.[0];
  if (!first) return null;
  const value = Number(first.value);
  if (!Number.isFinite(value)) return null;
  const tsSec = Number(first.timestamp);
  return {
    value,
    classification: typeof first.value_classification === "string" ? first.value_classification : "",
    time: Number.isFinite(tsSec) ? tsSec * 1000 : Date.now(),
  };
}

/** Point d'historique Fear & Greed {time ms, value 0-100}. */
export interface FearGreedPoint {
  time: number;
  value: number;
}

/**
 * Parse l'HISTORIQUE Fear & Greed (data[] chronologique, `value` chaîne 0-100,
 * `timestamp` en secondes). PURE : écarte le non-numérique, trie par temps croissant.
 */
export function parseFearGreedHistory(json: unknown): FearGreedPoint[] {
  const data = (json as FngRaw | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: FearGreedPoint[] = [];
  for (const d of data) {
    const value = Number(d.value);
    const tsSec = Number(d.timestamp);
    if (Number.isFinite(value) && Number.isFinite(tsSec)) out.push({ time: tsSec * 1000, value });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * Résolution best-effort d'un ticker CoinGecko vers une paire Binance USDT
 * (ex. "BTC" → "BTCUSDT"). PURE. L'appelant vérifie l'existence réelle de la paire
 * contre le catalogue Binance avant de naviguer (« sinon rien »).
 */
export function toBinanceUsdtPair(symbol: string): string {
  return `${symbol.trim().toUpperCase()}USDT`;
}

// ─────────────────────────── Cache localStorage ───────────────────────────

/** Lecture tolérante d'un cache JSON typé (localStorage absent/corrompu → null). */
function readCache<T>(key: string): T | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Écriture tolérante (quota / mode privé → silencieux). */
function writeCache(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort */
  }
}

/** Clé Demo OPTIONNELLE (localStorage) — même emplacement que le fournisseur macro. */
function resolveDemoKey(): string | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    return localStorage.getItem(DEMO_KEY_STORAGE) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Ajoute la clé Demo à une URL CoinGecko si présente. */
function withDemoKey(url: string): string {
  const key = resolveDemoKey();
  if (!key) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}x_cg_demo_api_key=${encodeURIComponent(key)}`;
}

// ─────────────────────────── IO ───────────────────────────

/** GET JSON avec vérification de statut (lève sur !ok). */
async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Récupère l'agrégat marché. Cache 5 min : une ouverture dans la fenêtre de fraîcheur
 * ne déclenche AUCUN appel. Sinon EXACTEMENT 3 requêtes CoinGecko (global/markets/
 * categories) en parallèle. Échec réseau → repli sur le cache périmé (`stale: true`) ;
 * si aucun cache, l'erreur est propagée (l'appelant affiche l'état d'erreur).
 */
export async function fetchMarketOverview(signal?: AbortSignal): Promise<MarketOverview> {
  const cached = readCache<MarketOverview>(CACHE_KEY);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached, stale: false };
  }

  const [globalR, marketsR, categoriesR] = await Promise.allSettled([
    getJson(withDemoKey(`${CG_BASE}/global`), signal),
    getJson(
      withDemoKey(`${CG_BASE}/coins/markets?vs_currency=usd&per_page=${MARKETS_PER_PAGE}&page=1`),
      signal,
    ),
    getJson(withDemoKey(`${CG_BASE}/coins/categories?order=market_cap_desc`), signal),
  ]);

  // La treemap exige global + markets ; les secteurs sont un bonus (dégradable).
  if (globalR.status === "fulfilled" && marketsR.status === "fulfilled") {
    const overview: MarketOverview = {
      global: parseGlobal(globalR.value),
      coins: parseMarkets(marketsR.value),
      sectors: categoriesR.status === "fulfilled" ? parseCategories(categoriesR.value) : cached?.sectors ?? [],
      fetchedAt: Date.now(),
      stale: false,
    };
    writeCache(CACHE_KEY, overview);
    healthStore.getState().setEtat(HEALTH_SOURCE, "polling", { dernierMessageTs: overview.fetchedAt });
    return overview;
  }

  // Échec des données essentielles : santé en erreur, repli gracieux sur le cache périmé.
  const reason = globalR.status === "rejected" ? globalR.reason : (marketsR as PromiseRejectedResult).reason;
  healthStore.getState().marquerErreur(HEALTH_SOURCE, reason instanceof Error ? reason.message : String(reason));
  if (cached) return { ...cached, stale: true };
  throw reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * Récupère l'indice Fear & Greed via le proxy /extapi (pas de CORS). Cache 1 h.
 * Renvoie null en cas d'échec (l'en-tête masque simplement l'indice — pas d'erreur).
 */
export async function fetchFearGreed(signal?: AbortSignal): Promise<FearGreed | null> {
  const cached = readCache<{ data: FearGreed; fetchedAt: number }>(FNG_CACHE_KEY);
  if (cached && Date.now() - cached.fetchedAt < FNG_TTL_MS) return cached.data;

  try {
    const json = await getJson(extUrl("api.alternative.me", "fng/?limit=1"), signal);
    const parsed = parseFearGreed(json);
    if (parsed) writeCache(FNG_CACHE_KEY, { data: parsed, fetchedAt: Date.now() });
    return parsed ?? cached?.data ?? null;
  } catch {
    return cached?.data ?? null;
  }
}

/**
 * Historique Fear & Greed (jusqu'à `limit` jours) pour l'indicateur de chart.
 * Global crypto (pas par actif). Dégradation gracieuse : [] sur échec réseau.
 */
export async function fetchFearGreedHistory(limit = 120, signal?: AbortSignal): Promise<FearGreedPoint[]> {
  try {
    const json = await getJson(extUrl("api.alternative.me", `fng/?limit=${limit}`), signal);
    return parseFearGreedHistory(json);
  } catch {
    return [];
  }
}
