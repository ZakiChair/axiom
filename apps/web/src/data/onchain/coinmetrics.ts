/**
 * Coin Metrics Community v4 — métriques on-chain GRATUITES (sans clé).
 *
 * Endpoint (gratuit, keyless, CORS `*` → appel DIRECT, pas de proxy) :
 *   GET https://community-api.coinmetrics.io/v4/timeseries/asset-metrics
 *       ?assets=btc&metrics=<liste>&frequency=1d&page_size=<n>&start_time=<YYYY-MM-DD>
 *   Doc   : https://docs.coinmetrics.io/api/v4
 *   Débit : ~10 req / 6 s (community). Données JOURNALIÈRES → cache 6 h suffisant.
 *
 * ⚠️ MÉTRIQUES DISPONIBLES EN COMMUNITY (vérifiées en réel le 2026-07-02) :
 *   AdrActCnt, TxCnt, FeeTotNtv, CapMrktCurUSD, CapMVRVCur, HashRate, PriceUSD.
 *   Les métriques demandées à l'origine FeeTotUSD / CapRealUSD / NVTAdj renvoient un
 *   403 « not available with supplied credentials » sur le tier community → REMPLACÉES
 *   par leurs équivalents gratuits (FeeTotNtv en BTC, CapMVRVCur = ratio MVRV courant).
 *   ⚠️ ETH : la plupart de ces métriques sont `null` en community (couverture BTC only) ;
 *   le parseur ignore proprement les valeurs nulles → l'UI affiche « — ».
 *
 * FORME DE RÉPONSE :
 *   { data: [ { asset, time: "<ISO>", <Metric>: "<nombre|null>", … }, … ] }
 *   Les valeurs sont des CHAÎNES (ou `null` pour le dernier jour non finalisé).
 */
import { ecrireCache, estFrais, lireCache } from "./cache";
import { healthStore } from "../../store/health";

/** Hôte community (CORS ouvert). */
const BASE = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics";
/** Source santé affichée dans le panneau « santé des sources ». */
const SOURCE_SANTE = "coinmetrics";
/** TTL de cache (6 h — données daily). */
export const CM_TTL_MS = 6 * 60 * 60 * 1000;
/** Profondeur d'historique demandée (jours) → alimente les sparklines. */
const FENETRE_JOURS = 200;

/** Métriques community récupérées (ordre indifférent ; hashrate vient de mempool.space). */
export const CM_METRIQUES = [
  "AdrActCnt", // adresses actives / jour
  "TxCnt", // transactions / jour
  "FeeTotNtv", // frais totaux (BTC natif)
  "CapMrktCurUSD", // capitalisation (USD)
  "CapMVRVCur", // ratio MVRV courant
] as const;

/** Un point daté d'une métrique. */
export interface PointMetrique {
  time: number; // ms epoch
  value: number;
}

/** Série d'une métrique : points triés + dernier point fini (pour la valeur affichée). */
export interface SerieMetrique {
  points: PointMetrique[];
  dernier?: PointMetrique;
}

/** Résultat parsé : une série par métrique (clé = nom Coin Metrics). */
export type CoinMetricsParse = Record<string, SerieMetrique>;

/** Résultat d'un fetch : les séries + fraîcheur + horodatage de la donnée. */
export interface CoinMetricsResultat {
  series: CoinMetricsParse;
  /** ms epoch de l'écriture en cache de ces données. */
  ts: number;
  /** true si servi depuis un cache PÉRIMÉ (source momentanément injoignable). */
  perime: boolean;
}

/** Ligne brute (asset + time + métriques sous forme de chaînes/nulles). */
interface LigneBrute {
  asset?: string;
  time?: string;
  [metrique: string]: unknown;
}

/**
 * Parse une réponse Coin Metrics en séries par métrique, pour un `asset` donné.
 * PURE et tolérante : ignore les valeurs `null` / non finies / non numériques, et le
 * dernier jour incomplet. Le `dernier` de chaque série est le point fini le plus récent.
 */
export function parseCoinMetrics(
  json: unknown,
  asset: string,
  metriques: readonly string[] = CM_METRIQUES,
): CoinMetricsParse {
  const out: CoinMetricsParse = {};
  for (const m of metriques) out[m] = { points: [] };

  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;

  for (const ligneInconnue of data) {
    const ligne = ligneInconnue as LigneBrute;
    if (ligne.asset !== undefined && ligne.asset !== asset) continue;
    const time = ligne.time !== undefined ? Date.parse(ligne.time) : NaN;
    if (!Number.isFinite(time)) continue;

    for (const m of metriques) {
      const brut = ligne[m];
      if (brut === null || brut === undefined) continue;
      const value = typeof brut === "number" ? brut : Number(brut);
      if (!Number.isFinite(value)) continue;
      out[m]?.points.push({ time, value });
    }
  }

  // Tri chronologique + dernier point fini.
  for (const m of metriques) {
    const serie = out[m];
    if (serie === undefined) continue;
    serie.points.sort((a, b) => a.time - b.time);
    serie.dernier = serie.points.length > 0 ? serie.points[serie.points.length - 1] : undefined;
  }
  return out;
}

/** Construit l'URL de requête (asset unique + fenêtre historique). */
function construireUrl(asset: string): string {
  const debut = new Date(Date.now() - FENETRE_JOURS * 86_400_000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    assets: asset,
    metrics: CM_METRIQUES.join(","),
    frequency: "1d",
    page_size: "1000",
    start_time: debut,
  });
  return `${BASE}?${params.toString()}`;
}

/**
 * Récupère les métriques on-chain Coin Metrics pour `asset` (défaut BTC), avec cache 6 h
 * et dégradation gracieuse : si le réseau échoue, RESERT le dernier cache (même périmé)
 * étiqueté `perime:true` ; renvoie `null` seulement si aucune donnée n'est disponible.
 */
export async function fetchCoinMetrics(
  asset = "btc",
  signal?: AbortSignal,
): Promise<CoinMetricsResultat | null> {
  const cle = `cm:${asset}`;
  const cache = await lireCache<CoinMetricsParse>(cle);
  if (estFrais(cache, CM_TTL_MS) && cache !== null) {
    return { series: cache.donnee, ts: cache.ts, perime: false };
  }

  try {
    const res = await fetch(construireUrl(asset), { signal });
    if (!res.ok) throw new Error(`Coin Metrics ${res.status}`);
    const json = (await res.json()) as unknown;
    const series = parseCoinMetrics(json, asset);
    await ecrireCache(cle, series);
    healthStore.getState().setEtat(SOURCE_SANTE, "polling", { dernierMessageTs: Date.now() });
    return { series, ts: Date.now(), perime: false };
  } catch (e) {
    if (signal?.aborted) return cache ? { series: cache.donnee, ts: cache.ts, perime: true } : null;
    healthStore.getState().marquerErreur(SOURCE_SANTE, e instanceof Error ? e.message : "échec");
    // Dégradation : on ressert le dernier cache connu, même périmé.
    if (cache !== null) return { series: cache.donnee, ts: cache.ts, perime: true };
    return null;
  }
}
