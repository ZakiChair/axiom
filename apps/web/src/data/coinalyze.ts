/**
 * Fournisseur de données DÉRIVÉES — Coinalyze (tier GRATUIT), implémente
 * IDerivedDataProvider (@axiom/types). M6 « ACHETER » plutôt que construire un
 * AggregationEngine multi-exchange (cf. BUILD-CONTRACT).
 *
 * - REST : https://api.coinalyze.net/v1/ ; authentification par en-tête `api_key`
 *   (JAMAIS dans l'URL ni dans les logs — la clé voyage uniquement en header).
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

const BASE_URL = "https://api.coinalyze.net/v1/";

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

/** Injecte/retire la clé utilisée par le provider (appelée par le store de réglages). */
export function setCoinalyzeApiKey(key: string | null): void {
  apiKey = key !== null && key.length > 0 ? key : null;
}

/** Erreur levée quand aucune clé n'est configurée (l'UI invite alors à en saisir une). */
export class MissingApiKeyError extends Error {
  constructor() {
    super("Clé API Coinalyze manquante");
    this.name = "MissingApiKeyError";
  }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * GET authentifié + throttlé. La clé part UNIQUEMENT dans l'en-tête `api_key`.
 * On ne logge jamais la clé : seul le statut HTTP est rapporté en cas d'erreur.
 */
async function request<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = apiKey;
  if (key === null) throw new MissingApiKeyError();

  await acquireSlot();

  const url = `${BASE_URL}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { api_key: key } });
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
    rate: p.value,
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

/** Provider Coinalyze (Build-vs-Buy : on ACHÈTE le dérivé lent). */
export const coinalyzeProvider: IDerivedDataProvider = {
  id: "coinalyze",
  fetchOpenInterest,
  fetchFundingRate,
  fetchLongShortRatio,
  fetchLiquidations,
};
