/**
 * Adaptateur Bybit (spot) — implémente IExchangeAdapter (@axiom/types).
 *
 * Format de symbole (ENTRÉE) : style Binance concaténé, ex. "BTCUSDT". Bybit spot
 *   utilise EXACTEMENT ce format natif → passage direct (aucun découpage base/quote).
 *
 * Timeframes : Bybit couvre tout le natif court→long, y compris 2h/6h/12h.
 *   1m..30m en minutes, 1h→60, 2h→120, 4h→240, 6h→360, 12h→720, 1d→D, 1w→W, 1M→M.
 *   Les autres tf (secondes, 3m/3d, 3M+) lèvent une erreur.
 *
 * Limites notables :
 *   - REST /v5/market/kline : `list` renvoyée en ordre DÉCROISSANT (plus récent
 *     d'abord) → on inverse en ascendant. `end` (ms) supporté pour la pagination.
 *   - WS kline : drapeau `confirm` = bougie clôturée (pas d'heuristique nécessaire).
 *   - WS publicTrade : `S` = côté de l'AGRESSEUR (taker) → mappé DIRECTEMENT.
 *   - OHLC ne fournit pas les volumes acheteur/vendeur (delta indisponible via kline).
 *
 * CORS : api.bybit.com et stream.bybit.com renvoient `Access-Control-Allow-Origin: *`
 *   → appel DIRECT depuis le navigateur, pas de proxy.
 *
 * Sources (API Bybit v5) :
 *   - REST kline : https://bybit-exchange.github.io/docs/v5/market/kline
 *   - WS kline   : https://bybit-exchange.github.io/docs/v5/websocket/public/kline
 *   - WS trade   : https://bybit-exchange.github.io/docs/v5/websocket/public/trade
 */
import type { Candle, IExchangeAdapter, Timeframe, Trade, Unsubscribe } from "@axiom/types";
import { connectWsLoop } from "./wsLoop";

const REST_KLINE_URL = "https://api.bybit.com/v5/market/kline";
const WS_URL = "wss://stream.bybit.com/v5/public/spot";

/** Fenêtre re-fetchée au resync post-reconnexion (comble les bougies manquées). */
const RESYNC_KLINE_LIMIT = 500;

/** tf @axiom -> intervalle Bybit (string, cf. doc v5). */
const BYBIT_INTERVAL: Partial<Record<Timeframe, string>> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "12h": "720",
  "1d": "D",
  "1w": "W",
  "1M": "M",
};

/** Durée d'un tf en millisecondes (pour déduire `closed` côté REST). */
const BYBIT_TF_MS: Partial<Record<Timeframe, number>> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000, // approximation (30 j) : sert uniquement au flag closed
};

/** Intervalle Bybit pour un tf, ou erreur si non supporté. */
function bybitInterval(tf: Timeframe): string {
  const interval = BYBIT_INTERVAL[tf];
  if (interval === undefined) {
    throw new Error(`Bybit: timeframe '${tf}' non supporté (supportés: ${Object.keys(BYBIT_INTERVAL).join(", ")})`);
  }
  return interval;
}

/** Tuple brut d'une bougie REST /v5/market/kline (ordre figé par l'API Bybit). */
type BybitKlineEntry = [
  string, // 0  startTime (ms)
  string, // 1  open
  string, // 2  high
  string, // 3  low
  string, // 4  close
  string, // 5  volume (base)
  string, // 6  turnover (quote)
];

interface BybitKlineResponse {
  retCode: number;
  retMsg: string;
  result?: { list?: BybitKlineEntry[] };
}

/** Bougie du flux WS `kline.<interval>.<symbol>`. */
interface BybitWsKline {
  start: number; // open time (ms)
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
  confirm: boolean; // true = bougie clôturée
}

/** Trade du flux WS `publicTrade.<symbol>`. `S` = côté de l'AGRESSEUR (taker). */
export interface BybitWsTrade {
  T: number; // timestamp (ms)
  s: string; // symbole
  S: "Buy" | "Sell"; // côté taker
  v: string; // qty (base)
  p: string; // prix
}

interface BybitWsEnvelope<T> {
  topic?: string;
  data?: T;
}

/** REST -> Candle. `closed` déduit du dépassement d'intervalle. */
function bybitRestKlineToCandle(k: BybitKlineEntry, tfMs: number): Candle {
  const time = Number(k[0]);
  return {
    time,
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closed: time + tfMs <= Date.now(),
  };
}

/** WS kline -> Candle (le drapeau `confirm` porte la clôture). */
function bybitWsKlineToCandle(k: BybitWsKline): Candle {
  return {
    time: k.start,
    open: Number(k.open),
    high: Number(k.high),
    low: Number(k.low),
    close: Number(k.close),
    volume: Number(k.volume),
    closed: k.confirm,
  };
}

/**
 * WS publicTrade -> Trade. `S` Bybit = agresseur (taker) -> mappage DIRECT.
 * PURE & testée — fige la convention contre une régression silencieuse du signe.
 */
export function bybitWsTradeToTrade(t: BybitWsTrade): Trade {
  return {
    time: t.T,
    price: Number(t.p),
    qty: Number(t.v),
    side: t.S === "Buy" ? "buy" : "sell",
  };
}

export const bybitAdapter: IExchangeAdapter = {
  id: "bybit",

  async fetchKlines(symbol, tf, opts) {
    const interval = bybitInterval(tf);
    const params = new URLSearchParams({
      category: "spot",
      symbol: symbol.toUpperCase(),
      interval,
      limit: String(opts?.limit ?? 500),
    });
    if (opts?.endTime !== undefined) params.set("end", String(opts.endTime));

    const res = await fetch(`${REST_KLINE_URL}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Bybit REST ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as BybitKlineResponse;
    if (data.retCode !== 0) {
      throw new Error(`Bybit kline: ${data.retMsg} (retCode ${data.retCode})`);
    }
    const list = data.result?.list ?? [];
    const tfMs = BYBIT_TF_MS[tf] ?? 0;
    // Bybit renvoie la liste en ordre DÉCROISSANT → inversion en ascendant.
    return list
      .slice()
      .reverse()
      .map((k) => bybitRestKlineToCandle(k, tfMs));
  },

  subscribeKline(symbol, tf, cb, onResync?: (candles: Candle[]) => void) {
    const interval = bybitInterval(tf); // lève tôt si tf non supporté
    const topic = `kline.${interval}.${symbol.toUpperCase()}`;
    const sub = JSON.stringify({ op: "subscribe", args: [topic] });

    const onReconnected = onResync
      ? () => {
          bybitAdapter
            .fetchKlines(symbol, tf, { limit: RESYNC_KLINE_LIMIT })
            .then((candles) => onResync(candles))
            .catch((err) => console.error("[AXIOM] resync kline Bybit échoué", err));
        }
      : undefined;

    return connectWsLoop({
      url: WS_URL,
      source: "bybit",
      onReconnected,
      onOpen: (ws) => ws.send(sub),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data) as BybitWsEnvelope<BybitWsKline[]>;
          if (msg.topic === topic && msg.data) {
            for (const k of msg.data) cb(bybitWsKlineToCandle(k));
            return true; // message de données (≠ ack/pong)
          }
        } catch (err) {
          console.error("[AXIOM] Message WS Bybit (kline) illisible", err);
        }
        return false;
      },
    });
  },

  subscribeTrades(symbol, cb): Unsubscribe {
    const topic = `publicTrade.${symbol.toUpperCase()}`;
    const sub = JSON.stringify({ op: "subscribe", args: [topic] });

    return connectWsLoop({
      url: WS_URL,
      source: "bybit:trades",
      onOpen: (ws) => ws.send(sub),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data) as BybitWsEnvelope<BybitWsTrade[]>;
          if (msg.topic === topic && msg.data) {
            for (const t of msg.data) cb(bybitWsTradeToTrade(t));
            return true; // message de données (≠ ack/pong)
          }
        } catch (err) {
          console.error("[AXIOM] Message WS Bybit (trade) illisible", err);
        }
        return false;
      },
    });
  },
};
