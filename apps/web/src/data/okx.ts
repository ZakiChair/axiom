/**
 * Adaptateur OKX (spot) — implémente IExchangeAdapter (@axiom/types).
 *
 * Format de symbole (ENTRÉE) : style Binance concaténé "BTCUSDT" → instId OKX
 *   "BASE-QUOTE" ("BTC-USDT") via splitSymbol (suffixe de cotation reconnu).
 *
 * Timeframes : 1m/5m/15m/30m (minutes minuscules), 1h→1H, 2h→2H, 4h→4H, 6h→6H,
 *   12h→12H, 1d→1D, 1w→1W, 1M→1M (heure/jour+ en MAJUSCULE côté OKX).
 *
 * Limites notables :
 *   - REST /market/candles : `data` en ordre DÉCROISSANT → inversion en ascendant.
 *     9e champ `confirm` : "1" = bougie clôturée, "0" = en cours. `after` (ts ms)
 *     pagine vers le passé (bougies plus anciennes que ts) → sert à opts.endTime.
 *   - WS candle : le canal est `candle<bar>` (ex. "candle1H"). Le `confirm` du tuple
 *     porte la clôture (pas d'heuristique).
 *   - WS trades : `side` = côté de l'AGRESSEUR (taker) → mappé DIRECTEMENT.
 *   - OHLC ne fournit pas les volumes acheteur/vendeur (delta indisponible via candle).
 *   - OKX ferme la socket après ~30 s sans donnée serveur ; sur symbole calme, la
 *     reconnexion de wsLoop prend le relais (dégradation acceptable).
 *
 * CORS : www.okx.com et ws.okx.com renvoient `Access-Control-Allow-Origin: *`
 *   → appel DIRECT, pas de proxy.
 *
 * Sources (API OKX v5) :
 *   - REST candles : https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks
 *   - WS candle    : https://www.okx.com/docs-v5/en/#public-data-websocket-candlesticks-channel
 *   - WS trades    : https://www.okx.com/docs-v5/en/#public-data-websocket-trades-channel
 */
import type { Candle, IExchangeAdapter, Timeframe, Trade, Unsubscribe } from "@axiom/types";
import { splitSymbol } from "./symbol";
import { connectWsLoop } from "./wsLoop";

const REST_CANDLES_URL = "https://www.okx.com/api/v5/market/candles";
const WS_URL = "wss://ws.okx.com:8443/ws/v5/public";

/** Fenêtre re-fetchée au resync post-reconnexion. */
const RESYNC_KLINE_LIMIT = 300;

/** tf @axiom -> `bar` OKX. */
const OKX_BAR: Partial<Record<Timeframe, string>> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "2h": "2H",
  "4h": "4H",
  "6h": "6H",
  "12h": "12H",
  "1d": "1D",
  "1w": "1W",
  "1M": "1M",
};

/** instId OKX (ex. "BTCUSDT" -> "BTC-USDT"). */
function okxInstId(symbol: string): string {
  const { base, quote } = splitSymbol(symbol, "OKX");
  return `${base}-${quote}`;
}

/** `bar` OKX pour un tf, ou erreur si non supporté. */
function okxBar(tf: Timeframe): string {
  const bar = OKX_BAR[tf];
  if (bar === undefined) {
    throw new Error(`OKX: timeframe '${tf}' non supporté (supportés: ${Object.keys(OKX_BAR).join(", ")})`);
  }
  return bar;
}

/**
 * Tuple brut d'une bougie (REST et WS partagent le format) :
 * [ts, o, h, l, c, vol(base), volCcy, volCcyQuote, confirm].
 */
type OkxCandleEntry = [string, string, string, string, string, string, string, string, string];

interface OkxCandlesResponse {
  code: string;
  msg: string;
  data?: OkxCandleEntry[];
}

/** Trade du flux WS `trades`. `side` = côté de l'AGRESSEUR (taker). */
export interface OkxWsTrade {
  instId: string;
  tradeId: string;
  px: string;
  sz: string;
  side: "buy" | "sell";
  ts: string;
}

interface OkxWsEnvelope<T> {
  arg?: { channel?: string; instId?: string };
  data?: T;
  event?: string; // "subscribe"|"error" pour les acks
}

/** Tuple OHLC -> Candle. Le 9e champ `confirm` ("1"/"0") porte la clôture. */
function okxCandleToCandle(k: OkxCandleEntry): Candle {
  return {
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closed: k[8] === "1",
  };
}

/**
 * WS trades -> Trade. `side` OKX = agresseur (taker) -> mappage DIRECT.
 * PURE & testée — fige la convention contre une régression silencieuse du signe.
 */
export function okxWsTradeToTrade(t: OkxWsTrade): Trade {
  return {
    time: Number(t.ts),
    price: Number(t.px),
    qty: Number(t.sz),
    side: t.side,
  };
}

export const okxAdapter: IExchangeAdapter = {
  id: "okx",

  async fetchKlines(symbol, tf, opts) {
    const bar = okxBar(tf);
    const params = new URLSearchParams({
      instId: okxInstId(symbol),
      bar,
      limit: String(opts?.limit ?? 300),
    });
    // OKX `after` = bougies STRICTEMENT plus anciennes que ce ts (pagination passé).
    if (opts?.endTime !== undefined) params.set("after", String(opts.endTime));

    const res = await fetch(`${REST_CANDLES_URL}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`OKX REST ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as OkxCandlesResponse;
    if (data.code !== "0") {
      throw new Error(`OKX candles: ${data.msg} (code ${data.code})`);
    }
    const rows = data.data ?? [];
    // OKX renvoie en ordre DÉCROISSANT → inversion en ascendant.
    return rows
      .slice()
      .reverse()
      .map((k) => okxCandleToCandle(k));
  },

  subscribeKline(symbol, tf, cb, onResync?: (candles: Candle[]) => void) {
    const bar = okxBar(tf); // lève tôt si tf non supporté
    const instId = okxInstId(symbol);
    const channel = `candle${bar}`;
    const sub = JSON.stringify({ op: "subscribe", args: [{ channel, instId }] });

    const onReconnected = onResync
      ? () => {
          okxAdapter
            .fetchKlines(symbol, tf, { limit: RESYNC_KLINE_LIMIT })
            .then((candles) => onResync(candles))
            .catch((err) => console.error("[AXIOM] resync kline OKX échoué", err));
        }
      : undefined;

    return connectWsLoop({
      url: WS_URL,
      source: "okx",
      onReconnected,
      onOpen: (ws) => ws.send(sub),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data) as OkxWsEnvelope<OkxCandleEntry[]>;
          if (msg.arg?.channel === channel && msg.arg.instId === instId && msg.data) {
            for (const k of msg.data) cb(okxCandleToCandle(k));
            return true; // message de données (≠ ack/error)
          }
        } catch (err) {
          console.error("[AXIOM] Message WS OKX (candle) illisible", err);
        }
        return false;
      },
    });
  },

  subscribeTrades(symbol, cb): Unsubscribe {
    const instId = okxInstId(symbol);
    const sub = JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId }] });

    return connectWsLoop({
      url: WS_URL,
      source: "okx:trades",
      onOpen: (ws) => ws.send(sub),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data) as OkxWsEnvelope<OkxWsTrade[]>;
          if (msg.arg?.channel === "trades" && msg.arg.instId === instId && msg.data) {
            for (const t of msg.data) cb(okxWsTradeToTrade(t));
            return true; // message de données (≠ ack/error)
          }
        } catch (err) {
          console.error("[AXIOM] Message WS OKX (trades) illisible", err);
        }
        return false;
      },
    });
  },
};
