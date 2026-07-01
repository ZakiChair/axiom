/**
 * Revenus on-chain du PROTOCOLE sous-jacent à l'actif analysé — DefiLlama (gratuit, sans clé).
 *
 * « Revenus » = la part des frais conservée par le protocole (dataType=dailyRevenue),
 * série JOURNALIÈRE. Endpoints (gratuits, sans clé — cf. stablecoins.ts) :
 *   - ticker → slug  : GET https://api.llama.fi/protocols
 *       → [{ symbol, slug, ... }]  (le TICKER vit ICI, PAS dans overview/fees)
 *   - slugs à revenus: GET https://api.llama.fi/overview/fees?excludeTotalDataChart=true
 *       → { protocols: [{ slug, ... }] }  (AUCUN `symbol` ⇒ inutilisable seul pour le ticker)
 *   - série          : GET https://api.llama.fi/summary/fees/{slug}?dataType=dailyRevenue
 *       → { name, totalDataChart: [[tsSeconds, value], ...] }
 *   Doc : https://api-docs.defillama.com/  (section « fees and revenue »)
 *
 * Pertinence : n'a de sens que pour les actifs qui SONT des protocoles à revenus
 * (UNI, AAVE, GMX, LDO, MKR…). Pour BTC/ETH/SOL (chaînes L1, pas des protocoles au
 * sens DefiLlama « fees ») ou un token sans données : dégradation propre → `null`.
 *
 * Stratégie de résolution symbole → slug DefiLlama (robuste + dégradée) :
 *   1. table curée (slugs agrégés sûrs : « uniswap » plutôt que « uniswap-v3 ») ;
 *   2. à défaut, résolution dynamique : jointure `/protocols` (ticker → slug) ∩
 *      slugs porteurs de revenus (`overview/fees`). Parse défensif, jamais bloquant ;
 *   3. à défaut → `null` (« revenus indisponibles pour cet actif »).
 */

/** Un point de la série de revenus : ms epoch + revenu du jour en USD. */
export interface RevenuePoint {
  time: number;
  value: number;
}

const OVERVIEW_URL =
  "https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true";
/** Liste complète des protocoles DefiLlama — SEUL endpoint portant le `symbol` (ticker). */
const PROTOCOLS_URL = "https://api.llama.fi/protocols";
const summaryUrl = (slug: string) =>
  `https://api.llama.fi/summary/fees/${encodeURIComponent(slug)}?dataType=dailyRevenue`;

/** Suffixes de cotation à retirer (du plus LONG au plus court) pour isoler le ticker du token. */
const QUOTE_SUFFIXES = [
  "USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USD", "EUR", "GBP", "BTC", "ETH",
];

/**
 * Table CURÉE ticker → slug DefiLlama (protocoles à revenus établis dont le token
 * se trade sur Binance/Kraken/Coinbase). Un slug erroné ⇒ 404 ⇒ dégradation propre,
 * jamais un plantage. Extensible sans risque.
 */
const TOKEN_TO_PROTOCOL: Record<string, string> = {
  UNI: "uniswap",
  AAVE: "aave",
  GMX: "gmx",
  LDO: "lido",
  MKR: "makerdao",
  SUSHI: "sushiswap",
  CAKE: "pancakeswap",
  CRV: "curve-dex",
  SNX: "synthetix",
  DYDX: "dydx",
  PENDLE: "pendle",
  COMP: "compound-finance",
  BAL: "balancer",
  RPL: "rocket-pool",
  FXS: "frax",
  CVX: "convex-finance",
  GNS: "gains-network",
  JOE: "lfj",
  VELO: "velodrome",
  AERO: "aerodrome",
  PUMP: "pump.fun",
};

/** Isole le ticker du token (« UNIUSDT » → « UNI »). */
export function baseTicker(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  for (const q of QUOTE_SUFFIXES) {
    if (s.length > q.length && s.endsWith(q)) return s.slice(0, -q.length);
  }
  return s;
}

/** Cache mémoire (session) de la résolution dynamique ticker → slug. */
let overviewIndex: Map<string, string> | null = null;
let overviewPromise: Promise<Map<string, string>> | null = null;

/**
 * Construit (une fois) l'index ticker → slug DefiLlama. Parse DÉFENSIF, jamais bloquant.
 *
 * Le ticker (`symbol`) n'existe QUE sur `/protocols` ; `overview/fees` ne porte que des
 * `slug`. On JOINT donc les deux : pour chaque protocole de `/protocols` ayant un ticker,
 * on retient son slug s'il figure dans l'ensemble des slugs porteurs de revenus
 * (`overview/fees`). `/protocols` est trié par TVL décroissant ⇒ le premier match d'un
 * ticker = le protocole le plus important qui ait des revenus. Le slug retenu mène donc
 * à une série réelle (la série reste dégradée proprement si vide/404 côté contrôleur).
 */
async function loadOverviewIndex(): Promise<Map<string, string>> {
  if (overviewIndex) return overviewIndex;
  if (!overviewPromise) {
    overviewPromise = (async () => {
      const index = new Map<string, string>();
      try {
        // PAS de `signal` ici : cet index est partagé pour toute la session. Le lier au
        // contrôleur courant l'empoisonnerait à vide si l'utilisateur change de symbole
        // pendant ce fetch (gros payload `/protocols`) — la résolution dynamique
        // re-casserait pour le reste de la session. La série par symbole, elle, reste
        // bien annulable (cf. `fetchProtocolRevenue`).
        const [protocolsRes, feesRes] = await Promise.all([
          fetch(PROTOCOLS_URL),
          fetch(OVERVIEW_URL),
        ]);

        // 1) Ensemble des slugs porteurs de revenus (overview/fees → { protocols: [...] }).
        const revenueSlugs = new Set<string>();
        if (feesRes.ok) {
          const rawFees = (await feesRes.json()) as { protocols?: unknown };
          const feesList = Array.isArray(rawFees.protocols) ? rawFees.protocols : [];
          for (const item of feesList) {
            if (typeof item !== "object" || item === null) continue;
            const slug = (item as { slug?: unknown }).slug;
            if (typeof slug === "string" && slug.length > 0) revenueSlugs.add(slug);
          }
        }

        // 2) Jointure ticker → slug (/protocols → [{ symbol, slug, ... }], trié TVL desc).
        if (protocolsRes.ok && revenueSlugs.size > 0) {
          const rawProtocols = (await protocolsRes.json()) as unknown;
          const protocolsList = Array.isArray(rawProtocols) ? rawProtocols : [];
          for (const item of protocolsList) {
            if (typeof item !== "object" || item === null) continue;
            const p = item as { symbol?: unknown; slug?: unknown };
            const symbol = typeof p.symbol === "string" ? p.symbol.toUpperCase() : "";
            const slug = typeof p.slug === "string" ? p.slug : "";
            // « - » = pas de token ; on ne mappe que vers un slug AVÉRÉ porteur de revenus.
            if (symbol && symbol !== "-" && slug && revenueSlugs.has(slug) && !index.has(symbol)) {
              index.set(symbol, slug);
            }
          }
        }
      } catch {
        // Réseau/format KO : index (partiel ou vide) → on retombe sur la table curée.
      }
      overviewIndex = index;
      return index;
    })();
  }
  return overviewPromise;
}

/**
 * Résout le slug DefiLlama du protocole pour un symbole d'actif, ou `null` si aucun
 * protocole connu (BTC/ETH/SOL/L1, token sans données…). Curé d'abord, dynamique ensuite.
 */
export async function resolveProtocolSlug(symbol: string): Promise<string | null> {
  const base = baseTicker(symbol);
  const curated = TOKEN_TO_PROTOCOL[base];
  if (curated) return curated;
  const index = await loadOverviewIndex();
  return index.get(base) ?? null;
}

/** Point brut DefiLlama : [timestampSecondes, valeur]. */
type ChartTuple = [number, number];

/**
 * Récupère la série de revenus JOURNALIERS (USD) du protocole de `symbol`.
 * Retourne `null` si l'actif n'a pas de protocole connu (dégradation propre).
 * Lève en cas d'échec réseau du fetch de la série (le contrôleur l'attrape).
 */
export async function fetchProtocolRevenue(
  symbol: string,
  signal?: AbortSignal
): Promise<{ slug: string; series: RevenuePoint[] } | null> {
  const slug = await resolveProtocolSlug(symbol);
  if (!slug) return null;

  // La SÉRIE par symbole reste annulable (contrairement à l'index de slugs partagé).
  const res = await fetch(summaryUrl(slug), { signal });
  if (!res.ok) {
    // 404 = slug inconnu/sans revenus chez DefiLlama → indisponible (pas une erreur dure).
    if (res.status === 404) return null;
    throw new Error(`DefiLlama fees ${res.status} ${res.statusText} (${slug})`);
  }
  const raw = (await res.json()) as { totalDataChart?: unknown };
  const chart = Array.isArray(raw.totalDataChart) ? (raw.totalDataChart as ChartTuple[]) : [];

  const series: RevenuePoint[] = [];
  for (const point of chart) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const ts = point[0];
    const value = point[1];
    if (typeof ts !== "number" || typeof value !== "number" || !Number.isFinite(value)) continue;
    series.push({ time: ts * 1000, value });
  }
  // Tri ascendant garanti (le forward-fill côté contrôleur en dépend).
  series.sort((a, b) => a.time - b.time);
  return { slug, series };
}
