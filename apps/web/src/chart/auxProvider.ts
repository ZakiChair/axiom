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
 * Choix de clé : `(id, symbole)` suffit pour la plupart des séries — l'`exchange`
 * et le `timeframe` de la requête n'entrent PAS dans la clé. Les fetchs sous-jacents
 * ne dépendent pas de l'exchange (Coinalyze cible toujours le perp Binance ; Coin
 * Metrics/DefiLlama sont mono-source) ni du timeframe du graphe (granularité brute
 * fixée : "1hour" / quotidien) ; l'écart de timeframe est absorbé par `alignAux` à la
 * lecture. EXCEPTION : `perpDelta` est un FLUX (delta agresseur par bougie), pas un
 * niveau — il DOIT être fetché à l'interval du chart (un LOCF sur un flux fabrique un
 * flux faux). Sa clé intègre donc le timeframe (`perpDelta:${symbole}:${tf}`) ; les
 * séries de niveaux gardent la clé `(id, symbole)` inchangée.
 */
import { alignAux } from "@axiom/indicators";
import type { AuxSeries, AuxSeriesId, ExchangeId, Timeframe } from "@axiom/types";
import { coinalyzeProvider } from "../data/coinalyze";
import { stablecoinsSupplyProvider } from "../data/macro/stablecoins";
import { fetchCoinMetrics } from "../data/onchain/coinmetrics";
import {
  BG_ASOPR,
  BG_BALANCED_PRICE,
  BG_BTC_DOMINANCE,
  BG_CVDD,
  BG_LTH_SOPR,
  BG_MVRV,
  BG_NUPL,
  BG_PUELL,
  BG_REALIZED_PRICE,
  BG_RESERVE_RISK,
  BG_RHODL,
  BG_SOPR,
  BG_STH_SOPR,
  fetchBgeometricMetrique,
  type DefMetriqueBg,
} from "../data/onchain/bgeometrics";
import { fetchQuarterlyBasisHistory } from "../data/binanceDapi";
import { fetchLsAccountRatio, fetchLsTopTraderRatio, fetchTakerRatio } from "../data/positioning";
import { fetchFearGreedHistory } from "../data/marketOverview";
import { deltaDepuisKlinesPerp, timeframeToFapiInterval } from "../data/binanceFutures";
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
  perpDelta: 60_000, // delta agresseur perp par bougie (Binance fapi klines)
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
  mvrvZ: 60 * 60_000, // vrai MVRV Z-Score (realized-cap, bitcoin-data)
  realizedPrice: 60 * 60_000, // prix on-chain moyen (bitcoin-data)
  asopr: 60 * 60_000,
  sthSopr: 60 * 60_000,
  lthSopr: 60 * 60_000,
  rhodl: 60 * 60_000,
  cvdd: 60 * 60_000,
  balancedPrice: 60 * 60_000,
  btcDominance: 60 * 60_000, // dominance BTC globale (bitcoin-data)
  quarterlyBasis: 5 * 60_000, // basis future trimestriel (klines 1h Binance COIN-M)
  lsAccount: 5 * 60_000, // ratio comptes long/short (Binance futures)
  lsTopTrader: 5 * 60_000, // ratio positions top traders
  lsTaker: 5 * 60_000, // ratio taker acheteur/vendeur
  fearGreed: 60 * 60_000, // Fear & Greed global (Alternative.me, journalier)
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
 * Historique du delta agresseur perp par bougie via Binance fapi klines (proxy
 * /extapi). Fetché À L'INTERVAL DU CHART (`interval`, dérivé du timeframe courant) :
 * un flux ≠ un niveau — le fetcher en 1h fixe puis LOCF fabriquerait un flux faux
 * (delta horaire jeté en 1d, répété/cumulé en 1m). À interval identique, l'alignement
 * `alignAux` tombe 1:1 (mêmes openTime UTC pour les klines spot et perp Binance).
 * Pagination ARRIÈRE (via `endTime`, ≠ `fetchMarkPriceHistory` qui pagine en avant
 * mais reste épinglé à 1h) : le flux se lit près de `now`, donc on récupère les
 * bougies RÉCENTES d'abord. `startTime`-seul renverrait au contraire les plus VIEILLES
 * de la fenêtre → sur interval fin, le plafond de 3 pages n'atteindrait jamais `now`
 * et un LOCF fabriquerait un flux constant sur toute la vue récente. Parse via
 * `deltaDepuisKlinesPerp` (PURE, testée) : delta = 2 × takerBuyBase − volume.
 * 3 pages (limit 1500) : couvre 90 j en ≥30m ; en interval plus fin, couvre les ~4500
 * DERNIÈRES bougies (couverture partielle du début tolérée par l'ancrage commun du def).
 * Dégradation gracieuse propre à cette série (contrat Task 1) : pas de perp / symbole
 * non listé en futures / échec réseau → SÉRIE VIDE (jamais de throw ni d'état `error`),
 * de sorte que la jambe perp du def `cvdSpotPerp` disparaisse sans masquer le CVD spot.
 */
async function fetchPerpDeltaHistory(
  symbol: string,
  since: number,
  interval: string
): Promise<AuxPoint[]> {
  const sym = toFuturesSymbol(symbol);
  const out: AuxPoint[] = [];
  let endTime = Date.now();
  try {
    for (let page = 0; page < 3; page++) {
      const q = new URLSearchParams({
        symbol: sym,
        interval,
        endTime: String(endTime), // borne HAUTE : Binance rend les `limit` plus récentes ≤ endTime.
        limit: "1500",
      });
      const res = await fetch(extUrl("fapi.binance.com", `fapi/v1/klines?${q}`));
      if (!res.ok) break; // partiel OK ; symbole non listé / échec → vide.
      const raw: unknown = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) break;
      const points = deltaDepuisKlinesPerp(raw as unknown[][]);
      for (const p of points) out.push({ time: p.t, value: p.delta });
      const firstT = points.length > 0 ? points[0]?.t : undefined;
      if (firstT === undefined) break;
      if (firstT <= since) break; // début de la fenêtre 90 j atteint
      endTime = firstT - 1; // page suivante = bloc plus ancien, juste avant.
      if (raw.length < 1500) break;
    }
  } catch {
    // Réseau/CORS/blocage régional : jambe perp absente, dégradation → série vide.
    return [];
  }
  // Borne basse 90 j (les pages arrière peuvent déborder sous `since`) ; toPoints trie.
  return toPoints(out.filter((p) => p.time >= since));
}

/**
 * Récupère la série brute d'une famille auxiliaire pour un symbole, normalisée en
 * `AuxPoint[]` triés. Une exception (source injoignable) remonte → cache `error`.
 * `timeframe` n'est utilisé que par `perpDelta` (flux fetché à l'interval du chart) ;
 * les séries de niveaux gardent leur granularité brute fixe et l'ignorent.
 */
async function rawFetch(id: AuxSeriesId, symbol: string, timeframe: Timeframe): Promise<AuxPoint[]> {
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
    case "perpDelta": {
      // Delta agresseur perp par bougie (gratuit, fapi klines à l'interval du chart) —
      // jambe perp du CVD spot vs perp. Toujours ciblé Binance USDT-M. Timeframe non
      // supporté par fapi (sous-minute, 3M/6M/12M) → série vide ; échec/pas de perp → vide.
      const interval = timeframeToFapiInterval(timeframe);
      if (interval === undefined) return [];
      return fetchPerpDeltaHistory(symbol, since, interval);
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
    case "reserveRisk":
    case "mvrvZ":
    case "realizedPrice":
    case "asopr":
    case "sthSopr":
    case "lthSopr":
    case "rhodl":
    case "cvdd":
    case "balancedPrice": {
      // Métriques on-chain BTC (bitcoin-data.com). Réutilise le fetch dédié (cache 24h +
      // quota partagés avec OnchainWindow → aucun appel réseau dupliqué). BTC uniquement :
      // les autres actifs restent vides (dégradation gracieuse).
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
    case "lsAccount":
      return toPoints(await fetchLsAccountRatio(symbol));
    case "lsTopTrader":
      return toPoints(await fetchLsTopTraderRatio(symbol));
    case "lsTaker":
      return toPoints(await fetchTakerRatio(symbol));
    case "fearGreed":
      // Sentiment GLOBAL crypto (pas par actif) — même série pour tous les symboles.
      return toPoints(await fetchFearGreedHistory(120));
    case "btcDominance": {
      // Dominance BTC GLOBALE (non gatée sur l'actif) — pertinente sur tout chart.
      const r = await fetchBgeometricMetrique(BG_BTC_DOMINANCE);
      return toPoints((r?.serie.points ?? []).map((p) => ({ time: p.time, value: p.value })));
    }
  }
}

/** Aux id on-chain → définition BGeometrics correspondante. */
const BG_DEF_PAR_AUX: Record<
  | "nupl" | "puell" | "sopr" | "reserveRisk" | "mvrvZ" | "realizedPrice"
  | "asopr" | "sthSopr" | "lthSopr" | "rhodl" | "cvdd" | "balancedPrice",
  DefMetriqueBg
> = {
  nupl: BG_NUPL,
  puell: BG_PUELL,
  sopr: BG_SOPR,
  reserveRisk: BG_RESERVE_RISK,
  mvrvZ: BG_MVRV,
  realizedPrice: BG_REALIZED_PRICE,
  asopr: BG_ASOPR,
  sthSopr: BG_STH_SOPR,
  lthSopr: BG_LTH_SOPR,
  rhodl: BG_RHODL,
  cvdd: BG_CVDD,
  balancedPrice: BG_BALANCED_PRICE,
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
      // `perpDelta` est un flux fetché à l'interval du chart → sa clé intègre le
      // timeframe (sinon deux timeframes partageraient un flux faux). Niveaux inchangés.
      const key =
        id === "perpDelta" ? `${id}:${req.symbol}:${req.timeframe}` : `${id}:${req.symbol}`;
      let entry = this.cache.get(key);

      // Purge d'une entrée ready/error expirée → force un re-fetch au besoin.
      if (entry !== undefined && entry.state !== "pending" && entry.expires <= now) {
        this.cache.delete(key);
        entry = undefined;
      }

      if (entry === undefined) {
        this.startFetch(id, req.symbol, req.timeframe, key, onReady);
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
  private startFetch(
    id: AuxSeriesId,
    symbol: string,
    timeframe: Timeframe,
    key: string,
    onReady: () => void
  ): void {
    const entry: Entry = { state: "pending", onReadys: [onReady] };
    this.cache.set(key, entry);
    void rawFetch(id, symbol, timeframe).then(
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
