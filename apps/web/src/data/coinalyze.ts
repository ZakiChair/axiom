/**
 * Fournisseur de données DÉRIVÉES — Coinalyze (tier GRATUIT), implémente
 * IDerivedDataProvider (@axiom/types). M6 « ACHETER » plutôt que construire un
 * AggregationEngine multi-exchange (cf. BUILD-CONTRACT).
 *
 * - REST : https://api.coinalyze.net/v1/ ; authentification par `api_key` (accepté
 *   en query param, cf. recherche §1). La clé PERSONNELLE (Réglages) part en query ;
 *   sans clé personnelle, le proxy /coinalyzeapi injecte la clé de repli (.env),
 *   jamais committée dans le source ni le bundle (cf. vite.config.ts).
 * - Débit : 40 requêtes / minute / clé → throttle à fenêtre glissante (ci-dessous).
 * - Symboles : un perpétuel Binance USDⓈ-M « BTCUSDT » s'écrit « BTCUSDT_PERP.A »
 *   côté Coinalyze (code exchange `.A` = Binance, confirmé via /exchanges et
 *   /future-markets de l'API).
 *
 * Limites assumées du gratuit (cf. recherche §1) : latence ~1 min, historique
 * intraday court (~1500–2000 pts purgés/jour). Les LIQUIDATIONS sont AGRÉGÉES
 * par intervalle (volume long/short cumulé) — pas d'événements unitaires ni de
 * prix : « échantillonnées / cumul approx. » (cf. critique §4 forceOrder throttle).
 */
import type {
  FundingRate,
  IDerivedDataProvider,
  Liquidation,
  LongShortRatio,
  OpenInterest,
} from "@axiom/types";
import { healthStore } from "../store/health";

// Base SAME-ORIGIN via le proxy de dev Vite (cf. vite.config.ts). L'appel direct
// à https://api.coinalyze.net/v1/ est bloqué par le navigateur (aucun en-tête CORS).
const BASE_URL = "/coinalyzeapi/v1/";

/** Intervalles d'agrégation acceptés par les endpoints `*-history` de Coinalyze. */
const COINALYZE_INTERVALS = [
  "1min",
  "5min",
  "15min",
  "30min",
  "1hour",
  "2hour",
  "4hour",
  "6hour",
  "12hour",
  "daily",
] as const;
type CoinalyzeInterval = (typeof COINALYZE_INTERVALS)[number];

/** Fenêtre glissante de débit : au plus 40 requêtes / 60 s (1 symbole par appel → poids 1). */
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 60_000;

/** Fenêtre d'historique pour récupérer le DERNIER point de long/short ratio. */
const LS_WINDOW_SECONDS = 2 * 24 * 60 * 60; // 48 h : garantit ≥ 1 point même en `daily`.
/** Intervalle d'agrégation des liquidations récentes. */
const LIQ_INTERVAL: CoinalyzeInterval = "5min";

// ---------- Clé API (injectée par le store, jamais loggée) ----------

let apiKey: string | null = null;

/** Injecte/retire la clé PERSONNELLE utilisée par le provider (appelée par le store de réglages). */
export function setCoinalyzeApiKey(key: string | null): void {
  apiKey = key !== null && key.length > 0 ? key : null;
}

/** Erreur HTTP Coinalyze (statut exposé pour distinguer 401 = clé refusée). */
export class CoinalyzeError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) {
    super(`Coinalyze ${status} ${statusText}`);
    this.name = "CoinalyzeError";
    this.status = status;
  }
}

// ---------- Throttle (fenêtre glissante, acquisitions sérialisées) ----------

const requestTimes: number[] = [];
let throttleChain: Promise<void> = Promise.resolve();

/** Identifiant de source du registre santé (panneau « Santé sources »). */
const HEALTH_SOURCE = "coinalyze";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Publie la consommation courante du débit (fenêtre glissante 40/60 s) dans le registre
 * santé, à chaque créneau acquis. `requestTimes.length` = requêtes dans la fenêtre après
 * purge/ajout. N'affecte pas les données renvoyées (best-effort, jamais bloquant).
 */
function reportQuota(): void {
  healthStore.getState().setQuota(HEALTH_SOURCE, {
    utilise: requestTimes.length,
    limite: RATE_LIMIT,
    fenetre: "1min",
  });
}

/**
 * Acquiert un créneau de débit. Les acquisitions sont sérialisées (chaîne de
 * promesses) pour éviter les courses ; une requête est mise en attente tant que
 * 40 appels ont déjà eu lieu dans la fenêtre de 60 s glissante.
 */
function acquireSlot(): Promise<void> {
  const run = throttleChain.then(async () => {
    for (;;) {
      const now = Date.now();
      // Purge les horodatages sortis de la fenêtre.
      while (requestTimes.length > 0) {
        const oldest = requestTimes[0];
        if (oldest === undefined || now - oldest < RATE_WINDOW_MS) break;
        requestTimes.shift();
      }
      if (requestTimes.length < RATE_LIMIT) {
        requestTimes.push(now);
        reportQuota();
        return;
      }
      const oldest = requestTimes[0];
      const wait = oldest === undefined ? RATE_WINDOW_MS : RATE_WINDOW_MS - (now - oldest);
      await sleep(Math.max(wait, 0));
    }
  });
  // La chaîne suivante attend la fin de cette acquisition (sans propager l'erreur).
  throttleChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ---------- Requête REST ----------

/**
 * GET authentifié + throttlé. La clé PERSONNELLE part en query param `api_key` : le
 * proxy détecte alors sa présence et n'injecte PAS la clé de repli (.env) → override
 * utilisateur prioritaire. Sans clé personnelle, on n'envoie RIEN et le proxy injecte
 * le repli. On ne logge jamais la clé : seul le statut HTTP est rapporté en cas d'erreur.
 */
async function request<T>(path: string, params: Record<string, string>): Promise<T> {
  await acquireSlot();

  const search = new URLSearchParams(params);
  if (apiKey !== null) search.set("api_key", apiKey);
  const url = `${BASE_URL}${path}?${search.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new CoinalyzeError(res.status, res.statusText);
  return (await res.json()) as T;
}

// ---------- Mapping symbole & horodatages ----------

/**
 * Mappe un symbole Binance (spot, ex. « BTCUSDT ») vers l'identifiant Coinalyze
 * du perpétuel Binance USDⓈ-M correspondant : suffixe `_PERP.A` (`.A` = Binance).
 * Si l'entrée est déjà un identifiant Coinalyze (contient un `.`), on la renvoie
 * inchangée.
 */
export function toCoinalyzeSymbol(binanceSymbol: string): string {
  const s = binanceSymbol.trim().toUpperCase();
  if (s.includes(".")) return s;
  return `${s}_PERP.A`;
}

/**
 * Normalise un horodatage Coinalyze en ms epoch. L'API mêle les unités selon
 * l'endpoint (`update` des endpoints « current » est en ms, le `t` des
 * historiques est en secondes) → on détecte l'échelle comme leur wrapper officiel.
 */
function toMs(ts: number): number {
  return ts > 1e12 ? ts : ts * 1000;
}

/**
 * Coinalyze exprime le funding rate en POURCENTAGE (ex. 0.007538 = 0.007538 %),
 * là où la convention Binance ET le reste du code (cf. data/screener.ts) est une
 * FRACTION (0.00007538). On NORMALISE en fraction À LA SOURCE pour que
 * `FundingRate.rate` ait une unité cohérente partout — l'UI applique ×100 à
 * l'affichage. Vérifié en réel : predicted 0.007538 % ↔ Binance lastFundingRate
 * 0.00007538 (rapport ×100 exact).
 */
function pctToFraction(pct: number): number {
  return pct / 100;
}

/** Valide la période demandée comme intervalle Coinalyze (repli « 5min »). */
function normalizeInterval(period: string): CoinalyzeInterval {
  return (COINALYZE_INTERVALS as readonly string[]).includes(period)
    ? (period as CoinalyzeInterval)
    : "5min";
}

// ---------- Formes de réponse Coinalyze ----------

/** Endpoints « current » : open-interest, funding-rate, predicted-funding-rate. */
interface CurrentPoint {
  symbol: string;
  value: number;
  update: number; // ms epoch
}

interface HistoryResponse<P> {
  symbol: string;
  history: P[];
}

/** Point d'historique long/short ratio : r = ratio, l = long %, s = short %. */
interface LsHistoryPoint {
  t: number;
  r: number;
  l: number;
  s: number;
}

/** Point d'historique liquidations : l = volume long, s = volume short (cumulés par intervalle). */
interface LiqHistoryPoint {
  t: number;
  l: number;
  s: number;
}

/** Point d'historique OHLC (open-interest-history, funding-rate-history) : agrégat par intervalle. */
interface OhlcHistoryPoint {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

// ---------- Méthodes du provider ----------

async function fetchOpenInterest(symbol: string): Promise<OpenInterest> {
  const cs = toCoinalyzeSymbol(symbol);
  // Deux appels : valeur native (contrats/base) + valeur convertie en USD.
  const [base, usd] = await Promise.all([
    request<CurrentPoint[]>("open-interest", { symbols: cs }),
    request<CurrentPoint[]>("open-interest", { symbols: cs, convert_to_usd: "true" }),
  ]);
  const b = base[0];
  const u = usd[0];
  if (b === undefined && u === undefined) {
    throw new CoinalyzeError(404, `Aucun open interest pour ${cs}`);
  }
  return {
    time: toMs(b?.update ?? u?.update ?? Date.now()),
    symbol: cs,
    oi: b?.value ?? NaN,
    oiUsd: u?.value ?? NaN,
  };
}

async function fetchFundingRate(symbol: string): Promise<FundingRate> {
  const cs = toCoinalyzeSymbol(symbol);
  const res = await request<CurrentPoint[]>("funding-rate", { symbols: cs });
  const p = res[0];
  if (p === undefined) throw new CoinalyzeError(404, `Aucun funding pour ${cs}`);
  return {
    time: toMs(p.update),
    symbol: cs,
    rate: pctToFraction(p.value), // Coinalyze % → fraction (cf. pctToFraction).
    // Coinalyze (current funding-rate) n'expose ni mark price ni heure du
    // prochain funding → champs inconnus.
    nextFundingTime: 0,
    markPrice: NaN,
  };
}

async function fetchLongShortRatio(symbol: string, period: string): Promise<LongShortRatio> {
  const cs = toCoinalyzeSymbol(symbol);
  const interval = normalizeInterval(period);
  const to = Math.floor(Date.now() / 1000);
  const from = to - LS_WINDOW_SECONDS;
  const res = await request<HistoryResponse<LsHistoryPoint>[]>("long-short-ratio-history", {
    symbols: cs,
    interval,
    from: String(from),
    to: String(to),
  });
  const series = res[0];
  if (series === undefined || series.history.length === 0) {
    throw new CoinalyzeError(404, `Aucun long/short pour ${cs}`);
  }
  const last = series.history[series.history.length - 1];
  if (last === undefined) throw new CoinalyzeError(404, `Aucun long/short pour ${cs}`);
  return {
    time: toMs(last.t),
    symbol: cs,
    longAccount: last.l,
    shortAccount: last.s,
    ratio: last.r,
    // Ratio agrégé par Coinalyze depuis les données du compte de l'exchange.
    type: "account",
  };
}

async function fetchLiquidations(symbol: string, sinceMs: number): Promise<Liquidation[]> {
  const cs = toCoinalyzeSymbol(symbol);
  const to = Math.floor(Date.now() / 1000);
  const from = Math.floor(sinceMs / 1000);
  const res = await request<HistoryResponse<LiqHistoryPoint>[]>("liquidation-history", {
    symbols: cs,
    interval: LIQ_INTERVAL,
    from: String(from),
    to: String(to),
    convert_to_usd: "true", // volume long/short en USD → qtyUsd.
  });
  const series = res[0];
  if (series === undefined) return [];

  const out: Liquidation[] = [];
  for (const pt of series.history) {
    const time = toMs(pt.t);
    // Coinalyze agrège les liquidations par intervalle (volume cumulé) : pas
    // d'événements unitaires ni de prix → price/qty inconnus (NaN).
    if (pt.l > 0) out.push({ time, symbol: cs, side: "long", price: NaN, qty: NaN, qtyUsd: pt.l });
    if (pt.s > 0) out.push({ time, symbol: cs, side: "short", price: NaN, qty: NaN, qtyUsd: pt.s });
  }
  return out;
}

/**
 * Historique Open Interest (USD), agrégé par intervalle (clôture de chaque bucket
 * retenue comme valeur représentative — cf. /open-interest-history, même forme
 * OHLC que funding-rate-history).
 */
async function fetchOpenInterestHistory(
  symbol: string,
  period: string,
  sinceMs: number
): Promise<OpenInterest[]> {
  const cs = toCoinalyzeSymbol(symbol);
  const interval = normalizeInterval(period);
  const to = Math.floor(Date.now() / 1000);
  const from = Math.floor(sinceMs / 1000);
  const res = await request<HistoryResponse<OhlcHistoryPoint>[]>("open-interest-history", {
    symbols: cs,
    interval,
    from: String(from),
    to: String(to),
    convert_to_usd: "true",
  });
  const series = res[0];
  if (series === undefined) return [];
  return series.history.map((p) => ({
    time: toMs(p.t),
    symbol: cs,
    oi: NaN, // valeur native (contrats) non demandée ici (convert_to_usd:true)
    oiUsd: p.c,
  }));
}

/** Historique funding rate, agrégé par intervalle (clôture de chaque bucket). */
async function fetchFundingRateHistory(
  symbol: string,
  period: string,
  sinceMs: number
): Promise<FundingRate[]> {
  const cs = toCoinalyzeSymbol(symbol);
  const interval = normalizeInterval(period);
  const to = Math.floor(Date.now() / 1000);
  const from = Math.floor(sinceMs / 1000);
  const res = await request<HistoryResponse<OhlcHistoryPoint>[]>("funding-rate-history", {
    symbols: cs,
    interval,
    from: String(from),
    to: String(to),
  });
  const series = res[0];
  if (series === undefined) return [];
  return series.history.map((p) => ({
    time: toMs(p.t),
    symbol: cs,
    rate: pctToFraction(p.c), // Coinalyze % → fraction (cf. pctToFraction).
    // Comme fetchFundingRate (snapshot) : ni mark price ni heure du prochain funding
    // sur cet endpoint.
    nextFundingTime: 0,
    markPrice: NaN,
  }));
}

/** Provider Coinalyze (Build-vs-Buy : on ACHÈTE le dérivé lent). */
export const coinalyzeProvider: IDerivedDataProvider = {
  id: "coinalyze",
  fetchOpenInterest,
  fetchFundingRate,
  fetchLongShortRatio,
  fetchLiquidations,
  fetchOpenInterestHistory,
  fetchFundingRateHistory,
};

// ─────────────────────────── Extensions Phase 3 (endpoints non exploités) ───────────────────────────
// Fonctions AU-DELÀ du contrat IDerivedDataProvider (figé) → exportées à part, pas
// greffées sur `coinalyzeProvider`. Réutilisent le throttle/santé/mapping ci-dessus.

/**
 * Heure du prochain RÈGLEMENT de funding, en ms epoch. Coinalyze
 * (predicted-funding-rate) ne l'expose pas → on calcule la prochaine frontière de
 * 8 h UTC (00:00 / 08:00 / 16:00), cadence standard des perpétuels Binance USDⓈ-M.
 * PURE & testée. ⚠️ Hypothèse 8 h : quelques perps règlent en 4 h/1 h — affiché
 * comme estimation « prochain règlement (~8 h) » côté UI.
 */
export function prochainReglementFunding(nowMs: number): number {
  const HUIT_H = 8 * 60 * 60 * 1000; // les multiples de 8 h depuis l'epoch tombent sur 00/08/16 UTC.
  return (Math.floor(nowMs / HUIT_H) + 1) * HUIT_H;
}

/**
 * Funding rate PRÉDIT (endpoint « current » predicted-funding-rate) : le taux qui
 * sera appliqué au prochain règlement. `rate` normalisé en fraction (cf. pctToFraction) ;
 * `nextFundingTime` estimé (prochaine frontière 8 h UTC).
 */
export async function fetchPredictedFundingRate(symbol: string): Promise<FundingRate> {
  const cs = toCoinalyzeSymbol(symbol);
  const res = await request<CurrentPoint[]>("predicted-funding-rate", { symbols: cs });
  const p = res[0];
  if (p === undefined) throw new CoinalyzeError(404, `Aucun funding prédit pour ${cs}`);
  return {
    time: toMs(p.update),
    symbol: cs,
    rate: pctToFraction(p.value),
    nextFundingTime: prochainReglementFunding(Date.now()),
    markPrice: NaN,
  };
}

/**
 * SÉRIE long/short ratio agrégé (comptes) — même endpoint que fetchLongShortRatio
 * mais renvoie TOUT l'historique de la fenêtre (pour une sparkline), pas seulement
 * le dernier point.
 */
export async function fetchLongShortRatioHistory(
  symbol: string,
  period: string,
  sinceMs: number
): Promise<LongShortRatio[]> {
  const cs = toCoinalyzeSymbol(symbol);
  const interval = normalizeInterval(period);
  const to = Math.floor(Date.now() / 1000);
  const from = Math.floor(sinceMs / 1000);
  const res = await request<HistoryResponse<LsHistoryPoint>[]>("long-short-ratio-history", {
    symbols: cs,
    interval,
    from: String(from),
    to: String(to),
  });
  const series = res[0];
  if (series === undefined) return [];
  return series.history.map((p) => ({
    time: toMs(p.t),
    symbol: cs,
    longAccount: p.l,
    shortAccount: p.s,
    ratio: p.r,
    type: "account" as const,
  }));
}

/** Total de liquidations long vs short d'un même bucket temporel (barres bicolores). */
export interface LiquidationBucket {
  time: number;
  longUsd: number;
  shortUsd: number;
}

/**
 * Regroupe les liquidations (déjà séparées par côté par fetchLiquidations) en buckets
 * temporels {longUsd, shortUsd}. PURE & testée : alimente le mini-histogramme bicolore.
 */
export function groupLiquidationBuckets(liqs: Liquidation[]): LiquidationBucket[] {
  const byTime = new Map<number, LiquidationBucket>();
  for (const l of liqs) {
    let bucket = byTime.get(l.time);
    if (bucket === undefined) {
      bucket = { time: l.time, longUsd: 0, shortUsd: 0 };
      byTime.set(l.time, bucket);
    }
    const usd = Number.isFinite(l.qtyUsd) ? l.qtyUsd : 0;
    if (l.side === "long") bucket.longUsd += usd;
    else bucket.shortUsd += usd;
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
