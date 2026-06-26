/**
 * Adaptateur Binance (spot) — implémente IExchangeAdapter (@axiom/types).
 *
 * - fetchKlines : backfill REST initial (/api/v3/klines, ~500 bougies).
 * - subscribeKline : flux WS temps réel (@kline_<tf>) avec reconnexion à backoff exponentiel.
 * - subscribeTrades : flux WS @aggTrade (M5 orderflow : CVD + footprint).
 * - fetchSymbolInfo : tickSize du symbole (bucketisation du footprint).
 */
import type { Candle, IExchangeAdapter, Trade, Unsubscribe } from "@axiom/types";

const REST_KLINES_URL = "https://api.binance.com/api/v3/klines";
const REST_EXCHANGE_INFO_URL = "https://api.binance.com/api/v3/exchangeInfo";
const WS_BASE_URL = "wss://stream.binance.com:9443/ws";

/** Tuple brut renvoyé par /api/v3/klines (ordre figé par l'API Binance). */
type BinanceRestKline = [
  number, // 0  open time (ms)
  string, // 1  open
  string, // 2  high
  string, // 3  low
  string, // 4  close
  string, // 5  volume (base)
  number, // 6  close time (ms)
  string, // 7  quote asset volume
  number, // 8  nombre de trades
  string, // 9  taker buy base volume (volume agressif acheteur)
  string, // 10 taker buy quote volume
  string, // 11 champ ignoré
];

/** Bougie issue du flux WS @kline (stream simple, non combiné). */
interface BinanceWsKline {
  t: number; // open time (ms)
  T: number; // close time (ms)
  s: string; // symbole
  i: string; // intervalle
  o: string; // open
  c: string; // close
  h: string; // high
  l: string; // low
  v: string; // volume base
  n: number; // nombre de trades
  x: boolean; // true => bougie clôturée
  q: string; // quote volume
  V: string; // taker buy base volume
  Q: string; // taker buy quote volume
}

interface BinanceWsKlineMessage {
  e: string;
  E: number;
  s: string;
  k: BinanceWsKline;
}

/** Payload du flux WS @aggTrade (champs utiles uniquement). */
interface BinanceAggTrade {
  e: "aggTrade";
  E: number; // event time
  s: string; // symbole
  a: number; // id du trade agrégé
  p: string; // prix
  q: string; // quantité (base)
  T: number; // trade time (ms)
  m: boolean; // true => l'ACHETEUR est MAKER (donc l'agresseur/taker est VENDEUR)
}

/** Métadonnées de marché d'un symbole (sous-ensemble de SymbolInfo). */
export interface BinanceSymbolMeta {
  tickSize: number; // pas de prix natif (PRICE_FILTER)
  pricePrecision: number; // nombre de décimales de prix
}

/** REST -> Candle. La dernière bougie peut être en cours (closeTime futur). */
function restKlineToCandle(k: BinanceRestKline): Candle {
  const volume = Number(k[5]);
  const buyVolume = Number(k[9]);
  return {
    time: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume,
    quoteVolume: Number(k[7]),
    buyVolume,
    sellVolume: volume - buyVolume,
    trades: k[8],
    closed: k[6] < Date.now(),
  };
}

/** WS -> Candle (closed = k.x). */
function wsKlineToCandle(k: BinanceWsKline): Candle {
  const volume = Number(k.v);
  const buyVolume = Number(k.V);
  return {
    time: k.t,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume,
    quoteVolume: Number(k.q),
    buyVolume,
    sellVolume: volume - buyVolume,
    trades: k.n,
    closed: k.x,
  };
}

/**
 * aggTrade -> Trade. Convention agresseur (taker) :
 *  - m=true  => l'acheteur est MAKER => l'agresseur est VENDEUR  => side="sell"
 *  - m=false => l'agresseur est ACHETEUR                          => side="buy"
 * (NE PAS inverser : voir la spec Binance `isBuyerMaker`.)
 */
function aggTradeToTrade(a: BinanceAggTrade): Trade {
  return {
    time: a.T,
    price: Number(a.p),
    qty: Number(a.q),
    side: a.m ? "sell" : "buy",
  };
}

/** Compte les décimales d'un pas de prix textuel ("0.01000000" -> 2). */
function decimalsFromTick(tick: string): number {
  const trimmed = tick.replace(/0+$/, "");
  const dot = trimmed.indexOf(".");
  return dot < 0 ? 0 : trimmed.length - dot - 1;
}

/**
 * Récupère le tickSize (PRICE_FILTER) du symbole via /exchangeInfo.
 * Sert à bucketiser le footprint au pas de prix natif. Lève si indisponible
 * (l'appelant prévoit un repli basé sur la magnitude du prix).
 */
export async function fetchSymbolInfo(symbol: string): Promise<BinanceSymbolMeta> {
  const res = await fetch(`${REST_EXCHANGE_INFO_URL}?symbol=${symbol.toUpperCase()}`);
  if (!res.ok) {
    throw new Error(`Binance exchangeInfo ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    symbols?: Array<{ filters?: Array<{ filterType: string; tickSize?: string }> }>;
  };
  const sym = data.symbols?.[0];
  const priceFilter = sym?.filters?.find((f) => f.filterType === "PRICE_FILTER");
  const tickStr = priceFilter?.tickSize;
  const tickSize = tickStr !== undefined ? Number(tickStr) : NaN;
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    throw new Error(`tickSize introuvable pour ${symbol}`);
  }
  return { tickSize, pricePrecision: decimalsFromTick(tickStr ?? "") };
}

export const binanceAdapter: IExchangeAdapter = {
  id: "binance",

  async fetchKlines(symbol, tf, opts) {
    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      interval: tf,
      limit: String(opts?.limit ?? 500),
    });
    if (opts?.endTime !== undefined) params.set("endTime", String(opts.endTime));

    const res = await fetch(`${REST_KLINES_URL}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Binance REST ${res.status} ${res.statusText}`);
    }
    const raw = (await res.json()) as BinanceRestKline[];
    return raw.map(restKlineToCandle);
  },

  subscribeKline(symbol, tf, cb) {
    const url = `${WS_BASE_URL}/${symbol.toLowerCase()}@kline_${tf}`;
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
          const msg = JSON.parse(ev.data as string) as BinanceWsKlineMessage;
          if (msg.k) cb(wsKlineToCandle(msg.k));
        } catch (err) {
          console.error("[AXIOM] Message WS Binance illisible", err);
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
  },

  // Flux tick @aggTrade (M5) : alimente le footprint. Même politique de reconnexion
  // à backoff exponentiel que subscribeKline.
  subscribeTrades(symbol, cb): Unsubscribe {
    const url = `${WS_BASE_URL}/${symbol.toLowerCase()}@aggTrade`;
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
          const msg = JSON.parse(ev.data as string) as BinanceAggTrade;
          if (msg.e === "aggTrade") cb(aggTradeToTrade(msg));
        } catch (err) {
          console.error("[AXIOM] Message aggTrade Binance illisible", err);
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
  },
};
