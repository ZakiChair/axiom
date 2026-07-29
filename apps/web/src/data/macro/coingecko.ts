/**
 * Fournisseur MACRO — capitalisation TOTALE du marché crypto (CoinGecko, tier gratuit).
 *
 * Endpoint (gratuit, fonctionne SANS clé) :
 *   GET https://api.coingecko.com/api/v3/global
 *   Doc        : https://docs.coingecko.com/reference/crypto-global
 *   Auth       : publique/keyless ; clé Demo OPTIONNELLE pour relever les quotas,
 *                via query `x_cg_demo_api_key` (ou header `x-cg-demo-api-key`).
 *                cf. https://docs.coingecko.com/reference/authentication
 *   Quotas Demo: 100 appels/min, 10 000 appels/mois.
 *   Base URL gratuite : https://api.coingecko.com/api/v3  (le `pro-api.*` est payant).
 *
 * Mesures (équivalent des indices TradingView CRYPTOCAP:TOTAL / TOTAL2 / TOTAL3,
 * reconstruits ici depuis `market_cap_percentage`) :
 *   - total  : capitalisation de toutes les cryptos.
 *   - total2 : hors BTC        = total × (1 − dominance_BTC).
 *   - total3 : hors BTC + ETH  = total × (1 − dominance_BTC − dominance_ETH).
 *
 * UNITÉ de `value` : USD absolu (ex. ~2.4e12).
 *
 * ⚠️ LIMITE DU GRATUIT : `/global` ne renvoie qu'un INSTANTANÉ courant, et l'AGRÉGAT
 * historique `/global/market_cap_chart` est réservé au tier Pro (401 error_code 10005).
 * `fetchSeries` renvoie donc UN SEUL point (l'instant présent).
 *
 * ✅ MAIS L'HISTORIQUE PAR PIÈCE EST GRATUIT (vérifié le 2026-07-29) :
 * `/coins/{id}/market_chart?vs_currency=usd&days=365&interval=daily` répond 200 avec
 * 366 points de `market_caps` sans aucune clé (au-delà de 365 jours : 401
 * error_code 10012). `data/mcap.ts` s'en sert pour RECONSTRUIRE la cap. totale par
 * somme du top 100 recalibrée sur `/global` (97,8 % de couverture mesurée), et
 * `store/macroHistory.seed` injecte cette année d'historique dans la série locale.
 * L'ancienne mention « aucun backfill possible en gratuit » qui figurait ici était
 * fausse et a induit en erreur : c'est l'agrégat qui est payant, pas les pièces.
 */
import type { IMacroProvider, MacroFetchOptions, MacroPoint, MacroSeries } from "./types";

const GLOBAL_URL = "https://api.coingecko.com/api/v3/global";
const DEMO_KEY_STORAGE = "axiom.coingecko.demoApiKey";

/** Mesure de capitalisation exposée par ce fournisseur. */
export type McapMeasure = "total" | "total2" | "total3";

/** Sous-ensemble utile de la réponse /global (champs typés explicitement). */
interface CoinGeckoGlobalResponse {
  data: {
    total_market_cap: { usd: number };
    market_cap_percentage: { btc: number; eth: number };
    updated_at: number; // secondes epoch
  };
}

/** Instantané dérivé de /global (les trois mesures en une requête). */
export interface GlobalMcapSnapshot {
  time: number; // ms epoch
  total: number; // USD
  total2: number; // USD (hors BTC)
  total3: number; // USD (hors BTC + ETH)
}

/** Lit la clé Demo OPTIONNELLE : param explicite > localStorage > absente. */
function resolveDemoKey(opts?: MacroFetchOptions): string | undefined {
  if (opts?.apiKey) return opts.apiKey;
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(DEMO_KEY_STORAGE) ?? undefined;
    }
  } catch {
    // Accès localStorage interdit (SSR, mode privé strict) — on ignore, l'endpoint
    // reste appelable sans clé.
  }
  return undefined;
}

/** Récupère l'instantané courant de capitalisation (total / total2 / total3). */
export async function fetchGlobalMcapSnapshot(
  opts?: MacroFetchOptions
): Promise<GlobalMcapSnapshot> {
  const key = resolveDemoKey(opts);
  const url = key ? `${GLOBAL_URL}?x_cg_demo_api_key=${encodeURIComponent(key)}` : GLOBAL_URL;

  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) {
    throw new Error(`CoinGecko /global ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as CoinGeckoGlobalResponse;
  const d = json.data;

  const total = d.total_market_cap.usd;
  const btcFrac = d.market_cap_percentage.btc / 100;
  const ethFrac = d.market_cap_percentage.eth / 100;
  return {
    time: d.updated_at * 1000,
    total,
    total2: total * (1 - btcFrac),
    total3: total * (1 - btcFrac - ethFrac),
  };
}

/**
 * Construit un fournisseur de capitalisation pour la `measure` donnée.
 * `fetchSeries` renvoie un UNIQUE point (instantané ; cf. limite gratuite ci-dessus).
 */
export function createCoinGeckoMcapProvider(measure: McapMeasure): IMacroProvider {
  return {
    id: `coingecko-${measure}`,
    async fetchSeries(opts?: MacroFetchOptions): Promise<MacroSeries> {
      const snap = await fetchGlobalMcapSnapshot(opts);
      const value =
        measure === "total" ? snap.total : measure === "total2" ? snap.total2 : snap.total3;
      const point: MacroPoint = { time: snap.time, value };
      return [point];
    },
  };
}

/** Capitalisation TOTALE du marché crypto (toutes cryptos). */
export const coinGeckoTotalProvider = createCoinGeckoMcapProvider("total");
/** Capitalisation hors BTC (TOTAL2). */
export const coinGeckoTotal2Provider = createCoinGeckoMcapProvider("total2");
/** Capitalisation hors BTC + ETH (TOTAL3). */
export const coinGeckoTotal3Provider = createCoinGeckoMcapProvider("total3");
