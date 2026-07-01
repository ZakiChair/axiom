/**
 * Adaptateur MARCHÉS TRADITIONNELS — Twelve Data (API officielle, plan gratuit).
 * Implémente IExchangeAdapter (@axiom/types) pour actions, forex, et — via leurs ETF —
 * indices (S&P500→SPY, Nasdaq→QQQ…) et commodités (or→GLD, pétrole→USO…).
 *
 * POURQUOI Twelve Data (et pas Yahoo/Stooq) : ces sources keyless sont anti-bot et
 * bloquent l'IP (Yahoo 429, Stooq Proof-of-Work). Twelve Data authentifie par CLÉ →
 * pas de blocage IP, CORS ouvert, officiel/stable. La clé est injectée CÔTÉ PROXY
 * (cf. /tdapi dans vite.config.ts) → jamais exposée au navigateur.
 *
 * - fetchKlines : GET /tdapi/time_series?symbol=&interval=&outputsize=&order=ASC&timezone=UTC
 * - subscribeKline : pas de WebSocket en gratuit → POLLING (~30 s) de la bougie courante.
 * - subscribeTrades : no-op (pas de tick → orderflow/footprint inactifs).
 *
 * LIMITES (plan gratuit) : 8 req/min, 800 req/jour ; pas de temps réel WS (polling,
 * données live-ish/différées) ; forex SANS volume (→ 0) ; indices/commodités servis par
 * leurs ETF (le prix suit le sous-jacent de près). La crypto reste sur les exchanges.
 */
import type { Candle, IExchangeAdapter, Timeframe, Unsubscribe } from "@axiom/types";
import { pollLoop } from "./pollLoop";
import { healthStore } from "../store/health";

/** Base proxifiée (same-origin) — cf. proxy "/tdapi" dans vite.config.ts (injecte la clé). */
const SERIES_URL = "/tdapi/time_series";

/** Cadence du polling (donnée différée ~15 min → 60 s économise le quota 8 req/min). */
const POLL_MS = 60_000;

// ───────── Quota 8 req/min : rate-limiter + cache + dédup (anti graphe vide) ─────────

/** Plan gratuit : 8 requêtes / 60 s. On met en FILE au-delà (jamais de 429). */
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;
/** Plan gratuit : ~800 crédits / jour (1 crédit = 1 symbole = 1 créneau de débit). */
const DAILY_LIMIT = 800;
/** Durée de validité d'une réponse en cache (tradfi différé → 30 s est sûr). */
const CACHE_TTL_MS = 30_000;

/**
 * Source du registre santé où publier le quota Twelve Data. On réutilise la ligne du
 * poller de watchlist (`twelvedata:quotes`, dont l'état est tenu par data/ticker.ts) :
 * c'est le consommateur Twelve Data quasi permanent et la seule ligne TD affichée. Le
 * quota est un budget de COMPTE (partagé graphe + watchlist), attaché à cette ligne
 * représentative — data/ticker.ts gère l'état, ce module n'y pose QUE le quota.
 */
const HEALTH_SOURCE = "twelvedata:quotes";
/** Clé localStorage du compteur JOURNALIER (reset à minuit UTC, cf. nextDailyCount). */
const DAILY_KEY = "axiom:twelvedata:daily:v1";

const requestTimes: number[] = [];
let throttleChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ───────── Compteur JOURNALIER (~800 crédits/jour), reset à minuit UTC ─────────

/** Usage journalier persisté : jour calendaire UTC + nombre de crédits consommés. */
export interface DailyUsage {
  /** Jour calendaire UTC au format "YYYY-MM-DD". */
  jour: string;
  count: number;
}

/** Jour calendaire UTC "YYYY-MM-DD" de `now`. PURE & testée (twelvedata.test.ts). */
export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Incrémente le compteur journalier d'un crédit, avec RESET à minuit UTC. PURE & testée.
 * Si `stored` est absent ou porte un AUTRE jour UTC que `now`, on repart de 1 (nouveau
 * jour) ; sinon on incrémente le compteur du jour courant.
 */
export function nextDailyCount(stored: DailyUsage | null, now: Date): DailyUsage {
  const jour = utcDayKey(now);
  if (stored === null || stored.jour !== jour) return { jour, count: 1 };
  return { jour, count: stored.count + 1 };
}

/**
 * Incrémente + persiste le compteur journalier (localStorage), renvoie le total du jour.
 * Best-effort : si localStorage est indisponible (mode privé / tests node), renvoie
 * `null` → le segment journalier du quota est simplement omis.
 */
function bumpDailyCount(): number | null {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const stored =
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as DailyUsage).jour === "string" &&
      typeof (parsed as DailyUsage).count === "number"
        ? (parsed as DailyUsage)
        : null;
    const next = nextDailyCount(stored, new Date());
    localStorage.setItem(DAILY_KEY, JSON.stringify(next));
    return next.count;
  } catch {
    return null; // localStorage indisponible → pas de compteur journalier
  }
}

/**
 * Publie la consommation du débit (fenêtre glissante 8/60 s) + le compteur journalier
 * dans le registre santé, à chaque créneau acquis (= 1 crédit). Best-effort : n'affecte
 * jamais les données renvoyées ni le débit. `data/ticker.ts` reste seul maître de l'ÉTAT
 * de la ligne ; ici on ne pose QUE le quota.
 */
function reportQuota(): void {
  const jour = bumpDailyCount();
  healthStore.getState().setQuota(HEALTH_SOURCE, {
    utilise: requestTimes.length,
    limite: RATE_LIMIT,
    fenetre: "1min",
    ...(jour !== null ? { jour: { utilise: jour, limite: DAILY_LIMIT } } : {}),
  });
}

/**
 * Acquiert un créneau de débit (fenêtre glissante 8/60 s), acquisitions sérialisées.
 * Au-delà de 8 dans la fenêtre, la requête ATTEND la libération d'un créneau plutôt
 * que de partir et se faire rejeter (429). Garantit ≤ 8 req/min côté Twelve Data.
 */
function acquireSlot(): Promise<void> {
  const run = throttleChain.then(async () => {
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
  });
  throttleChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

interface CacheEntry {
  at: number;
  data: Candle[];
}
/** Cache des séries par clé `symbol|interval|outputsize`. */
const seriesCache = new Map<string, CacheEntry>();
/** Requêtes en vol par clé (dédup : le double-montage StrictMode = 1 seul appel). */
const inflight = new Map<string, Promise<Candle[]>>();

/** TF AXIOM → interval Twelve Data. Seuls ces TF sont déclarés supportés (adapters.ts). */
const TF_MAP: Partial<Record<Timeframe, string>> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
  "1M": "1month",
};

/** Forme PARTIELLE d'une réponse time_series (champs utiles + erreurs). */
export interface TwelveDataResponse {
  status?: string; // "ok" | "error"
  code?: number; // code HTTP en cas d'erreur applicative
  message?: string;
  values?: Array<{
    datetime: string; // "YYYY-MM-DD" (journalier+) ou "YYYY-MM-DD HH:MM:SS" (intraday, UTC)
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: string; // absent en forex
  }>;
}

/** "YYYY-MM-DD[ HH:MM:SS]" (UTC) → ms epoch. */
function parseDatetimeMs(dt: string): number {
  const iso = dt.includes(" ") ? `${dt.replace(" ", "T")}Z` : `${dt}T00:00:00Z`;
  return Date.parse(iso);
}

/**
 * Transforme une réponse time_series en bougies AXIOM. PURE & testée (twelvedata.test.ts).
 *  - tri ASCENDANT par temps (indépendant de l'ordre renvoyé) ;
 *  - dernière barre marquée NON clôturée (période en cours) ;
 *  - volume absent (forex) → 0 ; barres non finies écartées.
 * @throws si la réponse est une erreur applicative (clé invalide, symbole inconnu…).
 */
export function parseTwelveData(json: TwelveDataResponse): Candle[] {
  if (json.status === "error" || (typeof json.code === "number" && json.code >= 400)) {
    throw new Error(`Twelve Data: ${json.message ?? json.code ?? "erreur"}`);
  }
  const values = json.values;
  if (!values || values.length === 0) return [];

  const out: Candle[] = [];
  for (const v of values) {
    const time = parseDatetimeMs(v.datetime);
    const open = Number(v.open);
    const high = Number(v.high);
    const low = Number(v.low);
    const close = Number(v.close);
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }
    out.push({
      time,
      open,
      high,
      low,
      close,
      volume: v.volume != null && v.volume !== "" ? Number(v.volume) : 0, // forex → 0
      closed: true,
    });
  }
  // Tri ascendant défensif (ne dépend pas du paramètre order) puis dernière = en cours.
  out.sort((a, b) => a.time - b.time);
  const last = out[out.length - 1];
  if (last) last.closed = false;
  return out;
}

/** GET + parse, APRÈS acquisition d'un créneau de débit (respecte le quota 8/min). */
async function requestSeries(
  symbol: string,
  interval: string,
  outputsize: number,
  signal?: AbortSignal
): Promise<Candle[]> {
  await acquireSlot();
  const params = new URLSearchParams({
    symbol, // URLSearchParams encode "/" de EUR/USD → %2F
    interval,
    outputsize: String(outputsize),
    order: "ASC",
    timezone: "UTC",
  });
  const res = await fetch(`${SERIES_URL}?${params.toString()}`, { signal });
  // Twelve Data renvoie un corps JSON d'erreur même en non-2xx → on tente de le lire.
  const json = (await res.json().catch(() => null)) as TwelveDataResponse | null;
  if (json === null) throw new Error(`Twelve Data ${res.status} ${res.statusText}`);
  return parseTwelveData(json);
}

/**
 * Série AVEC cache + dédup (pour le backfill). Revisiter un symbole/TF déjà chargé =
 * 0 appel (cache TTL). Deux demandes identiques concurrentes (double-montage StrictMode)
 * partagent UNE requête. Si le fetch échoue (quota/réseau), on ressert le cache PÉRIMÉ
 * s'il existe plutôt qu'un graphe vide.
 */
async function cachedSeries(symbol: string, interval: string, outputsize: number): Promise<Candle[]> {
  const key = `${symbol}|${interval}|${outputsize}`;
  const hit = seriesCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const flying = inflight.get(key);
  if (flying) return flying;

  const p = (async () => {
    try {
      const data = await requestSeries(symbol, interval, outputsize);
      seriesCache.set(key, { at: Date.now(), data });
      return data;
    } catch (err) {
      const stale = seriesCache.get(key);
      if (stale) return stale.data; // repli : données périmées plutôt que graphe vide
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export const twelveDataAdapter: IExchangeAdapter = {
  id: "twelvedata",

  async fetchKlines(symbol, tf, opts) {
    const interval = TF_MAP[tf] ?? "1day";
    const outputsize = Math.min(opts?.limit ?? 500, 5000);
    return cachedSeries(symbol, interval, outputsize); // cache + dédup + repli périmé
  },

  // Pas de WebSocket en gratuit → POLLING de la bougie courante (petit outputsize).
  subscribeKline(symbol, tf, cb) {
    const interval = TF_MAP[tf] ?? "1day";
    // parseTwelveData ne force `closed:false` QUE sur la dernière barre du lot : avec
    // outputsize=2, candles[0] porte déjà closed:true dès qu'elle est terminée. On la
    // ré-émet ici (une seule fois, via lastClosedTime) AVANT la barre en cours, sinon
    // aucune bougie clôturée n'est jamais transmise et les indicateurs ne recalculent plus.
    let lastClosedTime: number | null = null;

    return pollLoop(async (signal, isCancelled) => {
      // Polling = données fraîches → requête directe (limitée par le quota), sans cache.
      const candles = await requestSeries(symbol, interval, 2, signal);
      if (isCancelled() || candles.length === 0) return;
      const prev = candles.length >= 2 ? candles[candles.length - 2] : undefined;
      if (prev && prev.closed && (lastClosedTime === null || prev.time > lastClosedTime)) {
        lastClosedTime = prev.time;
        cb(prev);
      }
      const last = candles[candles.length - 1];
      if (!isCancelled() && last) cb(last);
    }, POLL_MS);
  },

  // Aucune donnée tick en tradfi gratuit → orderflow/footprint désactivés (dégradation propre).
  subscribeTrades(): Unsubscribe {
    return () => {};
  },
};

// ───────── /quote : prix + variation pour la WATCHLIST (data/ticker.ts) ─────────

/** Endpoint /quote proxifié (clé injectée côté serveur, cf. vite.config.ts). */
const QUOTE_URL = "/tdapi/quote";

/** Mise à jour ticker tradfi (même forme que TickerUpdate de data/ticker.ts). */
export interface TwelveDataQuote {
  symbol: string;
  price: number;
  changePercent: number;
}

/**
 * Parse une réponse /quote. PURE & testée. Twelve Data renvoie une forme À PLAT pour
 * UN symbole ({close, percent_change, …}) et une MAP { "SYM": {…} } pour plusieurs.
 * Les symboles en erreur (status:"error") ou sans `close` numérique sont écartés.
 * @throws uniquement si erreur GLOBALE (clé invalide) sans aucune donnée par symbole.
 */
export function parseQuotes(json: Record<string, unknown>, requested: string[]): TwelveDataQuote[] {
  if (json.status === "error" && !requested.some((s) => s in json)) {
    throw new Error(`Twelve Data quote: ${String(json.message ?? "erreur")}`);
  }
  const out: TwelveDataQuote[] = [];
  const pick = (raw: unknown, symbol: string): void => {
    if (raw === null || typeof raw !== "object") return;
    const r = raw as { close?: unknown; percent_change?: unknown; status?: unknown };
    if (r.status === "error") return;
    const price = Number(r.close);
    if (!Number.isFinite(price)) return;
    const pct = Number(r.percent_change);
    out.push({ symbol, price, changePercent: Number.isFinite(pct) ? pct : 0 });
  };
  if (requested.length === 1) {
    pick(json, requested[0] as string); // forme à plat
  } else {
    for (const sym of requested) pick(json[sym], sym); // forme map
  }
  return out;
}

/**
 * Récupère prix + variation pour plusieurs symboles tradfi en UN appel /quote groupé.
 * Coût Twelve Data = 1 crédit / symbole → on réserve N créneaux du rate-limiter partagé
 * (le quota 8/min reste respecté entre graphe et watchlist).
 */
export async function fetchQuotes(symbols: string[]): Promise<TwelveDataQuote[]> {
  if (symbols.length === 0) return [];
  for (let i = 0; i < symbols.length; i++) await acquireSlot();
  const params = new URLSearchParams({ symbol: symbols.join(",") });
  const res = await fetch(`${QUOTE_URL}?${params.toString()}`);
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (json === null) throw new Error(`Twelve Data quote ${res.status} ${res.statusText}`);
  return parseQuotes(json, symbols);
}
