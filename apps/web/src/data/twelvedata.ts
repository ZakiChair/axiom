/**
 * Adaptateur MARCHÉS TRADITIONNELS — Twelve Data (API officielle, plan gratuit).
 * Implémente IExchangeAdapter (@axiom/types) pour actions, forex, et — via leurs ETF —
 * indices (S&P500→SPY, Nasdaq→QQQ…) et commodités (or→GLD, pétrole→USO…).
 *
 * POURQUOI Twelve Data (et pas Yahoo/Stooq) : ces sources keyless sont anti-bot et
 * bloquent l'IP (Yahoo 429, Stooq Proof-of-Work). Twelve Data authentifie par CLÉ →
 * pas de blocage IP, CORS ouvert, officiel/stable. La clé PERSONNELLE reste côté
 * navigateur ; sur Vercel l'API est appelée directement, en local /tdapi garde le repli .env.
 *
 * - fetchKlines : GET time_series?symbol=&interval=&outputsize=&order=ASC&timezone=UTC
 * - subscribeKline : pas de WebSocket en gratuit → POLLING (~30 s) de la bougie courante.
 * - subscribeTrades : no-op (pas de tick → orderflow/footprint inactifs).
 *
 * LIMITES (plan gratuit) : 8 req/min, 800 req/jour ; pas de temps réel WS (polling,
 * données live-ish/différées) ; forex SANS volume (→ 0) ; indices/commodités servis par
 * leurs ETF (le prix suit le sous-jacent de près). La crypto reste sur les exchanges.
 *
 * FILE DU QUOTA : FIFO à deux priorités (le backfill du graphe passe devant cotations,
 * barres de watchlist et sondages) ; une demande abandonnée (AbortSignal) sort de la
 * file sans consommer ni créneau ni crédit. `fetchKlinesTwelveData` expose ce contrôle,
 * que l'interface figée `fetchKlines` ne porte pas.
 */
import type { Candle, IExchangeAdapter, Timeframe, Unsubscribe } from "@axiom/types";
import { pollLoop } from "./pollLoop";
import { healthStore } from "../store/health";

/** Base directe sur Vercel, proxifiée par /tdapi en local pour conserver le repli .env. */
const TWELVE_DATA_API_BASE = import.meta.env.VITE_TWELVE_DATA_API_BASE || "/tdapi";
const SERIES_URL = `${TWELVE_DATA_API_BASE}/time_series`;
/** Base directe (build Vercel) : sans clé personnelle, la réponse serait une 401 certaine. */
const BASE_DIRECTE = /^https?:\/\//.test(TWELVE_DATA_API_BASE);
const MSG_CLE_REQUISE = "Twelve Data : clé Twelve Data requise — ajoutez votre clé personnelle dans les Réglages.";

let apiKey: string | null = null;
/** Posée par store/twelvedata (chargé avec les Réglages seulement) ; sinon relue une fois. */
let clePosee = false;
/** Même nom que dans store/twelvedata.ts. */
const CLE_STOCKAGE = "axiom:twelvedata:key";

export function setTwelveDataApiKey(key: string | null): void {
  clePosee = true;
  const value = key?.trim() ?? "";
  apiKey = value.length > 0 ? value : null;
}

/** Clé enregistrée utilisable dès la première demande, sans attendre l'ouverture des Réglages. */
function cleActive(): string | null {
  if (!clePosee) {
    try { setTwelveDataApiKey(localStorage.getItem(CLE_STOCKAGE)); }
    catch { clePosee = true; /* stockage bloqué : sans clé personnelle */ }
  }
  return apiKey;
}

export function buildTwelveDataUrl(
  path: string,
  params: Record<string, string> | URLSearchParams,
  personalApiKey: string | null,
): string {
  const search = new URLSearchParams(params);
  if (personalApiKey !== null && personalApiKey.length > 0) search.set("apikey", personalApiKey);
  const query = search.toString();
  if (query.length === 0) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

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
 * c'est le consommateur Twelve Data quasi permanent et la seule ligne TD affichée.
 *
 * PROPRIÉTÉ DE CE MODULE : Ce module est PROPRIÉTAIRE du cycle de vie COMPLET de l'erreur
 * quota journalier — il la pose (marquerErreur au gate acquireSlot) ET la lève (setEtat
 * avec derniereErreur=undefined dans reportQuota) après minuit UTC. Les erreurs de polling
 * (non-quota) restent sous la responsabilité de data/ticker.ts. Identification par message
 * exact (MSG_QUOTA_JOUR), pour ne jamais lever d'erreur posée par un autre module.
 */
const HEALTH_SOURCE = "twelvedata:quotes";
/** Clé localStorage du compteur JOURNALIER (reset à minuit UTC, cf. nextDailyCount). */
const DAILY_KEY = "axiom:twelvedata:daily:v1";
/** Message d'erreur quota utilisé pour l'identification dans le registre santé (levée = message exact). */
const MSG_QUOTA_JOUR = "quota journalier Twelve Data épuisé (800 crédits)";

const requestTimes: number[] = [];

/** Priorité dans la file : le backfill du graphe passe devant cotations, barres et sondages. */
export type PrioriteTwelveData = "graphe" | "fond";

/** Contrôle d'une demande Twelve Data (l'interface figée `fetchKlines` n'en porte aucun). */
export interface ControleTwelveData {
  /** Abandon : une demande encore en file en sort sans consommer ni créneau ni crédit. */
  signal?: AbortSignal;
  /** Défaut « fond ». */
  priorite?: PrioriteTwelveData;
  /** Attente de créneau estimée au-delà de laquelle la demande est refusée d'emblée. */
  attenteMaxMs?: number;
  /** Appelé à l'obtention du créneau, ou tout de suite pour une réponse en cache. */
  onCreneau?: () => void;
}

interface Demande { priorite: () => PrioriteTwelveData; accorder: () => void; refuser: (erreur: unknown) => void }
/** Contrôle interne : une série partagée garde sa demande en file pour juger qui la rejoint. */
interface ControleFile extends ControleTwelveData { enFile?: (demande: Demande) => void }
const refusAttente = (attente: number): Error => new Error(`Quota Twelve Data : prochain créneau dans ${Math.ceil(attente / 1000)} s`);
/** File FIFO explicite : la première demande « graphe » passe devant toute demande de fond. */
const file: Demande[] = [];
let minuteurFile: ReturnType<typeof setTimeout> | undefined;

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

/** Lit le compteur journalier persisté SANS l'incrémenter (null si indisponible/corrompu). */
function lireDailyUsage(): DailyUsage | null {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as DailyUsage).jour === "string" &&
      typeof (parsed as DailyUsage).count === "number"
      ? (parsed as DailyUsage)
      : null;
  } catch {
    return null;
  }
}

/**
 * Vrai si le plafond JOURNALIER est atteint pour le jour UTC de `now`. PURE & testée.
 * Un compteur d'un autre jour ne compte pas (reset minuit UTC), un compteur absent non plus.
 */
export function quotaJourEpuise(stored: DailyUsage | null, now: Date, limite = DAILY_LIMIT): boolean {
  return stored !== null && stored.jour === utcDayKey(now) && stored.count >= limite;
}

/**
 * Incrémente + persiste le compteur journalier (localStorage), renvoie le total du jour.
 * Best-effort : si localStorage est indisponible (mode privé / tests node), renvoie
 * `null` → le segment journalier du quota est simplement omis.
 */
function bumpDailyCount(): number | null {
  try {
    const stored = lireDailyUsage();
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
 * jamais les données renvoyées ni le débit.
 *
 * LEVÉE D'ERREUR QUOTA : si le registre porte l'erreur quota (MSG_QUOTA_JOUR), on la
 * lève via setEtat("polling", {derniereErreur: undefined}). Cela nettoie l'erreur quota
 * posée hier après minuit UTC → le premier succès de reportQuota retrouve le flux
 * opérationnel. Cherche par inclusion (includes) plutôt que égalité exacte car le
 * message peut être formaté par data/ticker.ts en amont (ex. "Twelve Data: ${MSG_QUOTA_JOUR} — …").
 * Les erreurs non-quota posées par data/ticker.ts ne sont jamais levées ici.
 */
function reportQuota(): void {
  const jour = bumpDailyCount();
  const state = healthStore.getState();

  // Lève l'erreur quota si elle est actuellement posée (et seulement l'erreur quota).
  // Cherche par inclusion : le message est distinctif et préservé même formaté par ticker.ts.
  const current = state.sources[HEALTH_SOURCE];
  if (current?.derniereErreur?.includes(MSG_QUOTA_JOUR)) {
    state.setEtat(HEALTH_SOURCE, "polling", { derniereErreur: undefined });
  }

  state.setQuota(HEALTH_SOURCE, {
    utilise: requestTimes.length,
    limite: RATE_LIMIT,
    fenetre: "1min",
    ...(jour !== null ? { jour: { utilise: jour, limite: DAILY_LIMIT } } : {}),
  });
}

/**
 * Plafond JOURNALIER (~800 crédits) : jusqu'ici seulement AFFICHÉ. 3 symboles tradfi
 * pollés à 60 s + le chart crevaient le plafond en cours de séance US, puis chaque
 * appel échouait en silence jusqu'à minuit UTC. On refuse ICI, explicitement : le
 * chart ressert son cache périmé (cachedSeries), la watchlist passe en erreur, et
 * le backoff de pollLoop espace les tentatives. L'erreur est levée au jour suivant
 * lors du premier succès de reportQuota (minuit UTC passé, compteur reset).
 */
function refusQuotaJour(): Error | undefined {
  if (!quotaJourEpuise(lireDailyUsage(), new Date())) return undefined;
  healthStore.getState().marquerErreur(HEALTH_SOURCE, MSG_QUOTA_JOUR);
  return new Error(`Twelve Data: ${MSG_QUOTA_JOUR} — reset à minuit UTC`);
}

function purgerFenetre(now: number): void {
  while (requestTimes.length > 0 && now - (requestTimes[0] ?? now) >= RATE_WINDOW_MS) requestTimes.shift();
}

/** Sert la file tant que la fenêtre a des créneaux ; sinon UN minuteur attend le plus ancien. */
function servirFile(): void {
  for (;;) {
    const demande = file.find((d) => d.priorite() === "graphe") ?? file[0];
    if (!demande) return;
    const refus = refusQuotaJour();
    const now = Date.now();
    purgerFenetre(now);
    if (!refus && requestTimes.length >= RATE_LIMIT) {
      if (minuteurFile === undefined) {
        minuteurFile = setTimeout(() => { minuteurFile = undefined; servirFile(); }, (requestTimes[0] ?? now) + RATE_WINDOW_MS - now);
      }
      return;
    }
    file.splice(file.indexOf(demande), 1);
    if (refus) { demande.refuser(refus); continue; }
    requestTimes.push(now);
    reportQuota();
    demande.accorder();
  }
}

const enGraphe = (d: Demande): boolean => d.priorite() === "graphe";

/**
 * Attente d'une NOUVELLE demande à cette priorité, ou de `demande` déjà en file si elle
 * l'avait (promotion) : les « graphe » arrivées avant elle, puis, en fond, les « fond ».
 */
function attenteEstimeeMs(priorite: PrioriteTwelveData, demande?: Demande): number {
  const avant = demande ? file.slice(0, Math.max(0, file.indexOf(demande))) : file;
  return attenteApresMs(priorite === "graphe" ? avant.filter(enGraphe).length
    : file.filter(enGraphe).length + avant.filter((d) => !enGraphe(d)).length);
}

/** Fenêtre courante, puis `devant` demandes servies avant celle-ci. */
function attenteApresMs(devant: number): number {
  const now = Date.now();
  purgerFenetre(now);
  const occupes = [...requestTimes];
  let t = now;
  for (let i = 0; i <= devant; i++) {
    t = Math.max(t, (occupes[occupes.length - RATE_LIMIT] ?? -Infinity) + RATE_WINDOW_MS);
    occupes.push(t);
  }
  return t - now;
}

/**
 * Acquiert un créneau de débit (fenêtre glissante 8/60 s). Au-delà de 8 dans la fenêtre,
 * la demande ATTEND en file plutôt que de partir et se faire rejeter (429). Garantit
 * ≤ 8 req/min côté Twelve Data. La priorité est relue à chaque service (promotion).
 */
function acquireSlot(controle: ControleFile = {}): Promise<void> {
  const { signal } = controle;
  if (cleActive() === null && BASE_DIRECTE) return Promise.reject(new Error(MSG_CLE_REQUISE));
  if (signal?.aborted) return Promise.reject(signal.reason);
  const refus = refusQuotaJour();
  if (refus) return Promise.reject(refus);
  const priorite = (): PrioriteTwelveData => controle.priorite ?? "fond";
  if (controle.attenteMaxMs !== undefined) {
    const attente = attenteEstimeeMs(priorite());
    if (attente > controle.attenteMaxMs) return Promise.reject(refusAttente(attente));
  }
  return new Promise<void>((resolve, reject) => {
    const quitter = (): void => {
      const index = file.indexOf(demande);
      if (index !== -1) file.splice(index, 1);
      reject(signal?.reason);
    };
    const demande: Demande = {
      priorite,
      accorder: () => { signal?.removeEventListener("abort", quitter); controle.onCreneau?.(); resolve(); },
      refuser: (erreur) => { signal?.removeEventListener("abort", quitter); reject(erreur); },
    };
    signal?.addEventListener("abort", quitter, { once: true });
    file.push(demande);
    controle.enFile?.(demande);
    servirFile();
  });
}

interface CacheEntry {
  at: number;
  data: Candle[];
}
/** Cache des séries par clé `symbol|interval|outputsize|endTime`. */
const seriesCache = new Map<string, CacheEntry>();
const MAX_SERIES_CACHE = 32;
/** Requête commune à ses abonnés : annulée seulement au départ du dernier. */
interface SeriePartagee {
  promesse: Promise<Candle[]>;
  controleur: AbortController;
  abonnes: number;
  priorite: PrioriteTwelveData;
  creneau: boolean;
  surCreneau: Array<() => void>;
  /** Sa demande dans la file du quota, tant que le créneau n'est pas obtenu. */
  demande?: Demande;
}
/** Requêtes en vol par clé (dédup : le double-montage StrictMode = 1 seul appel). */
const inflight = new Map<string, SeriePartagee>();

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

/** `endTime` epoch ms → `YYYY-MM-DD HH:MM:SS` UTC (doc Twelve Data, timezone=UTC). */
export function formatEndDateUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function cleCacheTwelveData(
  symbol: string,
  interval: string,
  outputsize: number,
  endTime?: number,
): string {
  return `${symbol}|${interval}|${outputsize}|${endTime ?? ""}`;
}

/** Écarte (ou vide) les points hors borne : pas de repli sur la queue récente. */
export function filtrerKlinesBornes(candles: Candle[], endTime?: number): Candle[] {
  if (endTime === undefined) return candles;
  return candles.filter((c) => c.time <= endTime);
}

/** GET + parse, APRÈS acquisition d'un créneau de débit (respecte le quota 8/min). */
async function requestSeries(
  symbol: string,
  interval: string,
  outputsize: number,
  controle: ControleFile,
  endTime?: number,
): Promise<Candle[]> {
  await acquireSlot(controle);
  controle.signal?.throwIfAborted(); // abandon entre l'obtention du créneau et l'envoi
  const params = new URLSearchParams({
    symbol, // URLSearchParams encode "/" de EUR/USD → %2F
    interval,
    outputsize: String(outputsize),
    order: "ASC",
    timezone: "UTC",
  });
  if (endTime !== undefined) params.set("end_date", formatEndDateUtc(endTime));
  const res = await fetch(buildTwelveDataUrl(SERIES_URL, params, apiKey), { signal: controle.signal });
  // Twelve Data renvoie un corps JSON d'erreur même en non-2xx → on tente de le lire.
  const json = (await res.json().catch(() => null)) as TwelveDataResponse | null;
  if (json === null) throw new Error(`Twelve Data ${res.status} ${res.statusText}`);
  return filtrerKlinesBornes(parseTwelveData(json), endTime);
}

/**
 * Série AVEC cache + dédup (pour le backfill). Revisiter un symbole/TF déjà chargé =
 * 0 appel (cache TTL). Deux demandes identiques concurrentes (double-montage StrictMode)
 * partagent UNE requête ; un abonné « graphe » la promeut. Si le fetch échoue (quota/réseau),
 * on ressert le cache PÉRIMÉ s'il existe plutôt qu'un graphe vide — jamais après abandon.
 */
function cachedSeries(
  symbol: string,
  interval: string,
  outputsize: number,
  endTime: number | undefined,
  controle: ControleTwelveData,
): Promise<Candle[]> {
  const key = cleCacheTwelveData(symbol, interval, outputsize, endTime);
  const hit = seriesCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    controle.onCreneau?.();
    return Promise.resolve(hit.data);
  }
  if (controle.signal?.aborted) return Promise.reject(controle.signal.reason);
  const enVol = inflight.get(key);
  // Série encore en file : la limite d'attente de CET abonné vaut aussi (jugée comme s'il
  // la promouvait). Refus pour lui seul, sans promotion ; même repli périmé qu'une série neuve.
  if (enVol?.demande && !enVol.creneau && controle.attenteMaxMs !== undefined) {
    const attente = attenteEstimeeMs(controle.priorite === "graphe" ? "graphe" : enVol.priorite, enVol.demande);
    if (attente > controle.attenteMaxMs) {
      const stale = seriesCache.get(key);
      return stale ? Promise.resolve(stale.data) : Promise.reject(refusAttente(attente));
    }
  }
  const partagee = enVol ?? lancerSerie(key, symbol, interval, outputsize, endTime, controle);
  if (controle.priorite === "graphe") partagee.priorite = "graphe";
  return abonner(key, partagee, controle);
}

function lancerSerie(
  key: string,
  symbol: string,
  interval: string,
  outputsize: number,
  endTime: number | undefined,
  controle: ControleTwelveData,
): SeriePartagee {
  const etat: Omit<SeriePartagee, "promesse"> = { controleur: new AbortController(), abonnes: 0, priorite: controle.priorite ?? "fond", creneau: false, surCreneau: [] };
  const { signal } = etat.controleur;
  const promesse = (async () => {
    try {
      const data = await requestSeries(symbol, interval, outputsize, {
        signal,
        get priorite() { return etat.priorite; },
        ...(controle.attenteMaxMs !== undefined ? { attenteMaxMs: controle.attenteMaxMs } : {}),
        onCreneau: () => { etat.creneau = true; delete etat.demande; for (const suite of etat.surCreneau.splice(0)) suite(); },
        enFile: (demande) => { etat.demande = demande; },
      }, endTime);
      seriesCache.delete(key);
      seriesCache.set(key, { at: Date.now(), data });
      while (seriesCache.size > MAX_SERIES_CACHE) {
        const ancienne = seriesCache.keys().next().value;
        if (ancienne === undefined) break;
        seriesCache.delete(ancienne);
      }
      return data;
    } catch (err) {
      const stale = seriesCache.get(key);
      if (stale && !signal.aborted) return stale.data; // repli : données périmées plutôt que graphe vide
      throw err;
    } finally {
      if (inflight.get(key)?.controleur === etat.controleur) inflight.delete(key);
    }
  })();
  const partagee: SeriePartagee = Object.assign(etat, { promesse });
  inflight.set(key, partagee);
  return partagee;
}

/** Chaque abonné peut abandonner seul ; la requête commune n'est annulée qu'au départ du dernier. */
function abonner(key: string, partagee: SeriePartagee, controle: ControleTwelveData): Promise<Candle[]> {
  const { signal, onCreneau } = controle;
  partagee.abonnes += 1;
  if (onCreneau) {
    if (partagee.creneau) onCreneau();
    else partagee.surCreneau.push(onCreneau);
  }
  if (!signal) return partagee.promesse;
  return new Promise<Candle[]>((resolve, reject) => {
    const quitter = (): void => {
      reject(signal.reason);
      const suite = onCreneau ? partagee.surCreneau.indexOf(onCreneau) : -1;
      if (suite !== -1) partagee.surCreneau.splice(suite, 1);
      partagee.abonnes -= 1;
      if (partagee.abonnes > 0) return;
      if (inflight.get(key) === partagee) inflight.delete(key);
      partagee.controleur.abort();
    };
    if (signal.aborted) { quitter(); return; }
    signal.addEventListener("abort", quitter, { once: true });
    partagee.promesse.then(
      (data) => { signal.removeEventListener("abort", quitter); resolve(data); },
      (erreur: unknown) => { signal.removeEventListener("abort", quitter); reject(erreur); },
    );
  });
}

/**
 * Klines Twelve Data annulables et priorisables (backfill du graphe). L'adaptateur, dont
 * l'interface est figée, s'en sert sans contrôle : priorité de fond, jamais abandonné.
 */
export function fetchKlinesTwelveData(
  symbol: string,
  tf: Timeframe,
  opts: { limit?: number; endTime?: number } = {},
  controle: ControleTwelveData = {},
): Promise<Candle[]> {
  const interval = TF_MAP[tf] ?? "1day";
  const outputsize = Math.min(opts.limit ?? 500, 5000);
  return cachedSeries(symbol, interval, outputsize, opts.endTime, controle); // cache + dédup + repli périmé
}

export const twelveDataAdapter: IExchangeAdapter = {
  id: "twelvedata",

  fetchKlines(symbol, tf, opts) {
    return fetchKlinesTwelveData(symbol, tf, opts);
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
      // Polling = données fraîches → requête directe (limitée par le quota), sans cache ;
      // un sondage arrêté pendant son attente quitte la file sans consommer de créneau.
      const candles = await requestSeries(symbol, interval, 2, { signal });
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

/** Endpoint /quote direct sur Vercel ou proxifié en local, comme /time_series. */
const QUOTE_URL = `${TWELVE_DATA_API_BASE}/quote`;

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
 * (le quota 8/min reste respecté entre graphe et watchlist), en priorité de fond.
 */
export async function fetchQuotes(symbols: string[], controle: ControleTwelveData = {}): Promise<TwelveDataQuote[]> {
  if (symbols.length === 0) return [];
  for (let i = 0; i < symbols.length; i++) await acquireSlot(controle);
  const params = new URLSearchParams({ symbol: symbols.join(",") });
  const res = await fetch(buildTwelveDataUrl(QUOTE_URL, params, apiKey), { signal: controle.signal });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (json === null) throw new Error(`Twelve Data quote ${res.status} ${res.statusText}`);
  return parseQuotes(json, symbols);
}
