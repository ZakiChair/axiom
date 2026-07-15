/**
 * AuxProvider — fetch, alignement, cache et notification des séries AUXILIAIRES
 * (OI, funding, mark, stablecoins, NVT, MVRV) consommées par les indicateurs dérivés.
 *
 * Vit dans `apps/web` — la couche AUTORISÉE à fetcher — par opposition au moteur
 * `@axiom/indicators` qui reste pur/synchrone. L'AuxProvider récupère la donnée
 * brute puis rend à l'appelant des séries DÉJÀ alignées sur les bougies via
 * `alignAux` (contrat Task 11) ; le moteur ne fait, lui, jamais de réseau.
 *
 * Principes de cache :
 *   - le FETCH brut est mémoïsé par clé `(id, symbole)` avec TTL (60 s pour les
 *     dérivés OI/funding, 1 h pour les séries quotidiennes stablecoins/NVT/MVRV) ;
 *   - un échec de fetch est mémorisé 30 s (anti retry-tempête) ;
 *   - un seul fetch en vol par clé (SINGLE-FLIGHT) : les appels concurrents
 *     partagent la même promesse et sont tous notifiés à sa résolution ;
 *   - l'ALIGNEMENT (`alignAux`) est recalculé à CHAQUE `getAligned` car il dépend
 *     de `candleTimes` (propre à chaque graphe/appel) ; seul le fetch est mémoïsé.
 *
 * Choix de clé : `(id, symbole)` suffit — l'`exchange` et le `timeframe` de la
 * requête n'entrent PAS dans la clé. Les fetchs sous-jacents ne dépendent pas de
 * l'exchange (Coinalyze cible toujours le perp Binance ; Coin Metrics/DefiLlama
 * sont mono-source) ni du timeframe du graphe (granularité brute fixée : "1hour"
 * / quotidien) ; l'écart de timeframe est entièrement absorbé par `alignAux` à la
 * lecture. Inclure exchange/timeframe ne ferait que fragmenter le cache en
 * doublons identiques.
 */
import { alignAux } from "@axiom/indicators";
import type { AuxSeries, AuxSeriesId, ExchangeId, Timeframe } from "@axiom/types";
import { coinalyzeProvider } from "../data/coinalyze";
import { stablecoinsSupplyProvider } from "../data/macro/stablecoins";
import { fetchCoinMetrics } from "../data/onchain/coinmetrics";
import {
  BG_NUPL,
  BG_PUELL,
  BG_RESERVE_RISK,
  BG_SOPR,
  fetchBgeometricMetrique,
  type DefMetriqueBg,
} from "../data/onchain/bgeometrics";
import { fetchQuarterlyBasisHistory } from "../data/binanceDapi";
import { extUrl } from "../data/extapi";

/** État renvoyé par `getAligned` pour l'ensemble des `ids` demandés. */
export type AuxStatus =
  | { status: "ready"; aux: AuxSeries }
  | { status: "pending" }
  | { status: "error"; message: string };

/** Requête d'alignement d'un lot de séries auxiliaires sur un jeu de bougies. */
export interface AuxRequest {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  ids: AuxSeriesId[];
  candleTimes: number[];
}

/** Point brut prêt pour `alignAux` (time ms epoch, croissant). */
interface AuxPoint {
  time: number;
  value: number;
}

/** TTL du cache BRUT par série (ms). */
const TTL_MS: Record<AuxSeriesId, number> = {
  oi: 60_000,
  funding: 60_000,
  mark: 60_000, // mark price perp (Binance fapi markPriceKlines)
  stablecoins: 60 * 60_000,
  nvt: 60 * 60_000,
  mvrv: 60 * 60_000,
  marketcap: 60 * 60_000, // CapMrktCurUSD (Coin Metrics, journalier — BTC only en community)
  // Cycle on-chain BTC (bitcoin-data.com, journalier) : le vrai anti-tempête est le
  // cache 24h + quota interne de fetchBgeometricMetrique ; ce TTL aux évite juste des
  // ré-alignements trop fréquents.
  nupl: 60 * 60_000,
  puell: 60 * 60_000,
  sopr: 60 * 60_000,
  reserveRisk: 60 * 60_000,
  quarterlyBasis: 5 * 60_000, // basis future trimestriel (klines 1h Binance COIN-M)
};
/** Durée de mémorisation d'un échec de fetch (anti retry-tempête). */
const ERROR_TTL_MS = 30_000;
/** Profondeur d'historique demandée aux fournisseurs (90 jours). */
const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
/** Intervalle d'agrégation Coinalyze pour OI/funding (cf. COINALYZE_INTERVALS). */
const COINALYZE_INTERVAL = "1hour";

/** Entrée de cache pour une clé `(id, symbole)`. */
type Entry =
  | { state: "pending"; onReadys: Array<() => void> }
  | { state: "ready"; points: AuxPoint[]; expires: number }
  | { state: "error"; message: string; expires: number };

/** Nettoie une série brute pour `alignAux` : écarte le non-fini, trie par time croissant. */
function toPoints(raw: AuxPoint[]): AuxPoint[] {
  return raw
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
}

/**
 * Dérive l'asset Coin Metrics d'un symbole de trading (BTCUSDT→btc) : retire le
 * quote courant et minusculise la base. ⚠️ Coin Metrics community ne couvre en
 * pratique que BTC (cf. `coinmetrics.ts`) → les autres assets rendent des séries
 * vides (dégradation gracieuse, jamais d'erreur).
 */
function symbolToAsset(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const base = s.replace(/(USDT|USDC|FDUSD|BUSD|USD)$/, "");
  return (base.length > 0 ? base : s).toLowerCase();
}

/** Symbole fapi (perp USDT) à partir d'un symbole chart (BTCUSDT, BTCUSDT_PERP…). */
function toFuturesSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/_PERP$/i, "").replace(/PERP$/i, "");
}

/**
 * Historique mark price 1h via Binance fapi (proxy /extapi). Paginé (limit 1500).
 * PURE côté parse ; réseau dans cette fonction uniquement (couche web autorisée).
 */
async function fetchMarkPriceHistory(symbol: string, since: number): Promise<AuxPoint[]> {
  const sym = toFuturesSymbol(symbol);
  const out: AuxPoint[] = [];
  let startTime = since;
  const now = Date.now();
  // Max ~2 pages pour 90 j × 1h (~2160 barres, plafond API 1500/req).
  for (let page = 0; page < 3 && startTime < now; page++) {
    const q = new URLSearchParams({
      symbol: sym,
      interval: "1h",
      startTime: String(startTime),
      limit: "1500",
    });
    const res = await fetch(extUrl("fapi.binance.com", `fapi/v1/markPriceKlines?${q}`));
    if (!res.ok) {
      if (out.length > 0) break; // partiel OK
      throw new Error(`markPriceKlines HTTP ${res.status}`);
    }
    const raw: unknown = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    let lastT = startTime;
    for (const row of raw) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const t = Number(row[0]);
      const close = Number(row[4]); // close = mark à la fin de la bougie
      if (!Number.isFinite(t) || !Number.isFinite(close)) continue;
      out.push({ time: t, value: close });
      lastT = t;
    }
    // Page suivante : juste après la dernière bougie reçue.
    startTime = lastT + 1;
    if (raw.length < 1500) break;
  }
  return toPoints(out);
}

/**
 * Récupère la série brute d'une famille auxiliaire pour un symbole, normalisée en
 * `AuxPoint[]` triés. Une exception (source injoignable) remonte → cache `error`.
 */
async function rawFetch(id: AuxSeriesId, symbol: string): Promise<AuxPoint[]> {
  const since = Date.now() - LOOKBACK_MS;
  switch (id) {
    case "oi": {
      const h = await coinalyzeProvider.fetchOpenInterestHistory(symbol, COINALYZE_INTERVAL, since);
      return toPoints(h.map((o) => ({ time: o.time, value: o.oiUsd })));
    }
    case "funding": {
      const h = await coinalyzeProvider.fetchFundingRateHistory(symbol, COINALYZE_INTERVAL, since);
      return toPoints(h.map((f) => ({ time: f.time, value: f.rate })));
    }
    case "mark": {
      // Mark price perp Binance (gratuit, fapi markPriceKlines 1h) — pour basis spot-perp.
      return fetchMarkPriceHistory(symbol, since);
    }
    case "stablecoins": {
      const s = await stablecoinsSupplyProvider.fetchSeries({ start: since });
      return toPoints(s.map((p) => ({ time: p.time, value: p.value })));
    }
    case "nvt":
    case "mvrv": {
      // NVT = NVTAdj, MVRV = CapMVRVCur (métriques Coin Metrics). ⚠️ NVTAdj n'est PAS
      // servie par le tier community (cf. coinmetrics.ts) → série vide tant que la
      // liste CM_METRIQUES ne l'inclut pas ; l'alignement reste gracieux (undefined).
      const metric = id === "mvrv" ? "CapMVRVCur" : "NVTAdj";
      const r = await fetchCoinMetrics(symbolToAsset(symbol));
      const serie = r?.series[metric];
      return toPoints((serie?.points ?? []).map((p) => ({ time: p.time, value: p.value })));
    }
    case "marketcap": {
      // Capitalisation USD (CapMrktCurUSD) — déjà dans CM_METRIQUES. BTC only en community.
      const r = await fetchCoinMetrics(symbolToAsset(symbol));
      const serie = r?.series.CapMrktCurUSD;
      return toPoints((serie?.points ?? []).map((p) => ({ time: p.time, value: p.value })));
    }
    case "nupl":
    case "puell":
    case "sopr":
    case "reserveRisk": {
      // Métriques de cycle on-chain BTC (bitcoin-data.com). Réutilise le fetch dédié
      // (cache 24h + quota partagés avec OnchainWindow → aucun appel réseau dupliqué).
      // BTC uniquement : les autres actifs restent vides (dégradation gracieuse).
      if (symbolToAsset(symbol) !== "btc") return [];
      const def = BG_DEF_PAR_AUX[id];
      const r = await fetchBgeometricMetrique(def);
      return toPoints((r?.serie.points ?? []).map((p) => ({ time: p.time, value: p.value })));
    }
    case "quarterlyBasis": {
      // Basis annualisé du future trimestriel courant — BTC/ETH uniquement (COIN-M).
      const asset = symbolToAsset(symbol);
      if (asset !== "btc" && asset !== "eth") return [];
      const pts = await fetchQuarterlyBasisHistory(asset === "btc" ? "BTC" : "ETH", since);
      return toPoints(pts);
    }
  }
}

/** Aux id de cycle on-chain → définition BGeometrics correspondante. */
const BG_DEF_PAR_AUX: Record<"nupl" | "puell" | "sopr" | "reserveRisk", DefMetriqueBg> = {
  nupl: BG_NUPL,
  puell: BG_PUELL,
  sopr: BG_SOPR,
  reserveRisk: BG_RESERVE_RISK,
};

export class AuxProvider {
  /** Cache brut partagé (singleton) : clé `${id}:${symbole}` → entrée. */
  private readonly cache = new Map<string, Entry>();

  /**
   * Retourne l'état courant des `ids` demandés, alignés sur `candleTimes`. Déclenche
   * les fetchs manquants/expirés et rappelle `onReady` quand ils aboutissent.
   * Précédence de l'état global : `error` (≥ 1 série en échec) > `pending` (≥ 1 en
   * vol) > `ready` (toutes prêtes).
   */
  getAligned(req: AuxRequest, onReady: () => void): AuxStatus {
    const now = Date.now();
    const aux: AuxSeries = {};
    let errorMessage: string | undefined;
    let pending = false;

    for (const id of req.ids) {
      const key = `${id}:${req.symbol}`;
      let entry = this.cache.get(key);

      // Purge d'une entrée ready/error expirée → force un re-fetch au besoin.
      if (entry !== undefined && entry.state !== "pending" && entry.expires <= now) {
        this.cache.delete(key);
        entry = undefined;
      }

      if (entry === undefined) {
        this.startFetch(id, req.symbol, key, onReady);
        pending = true;
        continue;
      }
      if (entry.state === "pending") {
        entry.onReadys.push(onReady); // rejoint le fetch en vol (single-flight).
        pending = true;
        continue;
      }
      if (entry.state === "error") {
        errorMessage = entry.message;
        continue;
      }
      aux[id] = alignAux(req.candleTimes, entry.points);
    }

    if (errorMessage !== undefined) return { status: "error", message: errorMessage };
    if (pending) return { status: "pending" };
    return { status: "ready", aux };
  }

  /** Lance un unique fetch pour `key` et notifie tous les `onReady` à sa résolution. */
  private startFetch(id: AuxSeriesId, symbol: string, key: string, onReady: () => void): void {
    const entry: Entry = { state: "pending", onReadys: [onReady] };
    this.cache.set(key, entry);
    void rawFetch(id, symbol).then(
      (points) => {
        this.cache.set(key, { state: "ready", points, expires: Date.now() + TTL_MS[id] });
        for (const cb of entry.onReadys) cb();
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : "échec du fetch auxiliaire";
        this.cache.set(key, { state: "error", message, expires: Date.now() + ERROR_TTL_MS });
        for (const cb of entry.onReadys) cb();
      }
    );
  }
}

/** Singleton module : cache brut partagé entre tous les slots/graphes. */
export const auxProvider = new AuxProvider();
