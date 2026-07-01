/**
 * Flux ticker pour la watchlist — ROUTÉ PAR SOURCE d'origine de chaque symbole
 * (roadmap 0.4b). La source vient du store watchlist (explicite) ou est inférée :
 *  - binance    : WebSocket « combiné » temps réel (prix `c` + variation 24 h `P`) ;
 *  - kraken     : POLLING REST /0/public/Ticker (30 s), 1 requête par symbole ;
 *  - coinbase   : POLLING REST market/products GROUPÉ (30 s), 1 requête pour le lot ;
 *  - mexc       : POLLING REST /ticker/24hr (30 s, via proxy), 1 requête par symbole ;
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
import type { Unsubscribe } from "@axiom/types";
import { fetchQuotes } from "./twelvedata";
import { TWELVEDATA_SYMBOLS } from "./pairs";
import { pollLoop } from "./pollLoop";
import { splitSymbol } from "./symbol";
import { watchlistStore, type WatchlistSource } from "../store/watchlist";
import { healthStore } from "../store/health";

const WS_STREAM_BASE = "wss://stream.binance.com:9443/stream";
/** Cadence du polling tradfi (données Twelve Data différées → 60 s économise le quota). */
const TRADFI_POLL_MS = 60_000;
/** Cadence du polling ticker des exchanges crypto sans WS ticker câblé ici (léger). */
const CRYPTO_TICKER_POLL_MS = 30_000;
/** Clé du registre santé pour le poller de quotes tradfi (cf. store/health.ts). */
const TRADFI_HEALTH = "twelvedata:quotes";

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
  return isTradfiSymbol(symbol) ? "twelvedata" : "binance";
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
  changePercent: number; // variation en %
}

/** Payload @ticker (champs utiles uniquement). */
interface BinanceTicker {
  s: string; // symbole
  c: string; // dernier prix
  P: string; // variation 24 h en %
}

interface BinanceStreamMessage {
  stream: string;
  data: BinanceTicker;
}

/** Souscription ticker Binance (crypto) — WebSocket combiné + reconnexion backoff. */
function subscribeBinanceTickers(
  symbols: string[],
  cb: (update: TickerUpdate) => void
): Unsubscribe {
  if (symbols.length === 0) return () => {};

  const streams = symbols.map((s) => `${s.toLowerCase()}@ticker`).join("/");
  const url = `${WS_STREAM_BASE}?streams=${streams}`;

  let ws: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    ws = new WebSocket(url);

    ws.onopen = () => {
      attempt = 0; // succès => on remet le backoff à zéro.
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as BinanceStreamMessage;
        const d = msg.data;
        if (!d || typeof d.s !== "string") return;
        cb({ symbol: d.s, price: Number(d.c), changePercent: Number(d.P) });
      } catch (err) {
        console.error("[AXIOM] Message ticker Binance illisible", err);
      }
    };

    // Une erreur ferme la socket, ce qui déclenche onclose -> reconnexion.
    ws.onerror = () => {
      ws?.close();
    };

    ws.onclose = () => {
      if (closedByUser) return;
      // Backoff exponentiel plafonné à 30 s : 1s, 2s, 4s, 8s, ... 30s.
      const delay = Math.min(30_000, 1_000 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };
  };

  connect();

  return () => {
    closedByUser = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

// ───────── Pollers ticker REST des exchanges crypto (Kraken / Coinbase / MEXC) ─────────

const KRAKEN_TICKER_URL = "https://api.kraken.com/0/public/Ticker";
const COINBASE_PRODUCTS_URL = "https://api.coinbase.com/api/v3/brokerage/market/products";
const MEXC_TICKER_URL = "/mexcapi/api/v3/ticker/24hr"; // via proxy (cf. vite.config.ts)
/** Bases dont l'altname REST Kraken diffère du ticker courant (Bitcoin=XBT, Dogecoin=XDG). */
const KRAKEN_REST_BASE: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };

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
  const last = Number(t?.c?.[0]);
  if (!Number.isFinite(last)) return null;
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
  const res = await fetch(`${COINBASE_PRODUCTS_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`Coinbase products ${res.status} ${res.statusText}`);
  const data = (await res.json()) as {
    products?: Array<{ product_id?: string; price?: string; price_percentage_change_24h?: string }>;
  };
  const out: TickerUpdate[] = [];
  for (const p of data.products ?? []) {
    const sym = p.product_id ? byProduct.get(p.product_id) : undefined;
    if (sym === undefined) continue;
    const price = Number(p.price);
    if (!Number.isFinite(price)) continue;
    const pct = Number(p.price_percentage_change_24h);
    out.push({ symbol: sym, price, changePercent: Number.isFinite(pct) ? pct : 0 });
  }
  return out;
}

/**
 * Ticker MEXC pour UN symbole (API spot v3 compatible Binance → `priceChangePercent`
 * déjà en pourcentage). Renvoie null (sans lever) si le symbole est inconnu / illisible.
 */
async function fetchMexcTicker(symbol: string, signal?: AbortSignal): Promise<TickerUpdate | null> {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase() });
  const res = await fetch(`${MEXC_TICKER_URL}?${params}`, { signal });
  if (!res.ok) return null; // 400 MEXC pour un symbole inconnu → pas de prix
  const t = (await res.json()) as { lastPrice?: string; priceChangePercent?: string };
  const price = Number(t.lastPrice);
  if (!Number.isFinite(price)) return null;
  const pct = Number(t.priceChangePercent);
  return { symbol, price, changePercent: Number.isFinite(pct) ? pct : 0 };
}

/** Poller REST mutualisé (une boucle par source) pour les tickers crypto Kraken/Coinbase/MEXC. */
function pollCryptoTickers(
  source: "kraken" | "coinbase" | "mexc",
  symbols: string[],
  cb: (update: TickerUpdate) => void
): Unsubscribe {
  if (symbols.length === 0) return () => {};
  return pollLoop(
    async (signal, isCancelled) => {
      let updates: TickerUpdate[];
      if (source === "coinbase") {
        updates = await fetchCoinbaseTickers(symbols, signal); // groupé
      } else {
        const fetchOne = source === "kraken" ? fetchKrakenTicker : fetchMexcTicker;
        // Une erreur par symbole ne doit pas faire échouer tout le lot → catch individuel.
        const settled = await Promise.all(symbols.map((s) => fetchOne(s, signal).catch(() => null)));
        updates = settled.filter((u): u is TickerUpdate => u !== null);
      }
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
    async (_signal, isCancelled) => {
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
      const quotes = await fetchQuotes(open);
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

/**
 * Souscrit aux tickers des `symbols`, en ROUTANT chacun vers sa source (résolue depuis le
 * store watchlist ou inférée). `cb` est invoquée à chaque mise à jour. Renvoie une fonction
 * de désabonnement qui stoppe tous les flux.
 */
export function subscribeTickers(
  symbols: string[],
  cb: (update: TickerUpdate) => void
): Unsubscribe {
  if (symbols.length === 0) return () => {};

  const explicit = watchlistStore.getState().sources;
  const groups: Record<WatchlistSource, string[]> = {
    binance: [],
    kraken: [],
    coinbase: [],
    mexc: [],
    twelvedata: [],
  };
  for (const s of symbols) {
    groups[resolveTickerSource(s, explicit[s])].push(s);
  }

  // Binance : WS combiné. On écarte tout symbole à « / » qui casserait l'URL du stream.
  const binanceWs = groups.binance.filter((s) => !s.includes("/"));

  const unsubs: Unsubscribe[] = [
    subscribeBinanceTickers(binanceWs, cb),
    pollCryptoTickers("kraken", groups.kraken, cb),
    pollCryptoTickers("coinbase", groups.coinbase, cb),
    pollCryptoTickers("mexc", groups.mexc, cb),
    pollTradfiQuotes(groups.twelvedata, cb),
  ];

  return () => {
    for (const u of unsubs) u();
  };
}
