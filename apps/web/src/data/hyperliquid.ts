/**
 * Adaptateur Hyperliquid (perp DEX) — implémente IExchangeAdapter (@axiom/types).
 *
 * Hyperliquid est un DEX de perpétuels margés USDC : les marchés sont désignés par
 * un NOM DE COIN ("BTC", "ETH", "SOL"…), pas un couple base/quote. On accepte en
 * ENTRÉE le style Binance concaténé ("BTCUSDT") et on en extrait la base ("BTC") =
 * le coin Hyperliquid (via splitSymbol, qui retire le suffixe de cotation).
 *
 * Spécificités vs les adaptateurs CEX :
 *   - REST = POST unique `/info` (corps JSON), PAS un GET à query. `candleSnapshot`
 *     exige une fenêtre [startTime, endTime] (ms) ; on la dérive de `limit` × durée.
 *     Réponse déjà en ordre ASCENDANT.
 *   - WS candle : le message livre UNE bougie qui se met à jour ; AUCUN drapeau de
 *     clôture → on déduit la clôture au passage d'intervalle (comme Kraken).
 *   - WS trades : `side` = "B" (agresseur acheteur) / "A" (agresseur vendeur, ask).
 *   - Timeframes : 1m/5m/15m/30m/1h/2h/4h/12h/1d/1w/1M (PAS de 6h côté HL).
 *
 * CORS : api.hyperliquid.xyz renvoie `Access-Control-Allow-Origin: *` → appel DIRECT.
 *
 * Sources (API Hyperliquid) :
 *   - REST info : https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
 *   - WS        : https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket
 */
import type { Candle, IExchangeAdapter, Timeframe, Trade, Unsubscribe } from "@axiom/types";
import { splitSymbol } from "./symbol";
import { connectWsLoop } from "./wsLoop";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const WS_URL = "wss://api.hyperliquid.xyz/ws";

/** Fenêtre re-fetchée au resync post-reconnexion. */
const RESYNC_KLINE_LIMIT = 500;

/** tf @axiom -> intervalle Hyperliquid (chaîne native). PAS de 6h côté HL. */
const HL_INTERVAL: Partial<Record<Timeframe, string>> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "2h": "2h",
  "4h": "4h",
  "12h": "12h",
  "1d": "1d",
  "1w": "1w",
  "1M": "1M",
};

/** Durée d'un tf en millisecondes (calcul de la fenêtre candleSnapshot). */
const HL_TF_MS: Partial<Record<Timeframe, number>> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000, // approximation (30 j) pour dimensionner la fenêtre
};

/** Coin Hyperliquid depuis un symbole d'entrée (ex. "BTCUSDT" -> "BTC"). */
function hlCoin(symbol: string): string {
  return splitSymbol(symbol, "Hyperliquid").base;
}

/** Intervalle HL pour un tf, ou erreur si non supporté. */
function hlInterval(tf: Timeframe): string {
  const interval = HL_INTERVAL[tf];
  if (interval === undefined) {
    throw new Error(`Hyperliquid: timeframe '${tf}' non supporté (supportés: ${Object.keys(HL_INTERVAL).join(", ")})`);
  }
  return interval;
}

/** Bougie renvoyée par candleSnapshot / le flux WS `candle`. */
interface HlCandle {
  t: number; // open time (ms)
  T: number; // close time (ms)
  s: string; // coin
  i: string; // interval
  o: string;
  c: string;
  h: string;
  l: string;
  v: string; // volume (base/coin)
  n: number; // nombre de trades
}

/** Trade du flux WS `trades`. `side` = "B" (agresseur acheteur) / "A" (vendeur/ask). */
export interface HlWsTrade {
  coin: string;
  side: "B" | "A";
  px: string;
  sz: string;
  time: number; // ms
}

interface HlWsEnvelope<T> {
  channel?: string;
  data?: T;
}

/** HlCandle -> Candle. `closed` posé par l'appelant (REST) ou l'émetteur WS. */
function hlCandleToCandle(k: HlCandle, closed: boolean): Candle {
  return {
    time: k.t,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    trades: k.n,
    closed,
  };
}

/**
 * WS trades -> Trade. `side` HL : "B" = agresseur acheteur, "A" = agresseur vendeur.
 * PURE & testée — fige la convention contre une régression silencieuse du signe.
 */
export function hlWsTradeToTrade(t: HlWsTrade): Trade {
  return {
    time: t.time,
    price: Number(t.px),
    qty: Number(t.sz),
    side: t.side === "B" ? "buy" : "sell",
  };
}

export const hyperliquidAdapter: IExchangeAdapter = {
  id: "hyperliquid",

  async fetchKlines(symbol, tf, opts) {
    const interval = hlInterval(tf);
    const coin = hlCoin(symbol);
    const tfMs = HL_TF_MS[tf] ?? 60_000;
    const limit = opts?.limit ?? 500;
    const endTime = opts?.endTime ?? Date.now();
    const startTime = endTime - limit * tfMs;

    const res = await fetch(INFO_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } }),
    });
    if (!res.ok) {
      throw new Error(`Hyperliquid REST ${res.status} ${res.statusText}`);
    }
    const rows = (await res.json()) as HlCandle[];
    if (!Array.isArray(rows)) {
      throw new Error(`Hyperliquid candleSnapshot: réponse illisible pour ${coin}`);
    }
    // Déjà en ordre ascendant ; la dernière bougie peut être en cours (non clôturée).
    const now = Date.now();
    return rows.map((k) => hlCandleToCandle(k, k.T <= now));
  },

  subscribeKline(symbol, tf, cb, onResync?: (candles: Candle[]) => void) {
    const interval = hlInterval(tf); // lève tôt si tf non supporté
    const coin = hlCoin(symbol);
    const sub = JSON.stringify({
      method: "subscribe",
      subscription: { type: "candle", coin, interval },
    });

    // HL ne marque pas la clôture : on la déduit au passage d'intervalle (cf. Kraken).
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
          hyperliquidAdapter
            .fetchKlines(symbol, tf, { limit: RESYNC_KLINE_LIMIT })
            .then((candles) => onResync(candles))
            .catch((err) => console.error("[AXIOM] resync kline Hyperliquid échoué", err));
        }
      : undefined;

    return connectWsLoop({
      url: WS_URL,
      source: "hyperliquid",
      onReconnected,
      onOpen: (ws) => ws.send(sub),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data) as HlWsEnvelope<HlCandle>;
          if (msg.channel === "candle" && msg.data && msg.data.s === coin) {
            emit(hlCandleToCandle(msg.data, false));
            return true; // message de données
          }
        } catch (err) {
          console.error("[AXIOM] Message WS Hyperliquid (candle) illisible", err);
        }
        return false;
      },
    });
  },

  subscribeTrades(symbol, cb): Unsubscribe {
    const coin = hlCoin(symbol);
    const sub = JSON.stringify({
      method: "subscribe",
      subscription: { type: "trades", coin },
    });

    return connectWsLoop({
      url: WS_URL,
      source: "hyperliquid:trades",
      onOpen: (ws) => ws.send(sub),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data) as HlWsEnvelope<HlWsTrade[]>;
          if (msg.channel === "trades" && Array.isArray(msg.data)) {
            for (const t of msg.data) {
              if (t.coin === coin) cb(hlWsTradeToTrade(t));
            }
            return true; // message de données
          }
        } catch (err) {
          console.error("[AXIOM] Message WS Hyperliquid (trades) illisible", err);
        }
        return false;
      },
    });
  },
};
