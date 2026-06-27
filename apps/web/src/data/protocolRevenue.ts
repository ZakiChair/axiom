/**
 * Revenus on-chain du PROTOCOLE sous-jacent à l'actif analysé — DefiLlama (gratuit, sans clé).
 *
 * « Revenus » = la part des frais conservée par le protocole (dataType=dailyRevenue),
 * série JOURNALIÈRE. Endpoints (gratuits, sans clé — cf. stablecoins.ts) :
 *   - résolution slug : GET https://api.llama.fi/overview/fees?excludeTotalDataChart=true
 *       → { protocols: [{ name, slug?, symbol? , ... }] }
 *   - série          : GET https://api.llama.fi/summary/fees/{slug}?dataType=dailyRevenue
 *       → { name, totalDataChart: [[tsSeconds, value], ...] }
 *   Doc : https://api-docs.defillama.com/  (section « fees and revenue »)
 *
 * Pertinence : n'a de sens que pour les actifs qui SONT des protocoles à revenus
 * (UNI, AAVE, GMX, LDO, MKR…). Pour BTC/ETH/SOL (chaînes L1, pas des protocoles au
 * sens DefiLlama « fees ») ou un token sans données : dégradation propre → `null`.
 *
 * Stratégie de résolution symbole → slug DefiLlama (robuste + dégradée) :
 *   1. table curée (slugs sûrs) ;
 *   2. à défaut, résolution dynamique via la liste `overview/fees` (parse défensif,
 *      jamais bloquant) en faisant correspondre le ticker du token ;
 *   3. à défaut → `null` (« revenus indisponibles pour cet actif »).
 */

/** Un point de la série de revenus : ms epoch + revenu du jour en USD. */
export interface RevenuePoint {
  time: number;
  value: number;
}

const OVERVIEW_URL =
  "https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true";
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
  COMP: "compound",
  BAL: "balancer",
  RPL: "rocket-pool",
  FXS: "frax",
  CVX: "convex-finance",
  GNS: "gains-network",
  JOE: "trader-joe",
  VELO: "velodrome",
  AERO: "aerodrome",
};

/** Isole le ticker du token (« UNIUSDT » → « UNI »). */
export function baseTicker(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  for (const q of QUOTE_SUFFIXES) {
    if (s.length > q.length && s.endsWith(q)) return s.slice(0, -q.length);
  }
  return s;
}

/** Slugify de repli (« Rocket Pool » → « rocket-pool ») pour le parse de l'overview. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Cache mémoire (session) de la résolution dynamique ticker → slug via l'overview. */
let overviewIndex: Map<string, string> | null = null;
let overviewPromise: Promise<Map<string, string>> | null = null;

/** Construit (une fois) l'index ticker → slug depuis la liste DefiLlama. Parse DÉFENSIF. */
async function loadOverviewIndex(signal?: AbortSignal): Promise<Map<string, string>> {
  if (overviewIndex) return overviewIndex;
  if (!overviewPromise) {
    overviewPromise = (async () => {
      const index = new Map<string, string>();
      try {
        const res = await fetch(OVERVIEW_URL, { signal });
        if (res.ok) {
          const raw = (await res.json()) as { protocols?: unknown };
          const list = Array.isArray(raw.protocols) ? raw.protocols : [];
          for (const item of list) {
            if (typeof item !== "object" || item === null) continue;
            const p = item as { name?: unknown; slug?: unknown; symbol?: unknown };
            const symbol = typeof p.symbol === "string" ? p.symbol.toUpperCase() : "";
            const slug =
              typeof p.slug === "string" && p.slug.length > 0
                ? p.slug
                : typeof p.name === "string"
                  ? slugify(p.name)
                  : "";
            // « - » est le symbole DefiLlama pour « pas de token » : on l'ignore.
            if (symbol && symbol !== "-" && slug && !index.has(symbol)) {
              index.set(symbol, slug);
            }
          }
        }
      } catch {
        // Réseau/format KO : index vide → on retombera sur la table curée uniquement.
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
export async function resolveProtocolSlug(
  symbol: string,
  signal?: AbortSignal
): Promise<string | null> {
  const base = baseTicker(symbol);
  const curated = TOKEN_TO_PROTOCOL[base];
  if (curated) return curated;
  const index = await loadOverviewIndex(signal);
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
  const slug = await resolveProtocolSlug(symbol, signal);
  if (!slug) return null;

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
