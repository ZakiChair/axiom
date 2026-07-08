/**
 * Données dérivées Binance USDⓈ-M — endpoints publics `fapi /futures/data` (Phase 3).
 *
 * Ces endpoints exposent GRATUITEMENT le sentiment du perpétuel Binance : ratio
 * long/short des comptes globaux et des top traders, ratio taker achat/vente, et
 * l'historique d'Open Interest. Ils renvoient l'en-tête `Access-Control-Allow-Origin: *`
 * → APPEL DIRECT depuis le navigateur (pas de proxy /extapi nécessaire), comme
 * l'adaptateur spot data/binance.ts. Complète Coinalyze (qui exige une clé) : cette
 * source est SANS clé, donc le panneau Dérivés reste utile même sans Coinalyze.
 *
 * Débit : Binance plafonne `/futures/data` à ~1000 requêtes / 5 min / IP. On respecte
 * ce budget via un throttle à fenêtre glissante (ci-dessous) et on publie la
 * consommation dans le registre santé (source « binance:futures »).
 *
 * Dégradation gracieuse : sur échec (réseau, 429, blocage géographique 451…), on
 * marque l'erreur dans le registre santé et on rejette — l'appelant (fenêtre Dérivés)
 * utilise Promise.allSettled et n'affiche simplement pas la section, sans spam console.
 */
import type { Trade, Unsubscribe } from "@axiom/types";
import { healthStore } from "../store/health";
import { aggTradeToTrade, type BinanceAggTrade } from "./binance";
import { connectWsLoop } from "./wsLoop";

/** Base des endpoints publics de données dérivées Binance USDⓈ-M. */
const BASE_URL = "https://fapi.binance.com/futures/data";

/** Base du flux WS temps réel du perpétuel USDⓈ-M (fstream, distinct du REST fapi ci-dessus). */
const WS_FUTURES_BASE_URL = "wss://fstream.binance.com/ws";

/** Périodes d'agrégation acceptées par `/futures/data` (miroir de la doc Binance). */
export type BinanceFuturesPeriod =
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "12h"
  | "1d";

/** Identifiant de source dans le registre santé. */
const HEALTH_SOURCE = "binance:futures";

/** Budget de débit : ~1000 requêtes / 5 min / IP (fenêtre glissante). */
const RATE_LIMIT = 1000;
const RATE_WINDOW_MS = 5 * 60_000;

const requestTimes: number[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Publie la consommation courante du débit dans le registre santé (best-effort). */
function reportQuota(): void {
  healthStore.getState().setQuota(HEALTH_SOURCE, {
    utilise: requestTimes.length,
    limite: RATE_LIMIT,
    fenetre: "5min",
  });
}

/**
 * Acquiert un créneau de débit (fenêtre glissante 1000/5 min). Purge les horodatages
 * sortis de la fenêtre, puis attend si le budget est épuisé. Volume réel très bas
 * (quelques req/min quand la fenêtre est ouverte) → l'attente ne se déclenche jamais
 * en usage normal ; c'est un garde-fou, pas un chemin chaud.
 */
async function acquireSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
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
    await sleep(oldest === undefined ? RATE_WINDOW_MS : RATE_WINDOW_MS - (now - oldest));
  }
}

/** GET throttlé + instrumenté santé. Rejette (et marque l'erreur) sur statut non-2xx. */
async function request<T>(path: string, params: Record<string, string>): Promise<T> {
  await acquireSlot();
  const url = `${BASE_URL}/${path}?${new URLSearchParams(params).toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      healthStore.getState().marquerErreur(HEALTH_SOURCE, `HTTP ${res.status}`);
      throw new Error(`Binance futures ${res.status} ${res.statusText}`);
    }
    healthStore.getState().marquerMessage(HEALTH_SOURCE);
    return (await res.json()) as T;
  } catch (err) {
    // Erreur réseau/CORS (blocage géographique inclus) : signalée au registre santé.
    if (err instanceof Error && !err.message.startsWith("Binance futures")) {
      healthStore.getState().marquerErreur(HEALTH_SOURCE, err.message);
    }
    throw err;
  }
}

// ---------- Formes brutes des réponses ----------

interface RawRatioPoint {
  longShortRatio?: unknown;
  longAccount?: unknown;
  shortAccount?: unknown;
  timestamp?: unknown;
}

interface RawTakerPoint {
  buySellRatio?: unknown;
  buyVol?: unknown;
  sellVol?: unknown;
  timestamp?: unknown;
}

interface RawOiPoint {
  sumOpenInterest?: unknown;
  sumOpenInterestValue?: unknown;
  timestamp?: unknown;
}

// ---------- Points normalisés (exportés pour les consommateurs UI) ----------

/**
 * Point de ratio long/short (comptes globaux OU top traders). `longAccount` /
 * `shortAccount` sont des FRACTIONS (0..1, proportion des comptes), `ratio` = long/short.
 */
export interface BinanceRatioPoint {
  time: number;
  ratio: number;
  longAccount: number;
  shortAccount: number;
}

/** Point de ratio taker : `buySellRatio` = volume agressif acheteur / vendeur sur l'intervalle. */
export interface BinanceTakerPoint {
  time: number;
  buySellRatio: number;
  buyVol: number;
  sellVol: number;
}

/** Point d'historique Open Interest : `oi` en contrats (base), `oiUsd` en notionnel USD. */
export interface BinanceOiHistPoint {
  time: number;
  oi: number;
  oiUsd: number;
}

// ---------- Parsers PURS (testés avec fixtures inline) ----------

function isArray(raw: unknown): raw is unknown[] {
  return Array.isArray(raw);
}

/** Parse une réponse `*LongShort*Ratio` en points normalisés (tri ascendant, valeurs invalides écartées). */
export function parseRatioHistory(raw: unknown): BinanceRatioPoint[] {
  if (!isArray(raw)) return [];
  const out: BinanceRatioPoint[] = [];
  for (const item of raw) {
    const p = item as RawRatioPoint;
    const time = Number(p.timestamp);
    const ratio = Number(p.longShortRatio);
    const longAccount = Number(p.longAccount);
    const shortAccount = Number(p.shortAccount);
    if (!Number.isFinite(time) || !Number.isFinite(ratio)) continue;
    out.push({ time, ratio, longAccount, shortAccount });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Parse une réponse `takerlongshortRatio` en points normalisés (tri ascendant). */
export function parseTakerHistory(raw: unknown): BinanceTakerPoint[] {
  if (!isArray(raw)) return [];
  const out: BinanceTakerPoint[] = [];
  for (const item of raw) {
    const p = item as RawTakerPoint;
    const time = Number(p.timestamp);
    const buySellRatio = Number(p.buySellRatio);
    if (!Number.isFinite(time) || !Number.isFinite(buySellRatio)) continue;
    out.push({ time, buySellRatio, buyVol: Number(p.buyVol), sellVol: Number(p.sellVol) });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Parse une réponse `openInterestHist` en points normalisés (tri ascendant). */
export function parseOiHistory(raw: unknown): BinanceOiHistPoint[] {
  if (!isArray(raw)) return [];
  const out: BinanceOiHistPoint[] = [];
  for (const item of raw) {
    const p = item as RawOiPoint;
    const time = Number(p.timestamp);
    const oiUsd = Number(p.sumOpenInterestValue);
    if (!Number.isFinite(time) || !Number.isFinite(oiUsd)) continue;
    out.push({ time, oi: Number(p.sumOpenInterest), oiUsd });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ---------- Méthodes publiques ----------

/** Symbole perpétuel USDⓈ-M (identique au symbole spot pour les paires USDT/USDC). */
function futuresSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** Ratio L/S des COMPTES globaux (sentiment de la masse des comptes). */
export async function fetchGlobalLongShortAccountRatio(
  symbol: string,
  period: BinanceFuturesPeriod,
  limit = 30
): Promise<BinanceRatioPoint[]> {
  const raw = await request<unknown>("globalLongShortAccountRatio", {
    symbol: futuresSymbol(symbol),
    period,
    limit: String(limit),
  });
  return parseRatioHistory(raw);
}

/** Ratio L/S des POSITIONS des top traders (positionnement du smart money). */
export async function fetchTopLongShortPositionRatio(
  symbol: string,
  period: BinanceFuturesPeriod,
  limit = 30
): Promise<BinanceRatioPoint[]> {
  const raw = await request<unknown>("topLongShortPositionRatio", {
    symbol: futuresSymbol(symbol),
    period,
    limit: String(limit),
  });
  return parseRatioHistory(raw);
}

/** Ratio taker achat/vente (volume agressif) — sentiment d'exécution des takers. */
export async function fetchTakerLongShortRatio(
  symbol: string,
  period: BinanceFuturesPeriod,
  limit = 30
): Promise<BinanceTakerPoint[]> {
  const raw = await request<unknown>("takerlongshortRatio", {
    symbol: futuresSymbol(symbol),
    period,
    limit: String(limit),
  });
  return parseTakerHistory(raw);
}

/** Historique d'Open Interest du perpétuel (contrats + notionnel USD). */
export async function fetchOpenInterestHist(
  symbol: string,
  period: BinanceFuturesPeriod,
  limit = 30
): Promise<BinanceOiHistPoint[]> {
  const raw = await request<unknown>("openInterestHist", {
    symbol: futuresSymbol(symbol),
    period,
    limit: String(limit),
  });
  return parseOiHistory(raw);
}

/**
 * Flux WS aggTrade du PERPÉTUEL (fstream, distinct des endpoints REST ci-dessus) —
 * alimente le CVD perp (Task 17, en vis-à-vis du CVD spot existant). Même convention
 * de mapping agresseur/taker que le spot (`aggTradeToTrade`, data/binance.ts, PURE
 * & testée dans tradeMapping.test.ts) : m=true => agresseur VENDEUR => side="sell".
 * Cycle de vie (backoff exponentiel, watchdog de staleness) délégué à `connectWsLoop`,
 * copie exacte du pattern du flux spot `subscribeTrades` (data/binance.ts) — pas de
 * resync (les trades ne se backfillent pas).
 */
export function subscribePerpAggTrades(symbol: string, cb: (t: Trade) => void): Unsubscribe {
  const url = `${WS_FUTURES_BASE_URL}/${symbol.toLowerCase()}@aggTrade`;
  return connectWsLoop({
    url,
    source: "binance:futures:trades",
    onMessage: (data) => {
      try {
        const msg = JSON.parse(data) as BinanceAggTrade;
        if (msg.e === "aggTrade") {
          cb(aggTradeToTrade(msg));
          return true;
        }
      } catch (err) {
        console.error("[AXIOM] Message aggTrade perp Binance illisible", err);
      }
      return false;
    },
  });
}
