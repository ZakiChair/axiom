/**
 * Flux ticker pour la watchlist — ROUTÉ PAR SOURCE d'origine de chaque symbole
 * (roadmap 0.4b). La source vient du store watchlist (explicite) ou est inférée :
 *  - binance    : WebSocket « combiné » temps réel (prix `c` + variation 24 h `P`) ;
 *  - kraken     : POLLING REST /0/public/Ticker (30 s), 1 requête par symbole ;
 *  - coinbase   : POLLING REST market/products GROUPÉ (30 s, via /extapi : l'API n'expose
 *    aucun en-tête CORS), 1 requête pour le lot. Le relais sert ce lot depuis son cache :
 *    le prix affiché peut dater de 60 s sur Vercel (max-age=60) et de 120 s avec axiomd
 *    (TTL /extapi par défaut), malgré le poll de 30 s ;
 *  - mexc       : POLLING REST /ticker/24hr (30 s, via proxy), 1 requête par symbole ;
 *  - okx/bybit  : POLLING REST ticker SPOT groupé (30 s) ; un instrument OKX seul (sonde,
 *    favori isolé) ne télécharge que son ticker ;
 *  - hyperliquid : contexte groupé + dernier trade public par coin (30 s) ;
 *  - twelvedata : POLLING /quote groupé (~60 s), GATÉ sur les heures de marché — inutile
 *    de brûler le quota (~800 crédits/j) la nuit / le week-end marché fermé (roadmap 0.4d).
 *
 * Un symbole non résolvable (ex. inconnu de son exchange) reste simplement à « — » :
 * les pollers avalent l'erreur (backoff interne de pollLoop), sans marteler la console.
 * Un symbole routé Binance mais contenant un « / » (ex. "XBT/USD") est ÉCARTÉ du stream
 * combiné (il casserait l'URL et figerait toute la watchlist) et reste à « — ».
 *
 * Mises à jour : l'appelant les écrit IMPÉRATIVEMENT dans le DOM (aucun state React).
 */
import type { Candle, ExchangeId, Timeframe, Unsubscribe } from "@axiom/types";
import { fetchQuotes } from "./twelvedata";
import { getAdapter } from "./adapters";
import { resolveMarketCandidates, type MarketCatalog, type ResolvedMarket } from "./marketRouting";
import { extUrl } from "./extapi";
import { estSymboleCapitalisation } from "./mcap";
import { TWELVEDATA_SYMBOLS } from "./pairs";
import { pollLoop } from "./pollLoop";
import { basePerp, splitSymbol } from "./symbol";
import { connectWsLoop } from "./wsLoop";
import { watchlistStore, type WatchlistSource } from "../store/watchlist";
import { healthStore } from "../store/health";

const WS_STREAM_BASE = "wss://stream.binance.com:9443/stream";
/** Cadence du polling tradfi (données Twelve Data différées → 60 s économise le quota). */
const TRADFI_POLL_MS = 60_000;
/** Cadence du polling ticker des exchanges crypto sans WS ticker câblé ici (léger). */
const CRYPTO_TICKER_POLL_MS = 30_000;
/** Clé du registre santé pour le poller de quotes tradfi (cf. store/health.ts). */
const TRADFI_HEALTH = "twelvedata:quotes";
/** Clé du registre santé du flux ticker Binance (convention `<exchange>:<canal>`). */
export const TICKER_HEALTH = "binance:ticker";

/** Catalogue tradfi curé, en Set pour la classification. */
const TRADFI_SET = new Set(TWELVEDATA_SYMBOLS);

/** Codes de devises fiat ISO utilisés pour reconnaître une paire FOREX "BASE/QUOTE". */
const FOREX_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "MXN",
  "SEK", "NOK", "DKK", "HKD", "SGD", "ZAR", "TRY", "INR", "BRL", "PLN",
]);

/**
 * Vrai si le symbole relève de Twelve Data (tradfi) quand aucune source explicite n'est
 * connue. Reconnaît : le catalogue curé ; les séparateurs sans ambiguïté d'indice/future/
 * place (`^ = .`) ; et une paire FOREX "BASE/QUOTE" dont LES DEUX côtés sont des codes fiat.
 * IMPORTANT : un slash seul ne suffit PAS — "XBT/USD" (notation de paire CRYPTO) n'est PAS
 * tradfi (sinon il partait à tort vers Twelve Data). Il sera routé crypto puis écarté du
 * stream Binance à cause du slash (reste « — »), au lieu de casser toute la watchlist.
 */
export function isTradfiSymbol(symbol: string): boolean {
  const s = symbol.toUpperCase();
  if (TRADFI_SET.has(symbol) || TRADFI_SET.has(s)) return true;
  if (/[\^=.]/.test(s)) return true;
  const m = /^([A-Z]{2,4})\/([A-Z]{2,4})$/.exec(s);
  if (m) {
    const [, a, b] = m;
    if (a && b && FOREX_CODES.has(a) && FOREX_CODES.has(b)) return true;
  }
  return false;
}

/**
 * Résout la source de flux d'un symbole : source EXPLICITE si le store en porte une,
 * sinon inférence (tradfi → Twelve Data ; à défaut Binance). PURE & testée.
 */
export function resolveTickerSource(symbol: string, explicit?: WatchlistSource): WatchlistSource {
  if (explicit) return explicit;
  if (symbol.toUpperCase().endsWith("-PERP")) return "hyperliquid";
  if (estSymboleCapitalisation(symbol) || symbol.includes("|")) return "synthetic";
  return isTradfiSymbol(symbol) ? "twelvedata" : "binance";
}

/** Sources disposant réellement d'un flux ticker dans ce module. */
const TICKER_SOURCES: ReadonlySet<string> = new Set<WatchlistSource>([
  "binance",
  "kraken",
  "coinbase",
  "mexc",
  "twelvedata",
  "okx",
  "bybit",
  "hyperliquid",
]);

/** Garde runtime utilisée par les consommateurs qui partent d'un `ExchangeId` plus large. */
export function isTickerSource(source: string): source is WatchlistSource {
  return TICKER_SOURCES.has(source);
}

/** Nature de marché d'un actif tradfi (heures d'ouverture distinctes). */
export type TradfiMarketKind = "crypto" | "stock" | "forex";

/** Un symbole tradfi à slash est du FOREX ; sinon action/ETF (heures de bourse US). */
export function classifyTradfi(symbol: string): "stock" | "forex" {
  return symbol.includes("/") ? "forex" : "stock";
}

/**
 * Marché plausiblement OUVERT pour `kind` à l'instant `date` (UTC). PURE & testée.
 *  - crypto : toujours ouvert (24/7, jamais gaté) ;
 *  - forex  : ouvert du dimanche 22:00 UTC au vendredi 22:00 UTC (fermé le samedi) ;
 *  - stock  : actions/ETF US, lundi-vendredi 13:20-20:10 UTC.
 *
 * APPROXIMATION DST (documentée) : la fenêtre actions est calée sur l'HEURE D'ÉTÉ (EDT,
 * UTC-4 → séance NYSE 13:30-20:00 UTC, élargie à 13:20-20:10). En HIVER (EST, UTC-5) la
 * séance réelle est 14:30-21:00 UTC : la fenêtre sous-couvre alors la dernière ~heure
 * (prix figé, jamais de crash) et sur-couvre le début de matinée. Les jours fériés ne sont
 * pas gérés. Objectif = couper le polling nocturne/week-end pour économiser le quota Twelve
 * Data, pas fournir une horloge de marché exacte.
 */
export function isMarketOpen(kind: TradfiMarketKind, date: Date): boolean {
  if (kind === "crypto") return true;
  const day = date.getUTCDay(); // 0 = dimanche … 6 = samedi
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (kind === "forex") {
    if (day === 6) return false; // samedi : fermé
    if (day === 0) return minutes >= 22 * 60; // dimanche : ouvre à 22:00 UTC
    if (day === 5) return minutes < 22 * 60; // vendredi : ferme à 22:00 UTC
    return true; // lundi-jeudi : ouvert en continu
  }
  // kind === "stock"
  if (day === 0 || day === 6) return false; // week-end : fermé
  return minutes >= 13 * 60 + 20 && minutes < 20 * 60 + 10;
}

/** Message d'erreur lisible (inline : pollLoop n'exporte pas son helper). */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Donnée minimale exposée à la watchlist. */
export interface TickerUpdate {
  symbol: string; // ex. "BTCUSDT" ou "SPY"
  price: number; // dernier prix
  changePercent: number; // variation 24 h en % ; NaN si la référence est absente
  /** Volume 24 h en devise de cotation (USD/USDT…), quand la source le fournit. */
  quoteVolume?: number;
}

/** Payload @ticker (champs utiles uniquement). */
interface BinanceTicker {
  s: string; // symbole
  c: string; // dernier prix
  P: string; // variation 24 h en %
  q: string; // volume 24 h en quote (devise de cotation)
}

interface BinanceStreamMessage {
  stream: string;
  data: BinanceTicker;
}

/** Construit l'URL du stream COMBINÉ `@ticker` pour un lot de symboles. PURE & testée. */
export function construireUrlStreamTicker(symbols: readonly string[]): string {
  const streams = symbols.map((s) => `${s.toLowerCase()}@ticker`).join("/");
  return `${WS_STREAM_BASE}?streams=${streams}`;
}

/**
 * Parse un message du stream combiné en `TickerUpdate`, ou null si le message n'est pas
 * une donnée exploitable (JSON illisible, enveloppe sans `data`, symbole absent). PURE
 * & testée : c'est elle qui décide, côté `connectWsLoop`, si le message réarme le backoff.
 */
export function parseMessageTicker(data: string): TickerUpdate | null {
  let msg: BinanceStreamMessage;
  try {
    msg = JSON.parse(data) as BinanceStreamMessage;
  } catch (err) {
    console.error("[AXIOM] Message ticker Binance illisible", err);
    return null;
  }
  const d = msg?.data;
  if (!d || typeof d.s !== "string") return null;
  const price = positiveNumber(d.c);
  if (price === undefined) return null;
  return {
    symbol: d.s,
    price,
    changePercent: finiteNumber(d.P) ?? NaN,
    quoteVolume: quoteVolumeNumber(d.q),
  };
}

/**
 * Nombre de flux ticker Binance vivants. La clé santé est PARTAGÉE (convention
 * `<exchange>:<canal>`) alors que plusieurs consommateurs (watchlist, bandeau, portefeuille,
 * moteur paper, alertes) ouvrent chacun leur stream combiné. `connectWsLoop` pose "closed"
 * au désabonnement : sans ce compteur, le démontage d'UN consommateur afficherait le flux
 * fermé dans le panneau DATA alors que les autres sont bien vivants (et `marquerMessage` ne
 * relève que "stale", jamais "closed" — cf. store/health.ts).
 */
let fluxTickerVivants = 0;

/**
 * Souscription ticker Binance (crypto) — WebSocket combiné. Cycle de vie (backoff anti-flap,
 * watchdog de staleness, report au registre santé sous `binance:ticker`) délégué à
 * `connectWsLoop`, comme les neuf autres adaptateurs. La liste de symboles est FIGÉE pour la
 * durée de l'abonnement : une watchlist qui change fait re-souscrire l'appelant (désabonnement
 * + nouvel appel), donc aucune re-souscription dynamique à gérer sur la socket elle-même.
 */
function subscribeBinanceTickers(
  symbols: string[],
  cb: (update: TickerUpdate) => void
): Unsubscribe {
  if (symbols.length === 0) return () => {};

  fluxTickerVivants += 1;
  const unsub = connectWsLoop({
    url: construireUrlStreamTicker(symbols),
    source: TICKER_HEALTH,
    onMessage: (data) => {
      const update = parseMessageTicker(data);
      if (update === null) return false;
      cb(update);
      return true;
    },
  });

  let annule = false;
  return () => {
    if (annule) return; // idempotent : un double appel ne décrémente qu'une fois
    annule = true;
    unsub();
    fluxTickerVivants -= 1;
    // Un autre flux ticker reste ouvert : on annule le "closed" que vient de poser wsLoop —
    // et UNIQUEMENT celui-là. Écraser un "reconnecting"/"error" légitime du flux survivant
    // par un "connected" optimiste serait le même mensonge, à l'envers.
    const sante = healthStore.getState();
    if (fluxTickerVivants > 0 && sante.sources[TICKER_HEALTH]?.etat === "closed") {
      sante.setEtat(TICKER_HEALTH, "connected");
    }
  };
}

// ───────── Pollers ticker REST des exchanges crypto (Kraken / Coinbase / MEXC) ─────────

const KRAKEN_TICKER_URL = "https://api.kraken.com/0/public/Ticker";
const COINBASE_PRODUCTS_PATH = "api/v3/brokerage/market/products"; // via /extapi (cf. coinbase.ts)
const MEXC_TICKER_URL = "/mexcapi/api/v3/ticker/24hr"; // via proxy (cf. vite.config.ts)
const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr";
const OKX_TICKERS_URL = "https://www.okx.com/api/v5/market/tickers?instType=SPOT";
/** Ticker d'UN instrument (~240 o) : la liste SPOT entière pèse ~120 Ko gzip. */
const OKX_TICKER_URL = "https://www.okx.com/api/v5/market/ticker";
const BYBIT_TICKERS_URL = "https://api.bybit.com/v5/market/tickers?category=spot";
const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
/** Bases dont l'altname REST Kraken diffère du ticker courant (Bitcoin=XBT, Dogecoin=XDG). */
const KRAKEN_REST_BASE: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };

/** Ne transforme jamais null, chaîne vide ou booléen en donnée financière. */
function finiteNumber(value: unknown): number | undefined {
  if ((typeof value !== "string" && typeof value !== "number") || value === "" || (typeof value === "string" && value.trim() === "")) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function quoteVolumeNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function changeSince(price: number, previous: unknown): number {
  const reference = positiveNumber(previous);
  const pct = reference === undefined ? NaN : ((price - reference) / reference) * 100;
  return Number.isFinite(pct) ? pct : NaN;
}

/** OKX SPOT : volCcy24h est déjà le volume quote, vol24h est le volume base. */
async function fetchOkxTickers(symbols: string[], signal?: AbortSignal): Promise<TickerUpdate[]> {
  const byInstrument = new Map<string, string>();
  for (const symbol of symbols) {
    try {
      const { base, quote } = splitSymbol(symbol.replace("-", "/"), "OKX");
      byInstrument.set(`${base}-${quote}`, symbol);
    } catch { /* Symbole hors du marché spot. */ }
  }
  if (!byInstrument.size) return [];
  // Un instrument inconnu répond code 51001 (HTTP 200) : écarté ci-dessous comme la liste.
  const seul = byInstrument.size === 1 ? [...byInstrument.keys()][0] : undefined;
  const res = await fetch(seul ? `${OKX_TICKER_URL}?${new URLSearchParams({ instId: seul })}` : OKX_TICKERS_URL, { signal });
  if (!res.ok) throw new Error(`OKX ticker ${res.status}`);
  const json = await res.json() as { code?: string; data?: Array<{ instId?: string; instType?: string; last?: string; open24h?: string; volCcy24h?: string }> };
  if (json?.code !== "0" || !Array.isArray(json.data)) return [];
  return json.data.flatMap((row) => {
    const symbol = byInstrument.get(row?.instId ?? "");
    const price = positiveNumber(row?.last);
    if (!symbol || price === undefined || (row.instType && row.instType !== "SPOT")) return [];
    return [{ symbol, price, changePercent: changeSince(price, row.open24h), quoteVolume: quoteVolumeNumber(row.volCcy24h) }];
  });
}

/** Bybit SPOT : turnover24h est le volume quote ; aucune conversion base × dernier prix. */
async function fetchBybitTickers(symbols: string[], signal?: AbortSignal): Promise<TickerUpdate[]> {
  const requested = new Map(symbols.map((symbol) => [symbol.toUpperCase(), symbol]));
  const res = await fetch(BYBIT_TICKERS_URL, { signal });
  if (!res.ok) throw new Error(`Bybit ticker ${res.status}`);
  const json = await res.json() as { retCode?: number; result?: { category?: string; list?: Array<{ symbol?: string; lastPrice?: string; prevPrice24h?: string; turnover24h?: string }> } };
  if (json?.retCode !== 0 || json.result?.category !== "spot" || !Array.isArray(json.result.list)) return [];
  return json.result.list.flatMap((row) => {
    const symbol = requested.get(row?.symbol ?? "");
    const price = positiveNumber(row?.lastPrice);
    if (!symbol || price === undefined) return [];
    return [{ symbol, price, changePercent: changeSince(price, row.prevPrice24h), quoteVolume: quoteVolumeNumber(row.turnover24h) }];
  });
}

async function fetchHlInfo(body: object, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(HL_INFO_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`Hyperliquid ticker ${res.status}`);
  return res.json();
}

/**
 * Contexte HL groupé, puis dernier trade réel par coin (recentTrades, tri par time).
 * La variation compare ce dernier trade à prevDayPx ; dayNtlVlm est le notionnel
 * fourni par HL. Le markPx et le midPx ne deviennent jamais un dernier prix échangé.
 */
async function fetchHyperliquidTickers(symbols: string[], signal?: AbortSignal): Promise<TickerUpdate[]> {
  const json = await fetchHlInfo({ type: "metaAndAssetCtxs" }, signal) as [
    { universe?: Array<{ name?: string; isDelisted?: boolean }> },
    Array<{ prevDayPx?: string; dayNtlVlm?: string }>,
  ];
  if (!Array.isArray(json) || !Array.isArray(json[0]?.universe) || !Array.isArray(json[1])) return [];
  const universe = json[0].universe;
  const settled = await Promise.all(symbols.map(async (symbol): Promise<TickerUpdate | null> => {
    const base = basePerp(symbol);
    const index = universe.findIndex((entry) => entry?.name?.toUpperCase() === base && !entry.isDelisted);
    const coin = universe[index]?.name;
    if (!coin || signal?.aborted) return null;
    const trades = await fetchHlInfo({ type: "recentTrades", coin }, signal) as Array<{ coin?: string; px?: string; time?: number }>;
    if (!Array.isArray(trades)) return null;
    const latest = trades.filter((t) => t?.coin === coin && positiveNumber(t.px) !== undefined && positiveNumber(t.time) !== undefined)
      .sort((a, b) => Number(b.time) - Number(a.time))[0];
    const price = positiveNumber(latest?.px);
    if (price === undefined) return null;
    const ctx = json[1][index];
    return { symbol, price, changePercent: changeSince(price, ctx?.prevDayPx), quoteVolume: quoteVolumeNumber(ctx?.dayNtlVlm) };
  }).map((pending) => pending.catch(() => null)));
  return settled.filter((value): value is TickerUpdate => value !== null);
}

/**
 * Ticker Kraken pour UN symbole. `c[0]` = dernier prix, `o` = ouverture du JOUR (la variation
 * est donc « depuis 00:00 UTC », approximation de la variation 24 h — suffisant pour la liste).
 * Renvoie null (sans lever) si le symbole est inconnu / la réponse illisible.
 */
async function fetchKrakenTicker(symbol: string, signal?: AbortSignal): Promise<TickerUpdate | null> {
  let altname: string;
  try {
    const { base, quote } = splitSymbol(symbol, "Kraken");
    altname = `${KRAKEN_REST_BASE[base] ?? base}${quote}`;
  } catch {
    return null; // cotation non reconnue → pas de prix (reste « — »)
  }
  const res = await fetch(`${KRAKEN_TICKER_URL}?${new URLSearchParams({ pair: altname })}`, { signal });
  if (!res.ok) throw new Error(`Kraken Ticker ${res.status} ${res.statusText}`);
  const data = (await res.json()) as {
    error?: string[];
    result?: Record<string, { c?: string[]; o?: string }>;
  };
  if (data.error && data.error.length > 0) return null; // paire inconnue de Kraken
  const result = data.result ?? {};
  const key = Object.keys(result)[0]; // Kraken renvoie la clé canonique (≠ altname) → 1re clé
  if (key === undefined) return null;
  const t = result[key];
  const last = positiveNumber(t?.c?.[0]);
  if (last === undefined) return null;
  const open = Number(t?.o);
  const changePercent = Number.isFinite(open) && open !== 0 ? ((last - open) / open) * 100 : 0;
  return { symbol, price: last, changePercent };
}

/**
 * Ticker Coinbase GROUPÉ : un seul appel market/products?product_ids=… pour tout le lot.
 * `price_percentage_change_24h` est une variation en POURCENTAGE (ex. "2.34" = 2,34 %).
 * Les symboles absents de la réponse (inconnus) restent simplement à « — ».
 */
async function fetchCoinbaseTickers(symbols: string[], signal?: AbortSignal): Promise<TickerUpdate[]> {
  const byProduct = new Map<string, string>(); // product_id -> symbole d'entrée
  const params = new URLSearchParams();
  for (const s of symbols) {
    try {
      const { base, quote } = splitSymbol(s, "Coinbase");
      const pid = `${base}-${quote}`;
      byProduct.set(pid, s);
      params.append("product_ids", pid);
    } catch {
      /* cotation non reconnue → ignoré (reste « — ») */
    }
  }
  if (byProduct.size === 0) return [];
  const res = await fetch(extUrl("api.coinbase.com", `${COINBASE_PRODUCTS_PATH}?${params}`), { signal });
  if (!res.ok) throw new Error(`Coinbase products ${res.status} ${res.statusText}`);
  const data = (await res.json()) as {
    products?: Array<{ product_id?: string; price?: string; price_percentage_change_24h?: string }>;
  };
  const out: TickerUpdate[] = [];
  for (const p of data.products ?? []) {
    const sym = p.product_id ? byProduct.get(p.product_id) : undefined;
    if (sym === undefined) continue;
    const price = positiveNumber(p.price);
    if (price === undefined) continue;
    const pct = Number(p.price_percentage_change_24h);
    out.push({ symbol: sym, price, changePercent: Number.isFinite(pct) ? pct : 0 });
  }
  return out;
}

/**
 * Ticker MEXC pour UN symbole (API spot v3 compatible Binance → `priceChangePercent`
 * déjà en pourcentage). Renvoie null (sans lever) si le symbole est inconnu / illisible.
 */
async function fetchSpotTicker(symbol: string, signal?: AbortSignal, url = MEXC_TICKER_URL): Promise<TickerUpdate | null> {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase() });
  const res = await fetch(`${url}?${params}`, { signal });
  if (!res.ok) return null; // 400 MEXC pour un symbole inconnu → pas de prix
  const t = (await res.json()) as {
    symbol?: string;
    lastPrice?: string;
    priceChangePercent?: string;
    quoteVolume?: string;
  };
  const price = positiveNumber(t?.lastPrice);
  if (price === undefined || (t.symbol !== undefined && t.symbol !== symbol.toUpperCase())) return null;
  return {
    symbol,
    price,
    changePercent: finiteNumber(t.priceChangePercent) ?? NaN,
    quoteVolume: quoteVolumeNumber(t.quoteVolume),
  };
}

/** Snapshot de la même provenance que le flux, partagé par le poller et la sonde. */
async function fetchTickerSnapshots(source: WatchlistSource, symbols: string[], signal?: AbortSignal): Promise<TickerUpdate[]> {
  if (signal?.aborted) return [];
  if (source === "coinbase") return fetchCoinbaseTickers(symbols, signal);
  if (source === "okx") return fetchOkxTickers(symbols, signal);
  if (source === "bybit") return fetchBybitTickers(symbols, signal);
  if (source === "hyperliquid") return fetchHyperliquidTickers(symbols, signal);
  if (source === "twelvedata") {
    // Sonde seule (pollTradfiQuotes a son garde) : marché fermé, aucun crédit ni créneau 8/min.
    // Abandonnée en attente de créneau, elle quitte la file du quota sans rien consommer.
    const now = new Date();
    const open = symbols.filter((symbol) => isMarketOpen(classifyTradfi(symbol), now));
    return open.length === 0 ? [] : (await fetchQuotes(open, { signal })).filter((q) => positiveNumber(q.price) !== undefined);
  }
  if (source !== "kraken" && source !== "mexc" && source !== "binance") return [];
  const settled = await Promise.all(symbols.map((symbol) => (
    source === "kraken" ? fetchKrakenTicker(symbol, signal) : fetchSpotTicker(symbol, signal, source === "binance" ? BINANCE_TICKER_URL : MEXC_TICKER_URL)
  ).catch(() => null)));
  return settled.filter((u): u is TickerUpdate => u !== null);
}

/** Borne aussi les APIs qui ne propagent pas encore AbortSignal (catalogue). */
function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T | undefined> {
  if (parent?.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const controller = new AbortController();
    let finished = false;
    const finish = (value?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      parent?.removeEventListener("abort", cancel);
      controller.abort();
      resolve(value);
    };
    const cancel = () => finish();
    const timer = setTimeout(cancel, timeoutMs);
    parent?.addEventListener("abort", cancel, { once: true });
    try { void work(controller.signal).then(finish, cancel); }
    catch { cancel(); }
  });
}

/**
 * Confirme un candidat par un prix > 0 de CET instrument avant de mémoriser sa source.
 * 2,5 s par sonde, 30 s au total : catalogue (12 s) + six places spot (15 s).
 * Aucun résultat après annulation ;
 * une source spéculative ne reste pas marquée ainsi une fois son prix réellement reçu.
 * `catalog` : celui que l'appelant a déjà reçu ; la sonde ne relance alors pas le
 * rafraîchissement commun (dont la republication relancerait les sondes de l'appelant).
 */
export function resolveTickerMarket(
  identity: { exchange?: ExchangeId; symbol: string; timeframe: Timeframe },
  signal?: AbortSignal,
  catalog?: MarketCatalog,
): Promise<ResolvedMarket | undefined> {
  return bounded(async (active) => {
    const candidates = await resolveMarketCandidates(identity, catalog);
    for (const candidate of candidates) {
      if (active.aborted) return undefined;
      if (!isTickerSource(candidate.exchange)) continue;
      const quotes = await bounded((probe) => fetchTickerSnapshots(candidate.exchange, [candidate.symbol], probe), 2_500, active);
      if (active.aborted) return undefined;
      if (quotes?.some((quote) => quote.symbol === candidate.symbol && positiveNumber(quote.price) !== undefined)) {
        return { exchange: candidate.exchange, symbol: candidate.symbol, timeframe: candidate.timeframe };
      }
    }
    return undefined;
  }, 30_000, signal);
}

/** Poller REST mutualisé (une boucle par source) pour les tickers crypto Kraken/Coinbase/MEXC. */
function pollCryptoTickers(
  source: "kraken" | "coinbase" | "mexc" | "okx" | "bybit" | "hyperliquid",
  symbols: string[],
  cb: (update: TickerUpdate) => void
): Unsubscribe {
  if (symbols.length === 0) return () => {};
  return pollLoop(
    async (signal, isCancelled) => {
      const updates = await fetchTickerSnapshots(source, symbols, signal);
      if (isCancelled()) return;
      for (const u of updates) cb(u);
    },
    CRYPTO_TICKER_POLL_MS,
    { immediate: true }
  );
}

/**
 * Polling /quote groupé pour les symboles tradfi (Twelve Data), GATÉ sur les heures de
 * marché. Chaque cycle ne requête QUE les symboles dont le marché est plausiblement ouvert
 * (isMarketOpen) ; si aucun n'est ouvert, aucun appel réseau n'est émis (économie de quota)
 * et l'état « marché fermé » est signalé au registre santé (etat 'polling' + note) plutôt
 * que laissé croire à une panne. Au retour d'une fermeture, le cycle suivant refait un appel
 * (latence ≤ un intervalle de polling).
 */
function pollTradfiQuotes(symbols: string[], cb: (update: TickerUpdate) => void): Unsubscribe {
  if (symbols.length === 0) return () => {};

  return pollLoop(
    async (signal, isCancelled) => {
      const now = new Date();
      const open = symbols.filter((s) => isMarketOpen(classifyTradfi(s), now));
      if (open.length === 0) {
        // Marché fermé (nuit / week-end) : pas d'appel Twelve Data. On signale l'état via le
        // registre santé — SanteSource n'a pas de champ « note », on emploie derniereErreur
        // comme porteur d'info tout en gardant l'état 'polling' (donc pas flaggé « panne »).
        healthStore.getState().setEtat(TRADFI_HEALTH, "polling", {
          dernierMessageTs: Date.now(),
          derniereErreur: "marché fermé — polling tradfi en pause jusqu'à l'ouverture",
        });
        return;
      }
      // Désabonné en attente de créneau (bandeau d'un actif quitté) : la cotation quitte la file.
      const quotes = await fetchQuotes(open, { signal });
      if (isCancelled()) return;
      for (const q of quotes) cb(q); // { symbol, price, changePercent } — même forme que le ticker
      healthStore.getState().setEtat(TRADFI_HEALTH, "polling", {
        dernierMessageTs: Date.now(),
        derniereErreur: undefined, // efface une éventuelle note « marché fermé » précédente
      });
    },
    TRADFI_POLL_MS,
    {
      immediate: true, // premier rafraîchissement immédiat (et re-vérif d'ouverture)
      onError: (err) => healthStore.getState().marquerErreur(TRADFI_HEALTH, errText(err)),
    }
  );
}

export interface SubscribeTickersOptions {
  /**
   * Force tous les symboles de CET abonnement vers cette source. Sans valeur, le routage
   * historique reste inchangé : provenance watchlist par symbole, puis inférence.
   */
  source?: WatchlistSource;
}

/** Fabrique les groupes de routage sans effet de bord réseau (PURE, testée). */
export function groupTickerSymbolsBySource(
  symbols: readonly string[],
  sourcesBySymbol: Readonly<Record<string, WatchlistSource>>,
  forcedSource?: WatchlistSource,
): Record<WatchlistSource, string[]> {
  const groups: Record<WatchlistSource, string[]> = {
    binance: [],
    kraken: [],
    coinbase: [],
    mexc: [],
    twelvedata: [],
    bybit: [],
    okx: [],
    hyperliquid: [],
    synthetic: [],
  };
  for (const symbol of symbols) {
    groups[resolveTickerSource(symbol, forcedSource ?? sourcesBySymbol[symbol])].push(symbol);
  }
  return groups;
}

/**
 * Souscrit aux tickers des `symbols`. Par défaut, chacun est routé depuis sa provenance
 * watchlist ou confirmé par une sonde de prix. `options.source` permet à un consommateur lié à un marché
 * précis (le bandeau du chart) de forcer exactement cette source sans dépendre de la watchlist.
 * `cb` est invoquée à chaque mise à jour. Renvoie le désabonnement de tous les flux.
 */
export function subscribeTickers(
  symbols: string[],
  cb: (update: TickerUpdate) => void,
  options: SubscribeTickersOptions = {},
): Unsubscribe {
  if (symbols.length === 0) return () => {};

  const explicit = watchlistStore.getState().sources;
  const known = symbols.filter((symbol) => options.source !== undefined || explicit[symbol] !== undefined);
  const groups = groupTickerSymbolsBySource(known, explicit, options.source);

  // Binance : WS combiné. On écarte tout symbole à « / » qui casserait l'URL du stream.
  const binanceWs = groups.binance.filter((s) => !s.includes("/"));

  const unsubs: Unsubscribe[] = [
    subscribeBinanceTickers(binanceWs, cb),
    pollCryptoTickers("kraken", groups.kraken, cb),
    pollCryptoTickers("coinbase", groups.coinbase, cb),
    pollCryptoTickers("mexc", groups.mexc, cb),
    pollCryptoTickers("okx", groups.okx, cb),
    pollCryptoTickers("bybit", groups.bybit, cb),
    pollCryptoTickers("hyperliquid", groups.hyperliquid, cb),
    pollTradfiQuotes(groups.twelvedata, cb),
  ];

  // Les consommateurs hors watchlist bénéficient aussi de la résolution automatique.
  // Aucune socket Binance spéculative ; la source forcée, elle, reste exacte et immédiate.
  for (const symbol of symbols.filter((s) => !known.includes(s))) {
    let resolved = false;
    unsubs.push(pollLoop(async (signal, isCancelled) => {
      if (resolved) return;
      const market = await resolveTickerMarket({ symbol, timeframe: "1h" }, signal);
      if (!market || isCancelled()) return;
      resolved = true;
      unsubs.push(subscribeTickers([market.symbol], (update) => cb({ ...update, symbol }), { source: market.exchange }));
    }, CRYPTO_TICKER_POLL_MS, { immediate: true }));
  }

  return () => {
    for (const u of unsubs) u();
  };
}

// ───────── Statistiques enrichies (Δ% 1h / 7j + sparkline 24 h) — refresh LENT ─────────
//
// Ces colonnes ne justifient PAS un flux temps réel par symbole : elles sont dérivées d'un
// FETCH klines horaires léger, joué à l'ajout puis rafraîchi toutes les 5 min (roadmap 1.4).
// Un seul appel `/klines?interval=1h&limit=169` par symbole Binance couvre les trois métriques :
//   - Δ% 1h  = dernière clôture vs la clôture ~1 h avant (approximation à la bougie horaire) ;
//   - Δ% 7j  = dernière clôture vs la clôture ~168 h avant ;
//   - sparkline = les 24 dernières clôtures horaires.

/** Nombre d'heures dans 7 jours (référence de la variation 7 j). */
const HOURS_7D = 168;
/** Points de la sparkline (dernières 24 h en horaire). */
const SPARK_POINTS = 24;
/** Limite du fetch horaire : 7 j d'historique + l'heure courante (poids Binance = 2). */
const HOURLY_KLINE_LIMIT = HOURS_7D + 1;
/** Cadence LENTE du rafraîchissement des statistiques enrichies (5 min). */
const WATCHLIST_BARS_POLL_MS = 300_000;

/** Statistiques enrichies d'un symbole, dérivées des klines horaires. */
export interface BarStats {
  /** Variation ~1 h en % (null si données insuffisantes). */
  change1h: number | null;
  /** Variation ~7 j en % (null si moins de 7 j d'historique). */
  change7d: number | null;
  /** Clôtures horaires récentes (≤ 24 points) pour la sparkline. */
  spark: number[];
}

/** BarStats + le symbole concerné (payload émis par le poller). */
export interface WatchlistBars extends BarStats {
  symbol: string;
}

/** Variation en % de `ref` à `cur` (null si `ref` invalide/nul). PURE. */
function pctChange(cur: number, ref: number | undefined): number | null {
  if (ref === undefined || ref === 0 || !Number.isFinite(ref) || !Number.isFinite(cur)) return null;
  return ((cur - ref) / ref) * 100;
}

/**
 * Dérive Δ% 1h / 7j + les points de sparkline d'une série de bougies HORAIRES (chronologique).
 * Renvoie null si moins de 2 bougies. `change7d` est null tant qu'il n'y a pas 7 j d'historique
 * (actif récemment listé). PURE & testée (ticker.test.ts).
 */
export function computeBarStats(hourly: Candle[]): BarStats | null {
  const closes = hourly.map((c) => c.close).filter((v) => Number.isFinite(v));
  const n = closes.length;
  if (n < 2) return null;
  const last = closes[n - 1];
  if (last === undefined) return null;
  const idx7d = n - 1 - HOURS_7D;
  return {
    change1h: pctChange(last, closes[n - 2]),
    change7d: pctChange(last, idx7d >= 0 ? closes[idx7d] : undefined),
    spark: closes.slice(-SPARK_POINTS),
  };
}

/**
 * Rafraîchit les statistiques sur les klines de la provenance confirmée (5 min).
 * Sans provenance, la même sonde de prix que le ticker tranche avant tout backfill.
 */
export function subscribeWatchlistBars(
  symbols: string[],
  cb: (bars: WatchlistBars) => void
): Unsubscribe {
  const explicit = watchlistStore.getState().sources;
  const markets = new Map<string, ResolvedMarket>();
  const eligible = symbols.filter((symbol) => !estSymboleCapitalisation(symbol) && !symbol.includes("|"));
  for (const symbol of eligible) {
    const exchange = explicit[symbol];
    if (exchange && isTickerSource(exchange)) markets.set(symbol, { exchange, symbol, timeframe: "1h" });
  }
  if (eligible.length === 0) return () => {};

  return pollLoop(
    async (signal, isCancelled) => {
      // Une erreur par symbole ne doit pas faire échouer tout le lot → catch individuel.
      const results = await Promise.all(
        eligible.map(async (symbol) => {
          const market = markets.get(symbol) ?? await resolveTickerMarket({ symbol, timeframe: "1h" }, signal);
          if (!market || isCancelled()) return null;
          markets.set(symbol, market);
          if (market.exchange === "twelvedata" && !isMarketOpen(classifyTradfi(symbol), new Date())) return null;
          const klines = await getAdapter(market.exchange).fetchKlines(market.symbol, "1h", { limit: HOURLY_KLINE_LIMIT });
          return { symbol, stats: computeBarStats(klines) };
        }).map((pending) => pending.catch(() => null))
      );
      if (isCancelled()) return;
      for (const r of results) {
        if (r && r.stats) cb({ symbol: r.symbol, ...r.stats });
      }
    },
    WATCHLIST_BARS_POLL_MS,
    // Δ% 1h/7j + sparkline : affichage seul (aucune alerte ne les consomme) → suspendable
    // onglet masqué. Les pollers de PRIX ci-dessus restent actifs (alertes prix-croise).
    { immediate: true, suspendreSiMasque: true }
  );
}
