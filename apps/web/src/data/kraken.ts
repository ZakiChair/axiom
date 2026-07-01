/**
 * Adaptateur Kraken (spot) — implémente IExchangeAdapter (@axiom/types).
 *
 * Format de symbole attendu (ENTRÉE) : style Binance concaténé, ex. "BTCUSDT", "ETHUSD".
 *   On découpe base/quote via une liste de devises de cotation (suffixe le plus long d'abord), puis :
 *   - REST  : altname Kraken `${base}${quote}` avec BTC→XBT, DOGE→XDG  (ex. "XBTUSD", "XBTUSDT").
 *   - WS v2 : tickers communs `${base}/${quote}`                       (ex. "BTC/USD", "BTC/USDT").
 *     IMPORTANT : Kraken WS v2 utilise "BTC" (pas "XBT"). La réponse REST OHLC est lue via la
 *     première clé non-"last" du `result`, donc l'altname exact importe peu (le canonique peut
 *     différer, ex. "XBTUSD" -> clé "XXBTZUSD").
 *
 * Timeframes supportés : 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w.
 *   Kraken n'a NI 2h, NI 6h, NI 12h, NI 3m/3d/1M, NI secondes -> les autres tf lèvent une erreur.
 *
 * Limites notables :
 *   - REST /0/public/OHLC : ~720 bougies max, PAS de paramètre endTime (seulement `since`).
 *     -> opts.endTime est IGNORÉ ; opts.limit tronque la queue (bougies les plus récentes).
 *   - WS v2 ohlc : aucun drapeau "clôturée" -> clôture déduite au passage d'intervalle (heuristique).
 *   - WS v2 trade : `side` = côté de l'AGRESSEUR (taker) -> mappé directement, SANS inversion.
 *   - OHLC ne fournit ni quoteVolume ni volumes acheteur/vendeur (delta indisponible via ce flux).
 *
 * Sources (API Kraken) :
 *   - REST OHLC   : https://docs.kraken.com/api/docs/rest-api/get-ohlc-data
 *   - WS v2 OHLC  : https://docs.kraken.com/api/docs/websocket-v2/ohlc
 *   - WS v2 trade : https://docs.kraken.com/api/docs/websocket-v2/trade
 */
import type { Candle, IExchangeAdapter, Timeframe, Trade, Unsubscribe } from "@axiom/types";
import { splitSymbol } from "./symbol";
import { connectWsLoop } from "./wsLoop";

const REST_OHLC_URL = "https://api.kraken.com/0/public/OHLC";
const WS_URL = "wss://ws.kraken.com/v2";

/** Fenêtre re-fetchée au resync post-reconnexion (comble les bougies manquées). */
const RESYNC_KLINE_LIMIT = 500;

/** Bases dont l'altname REST Kraken diffère du ticker courant (Bitcoin=XBT, Dogecoin=XDG). */
const KRAKEN_REST_BASE: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };

/** tf @axiom -> intervalle Kraken en minutes (sous-ensemble supporté). */
const KRAKEN_INTERVAL: Partial<Record<Timeframe, number>> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1w": 10080,
};

/** Altname REST (ex. "BTCUSDT" -> "XBTUSDT"). */
function krakenRestPair(symbol: string): string {
  const { base, quote } = splitSymbol(symbol, "Kraken");
  return `${KRAKEN_REST_BASE[base] ?? base}${quote}`;
}

/** Symbole WS v2 (ex. "BTCUSDT" -> "BTC/USDT"). */
function krakenWsSymbol(symbol: string): string {
  const { base, quote } = splitSymbol(symbol, "Kraken");
  return `${base}/${quote}`;
}

/** Intervalle Kraken en minutes pour un tf, ou erreur si non supporté. */
function krakenInterval(tf: Timeframe): number {
  const minutes = KRAKEN_INTERVAL[tf];
  if (minutes === undefined) {
    throw new Error(`Kraken: timeframe '${tf}' non supporté (supportés: ${Object.keys(KRAKEN_INTERVAL).join(", ")})`);
  }
  return minutes;
}

/** Tuple brut d'une bougie REST /0/public/OHLC (ordre figé par l'API Kraken). */
type KrakenOhlcEntry = [
  number, // 0  open time (secondes)
  string, // 1  open
  string, // 2  high
  string, // 3  low
  string, // 4  close
  string, // 5  vwap
  string, // 6  volume (base)
  number, // 7  count (nombre de trades)
];

/** Réponse REST OHLC : result contient une clé paire (-> tableau de bougies) + "last" (number). */
interface KrakenOhlcResponse {
  error?: string[];
  result?: { [pair: string]: KrakenOhlcEntry[] | number | undefined };
}

/** Bougie issue du flux WS v2 `ohlc` (valeurs numériques, horodatages ISO 8601). */
interface KrakenWsOhlc {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  trades: number;
  volume: number;
  interval_begin: string; // open time (ISO 8601)
  interval: number;
  timestamp: string;
}

/** Trade issu du flux WS v2 `trade`. `side` = côté de l'AGRESSEUR (taker). */
export interface KrakenWsTrade {
  symbol: string;
  side: "buy" | "sell";
  price: number;
  qty: number;
  ord_type: "limit" | "market";
  trade_id: number;
  timestamp: string; // ISO 8601 (RFC3339)
}

/** Enveloppe générique des messages WS v2 (les acks/heartbeats n'ont pas de `data`). */
interface KrakenWsEnvelope<T> {
  channel?: string;
  type?: string; // "snapshot" | "update"
  data?: T[];
}

/** REST -> Candle. `closed` déduit : open time + durée d'intervalle déjà dépassés. */
function krakenRestOhlcToCandle(k: KrakenOhlcEntry, minutes: number): Candle {
  const time = k[0] * 1000;
  return {
    time,
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[6]),
    trades: k[7],
    closed: time + minutes * 60_000 <= Date.now(),
  };
}

/** WS ohlc -> Candle (live ; la clôture est posée par l'appelant au passage d'intervalle). */
function krakenWsOhlcToCandle(o: KrakenWsOhlc): Candle {
  return {
    time: Date.parse(o.interval_begin),
    open: o.open,
    high: o.high,
    low: o.low,
    close: o.close,
    volume: o.volume,
    trades: o.trades,
    closed: false,
  };
}

/**
 * WS trade -> Trade. `side` Kraken = agresseur (taker) -> mappage DIRECT, pas d'inversion.
 * PURE & testée (tradeMapping.test.ts) — fige la convention contre une régression silencieuse du signe.
 */
export function krakenWsTradeToTrade(t: KrakenWsTrade): Trade {
  return {
    time: Date.parse(t.timestamp),
    price: t.price,
    qty: t.qty,
    side: t.side,
  };
}

export const krakenAdapter: IExchangeAdapter = {
  id: "kraken",

  async fetchKlines(symbol, tf, opts) {
    const minutes = krakenInterval(tf);
    const params = new URLSearchParams({
      pair: krakenRestPair(symbol),
      interval: String(minutes),
    });
    // Kraken n'expose que `since` (borne basse), pas d'`endTime` : opts.endTime est ignoré (cf. en-tête).

    const res = await fetch(`${REST_OHLC_URL}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Kraken REST ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as KrakenOhlcResponse;
    if (data.error && data.error.length > 0) {
      throw new Error(`Kraken OHLC: ${data.error.join("; ")}`);
    }
    const result = data.result ?? {};
    const pairKey = Object.keys(result).find((k) => k !== "last");
    if (pairKey === undefined) {
      throw new Error(`Kraken OHLC: aucune paire dans la réponse pour ${symbol}`);
    }
    const rows = result[pairKey];
    if (!Array.isArray(rows)) {
      throw new Error(`Kraken OHLC: données illisibles pour ${symbol}`);
    }
    let candles = rows.map((k) => krakenRestOhlcToCandle(k, minutes));
    // Kraken renvoie jusqu'à ~720 bougies : on tronque la queue pour honorer `limit`.
    const limit = opts?.limit ?? 500;
    if (candles.length > limit) {
      candles = candles.slice(candles.length - limit);
    }
    return candles;
  },

  // `onResync` (4e param optionnel, ABSENT de IExchangeAdapter figé) : rappelé après
  // une reconnexion avec des bougies REST fraîches, que Chart.tsx fusionne au buffer.
  subscribeKline(symbol, tf, cb, onResync?: (candles: Candle[]) => void) {
    const interval = krakenInterval(tf); // lève tôt si tf non supporté
    const wsSymbol = krakenWsSymbol(symbol);
    const sub = JSON.stringify({
      method: "subscribe",
      params: { channel: "ohlc", symbol: [wsSymbol], interval },
    });

    // Kraken n'expose pas de drapeau "clôturée". On déduit la clôture au passage d'intervalle :
    // dès qu'une bougie d'un `interval_begin` plus récent arrive, la précédente est close.
    let prevTime: number | null = null;
    let prevCandle: Candle | null = null;
    const emit = (c: Candle) => {
      if (prevTime !== null && prevCandle !== null && c.time > prevTime) {
        cb({ ...prevCandle, closed: true });
      }
      prevCandle = c;
      prevTime = c.time;
      cb(c);
    };

    const onReconnected = onResync
      ? () => {
          krakenAdapter
            .fetchKlines(symbol, tf, { limit: RESYNC_KLINE_LIMIT })
            .then((candles) => onResync(candles))
            .catch((err) => console.error("[AXIOM] resync kline Kraken échoué", err));
        }
      : undefined;

    return connectWsLoop({
      url: WS_URL,
      source: "kraken",
      onReconnected,
      // Kraken exige la (re)souscription à chaque ouverture ; les heartbeats du canal
      // comptent comme activité (gérés en amont par le watchdog de connectWsLoop).
      onOpen: (ws) => ws.send(sub),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data) as KrakenWsEnvelope<KrakenWsOhlc>;
          if (msg.channel === "ohlc" && msg.data) {
            // Un snapshot peut livrer plusieurs bougies, ordre non garanti -> tri ascendant.
            const batch = [...msg.data].sort(
              (a, b) => Date.parse(a.interval_begin) - Date.parse(b.interval_begin),
            );
            for (const o of batch) emit(krakenWsOhlcToCandle(o));
            return true; // message de données (≠ ack/heartbeat)
          }
        } catch (err) {
          console.error("[AXIOM] Message WS Kraken (ohlc) illisible", err);
        }
        return false;
      },
    });
  },

  // Flux tick WS v2 `trade` (M5 orderflow : CVD + footprint). `snapshot:false` => pas de replay
  // des 50 derniers trades (on ne veut que le live, parité avec Binance @aggTrade).
  subscribeTrades(symbol, cb): Unsubscribe {
    const wsSymbol = krakenWsSymbol(symbol);
    const sub = JSON.stringify({
      method: "subscribe",
      params: { channel: "trade", symbol: [wsSymbol], snapshot: false },
    });

    return connectWsLoop({
      url: WS_URL,
      source: "kraken:trades",
      onOpen: (ws) => ws.send(sub),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data) as KrakenWsEnvelope<KrakenWsTrade>;
          if (msg.channel === "trade" && msg.data) {
            for (const t of msg.data) cb(krakenWsTradeToTrade(t));
            return true; // message de données (≠ ack/heartbeat)
          }
        } catch (err) {
          console.error("[AXIOM] Message WS Kraken (trade) illisible", err);
        }
        return false;
      },
    });
  },
};
