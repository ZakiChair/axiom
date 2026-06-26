/**
 * Adaptateur Coinbase Advanced Trade (spot) — implémente IExchangeAdapter (@axiom/types).
 *
 * Format de symbole attendu (ENTRÉE) : style Binance concaténé, ex. "BTCUSDT", "ETHUSD".
 *   On découpe base/quote via une liste de devises de cotation (suffixe le plus long d'abord), puis :
 *   - product_id Coinbase `${base}-${quote}` (ex. "BTC-USDT", "BTC-USD", "ETH-USD").
 *   On NE réécrit PAS USDT→USD : "BTCUSDT" devient "BTC-USDT" (marché potentiellement plus mince
 *   ou absent vs le marché USD attendu — arbitrage laissé au sélecteur de source). Coinbase
 *   utilise "BTC" (pas "XBT").
 *
 * Timeframes :
 *   - REST candles : 1m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 1d (PAS de 1w/3d/12h/secondes).
 *   - WS `candles` : granularité FIXE 5 min, SANS paramètre d'intervalle (cf. doc) -> inutilisable
 *     pour un tf arbitraire. subscribeKline agrège donc le flux `market_trades` en bougies du tf
 *     demandé : honore tous les tf REST ci-dessus et fournit en prime le delta buy/sell.
 *
 * Authentification : flux marché PUBLIC, AUCUN JWT requis (on omet simplement le champ `jwt`).
 *
 * Limites notables :
 *   - REST candles : 350 bougies max ; start/end requis (UNIX secondes) -> calculés depuis limit+tf.
 *   - market_trades : `side` = côté du MAKER -> on INVERSE pour obtenir l'agresseur (taker).
 *   - Bougies live agrégées : open/high/low/close/volume/delta issus des trades LIVE uniquement
 *     (l'historique vient du backfill REST) ; la clôture est posée au franchissement de bucket.
 *     NB : la 1re bougie en cours au moment de l'abonnement peut sous-compter le volume (rejoint
 *     en milieu de bucket) jusqu'au prochain franchissement — transitoire, se corrige tout seul.
 *
 * Sources (API Coinbase Advanced Trade) :
 *   - REST candles     : https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/public/get-public-product-candles
 *   - WS overview/auth  : https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview
 *   - WS channels       : https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels
 */
import type { Candle, IExchangeAdapter, Timeframe, Trade, Unsubscribe } from "@axiom/types";

const REST_CANDLES_BASE = "https://api.coinbase.com/api/v3/brokerage/market/products";
const WS_URL = "wss://advanced-trade-ws.coinbase.com";

/** Devises de cotation reconnues, suffixe le plus LONG d'abord (4 caractères avant 3). */
const QUOTE_ASSETS = ["USDT", "USDC", "USDD", "TUSD", "DAI", "USD", "EUR", "GBP", "BTC", "ETH"];

/** tf @axiom -> granularité Coinbase (enum string) + durée en secondes (sous-ensemble supporté). */
const COINBASE_GRAN: Partial<Record<Timeframe, { gran: string; sec: number }>> = {
  "1m": { gran: "ONE_MINUTE", sec: 60 },
  "5m": { gran: "FIVE_MINUTE", sec: 300 },
  "15m": { gran: "FIFTEEN_MINUTE", sec: 900 },
  "30m": { gran: "THIRTY_MINUTE", sec: 1800 },
  "1h": { gran: "ONE_HOUR", sec: 3600 },
  "2h": { gran: "TWO_HOUR", sec: 7200 },
  "4h": { gran: "FOUR_HOUR", sec: 14400 },
  "6h": { gran: "SIX_HOUR", sec: 21600 },
  "1d": { gran: "ONE_DAY", sec: 86400 },
};

/** Découpe "BTCUSDT" -> { base:"BTC", quote:"USDT" } (suffixe de cotation le plus long). */
function splitSymbol(symbol: string): { base: string; quote: string } {
  const s = symbol.toUpperCase();
  const quote = QUOTE_ASSETS.find((q) => s.endsWith(q) && s.length > q.length);
  if (quote === undefined) {
    throw new Error(`Coinbase: format de symbole inattendu '${symbol}' (devise de cotation inconnue)`);
  }
  return { base: s.slice(0, s.length - quote.length), quote };
}

/** product_id Coinbase (ex. "BTCUSDT" -> "BTC-USDT"). */
function coinbaseProduct(symbol: string): string {
  const { base, quote } = splitSymbol(symbol);
  return `${base}-${quote}`;
}

/** Granularité Coinbase pour un tf, ou erreur si non supporté. */
function coinbaseGran(tf: Timeframe): { gran: string; sec: number } {
  const g = COINBASE_GRAN[tf];
  if (g === undefined) {
    throw new Error(`Coinbase: timeframe '${tf}' non supporté (supportés: ${Object.keys(COINBASE_GRAN).join(", ")})`);
  }
  return g;
}

/** Bougie REST `candles` (toutes les valeurs sont des chaînes ; start = UNIX secondes). */
interface CoinbaseRestCandle {
  start: string;
  low: string;
  high: string;
  open: string;
  close: string;
  volume: string;
}

interface CoinbaseCandlesResponse {
  candles?: CoinbaseRestCandle[];
}

/** Trade du flux WS `market_trades`. `side` = côté du MAKER (BUY/SELL). */
interface CoinbaseWsTrade {
  trade_id: string;
  product_id: string;
  price: string;
  size: string;
  side: "BUY" | "SELL";
  time: string; // ISO 8601
}

/** Évènement d'un message WS (snapshot/update) — `trades` présent pour le canal market_trades. */
interface CoinbaseWsEvent {
  type?: string; // "snapshot" | "update"
  trades?: CoinbaseWsTrade[];
}

/** Enveloppe d'un message WS Advanced Trade (les acks `subscriptions` n'ont pas d'`events` trades). */
interface CoinbaseWsEnvelope {
  channel?: string;
  events?: CoinbaseWsEvent[];
}

/** REST -> Candle. `closed` déduit : start + durée de granularité déjà dépassés. */
function coinbaseRestCandleToCandle(c: CoinbaseRestCandle, granSec: number): Candle {
  const time = Number(c.start) * 1000;
  return {
    time,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
    closed: time + granSec * 1000 <= Date.now(),
  };
}

/**
 * WS market_trades -> Trade. Doc Coinbase : `side` = côté du MAKER. L'agresseur (taker) est l'INVERSE :
 *   side="BUY"  (maker acheteur) => agresseur VENDEUR  => "sell"
 *   side="SELL" (maker vendeur)  => agresseur ACHETEUR => "buy"
 * (Sémantique contestée dans l'écosystème ; on suit la doc officielle. Inverser ici si infirmé empiriquement.)
 */
function coinbaseWsTradeToTrade(t: CoinbaseWsTrade): Trade {
  return {
    time: Date.parse(t.time),
    price: Number(t.price),
    qty: Number(t.size),
    side: t.side === "BUY" ? "sell" : "buy",
  };
}

/**
 * Abonnement interne au canal WS public `market_trades` (sans JWT). Émet des Trade agresseur.
 * Réutilisé par subscribeTrades (brut) et par subscribeKline (agrégation en bougies).
 * On IGNORE le snapshot (replay d'historique) : seuls les trades LIVE comptent, pour ne pas
 * fausser le CVD/footprint (parité avec Binance @aggTrade / Kraken snapshot:false).
 */
function subscribeMarketTrades(symbol: string, cb: (t: Trade) => void): Unsubscribe {
  const productId = coinbaseProduct(symbol);
  const sub = JSON.stringify({ type: "subscribe", product_ids: [productId], channel: "market_trades" });

  let ws: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      attempt = 0; // succès => on remet le backoff à zéro.
      ws?.send(sub);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as CoinbaseWsEnvelope;
        if (msg.channel === "market_trades" && msg.events) {
          for (const e of msg.events) {
            if (e.type !== "update" || !e.trades) continue; // live uniquement (pas le snapshot)
            // Coinbase agrège ~250 ms de trades par message, ordre NON garanti (souvent récent->ancien).
            // Tri ascendant : indispensable pour que `close` (dépendant de l'ordre) reste correct.
            const batch = [...e.trades].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
            for (const t of batch) cb(coinbaseWsTradeToTrade(t));
          }
        }
      } catch (err) {
        console.error("[AXIOM] Message WS Coinbase (market_trades) illisible", err);
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

export const coinbaseAdapter: IExchangeAdapter = {
  id: "coinbase",

  async fetchKlines(symbol, tf, opts) {
    const { gran, sec } = coinbaseGran(tf);
    const limit = Math.min(opts?.limit ?? 350, 350);
    // start/end sont REQUIS (UNIX secondes). On borne la fenêtre à exactement `limit` bougies.
    const endSec = opts?.endTime !== undefined ? Math.floor(opts.endTime / 1000) : Math.floor(Date.now() / 1000);
    const startSec = endSec - limit * sec;
    const params = new URLSearchParams({
      granularity: gran,
      start: String(startSec),
      end: String(endSec),
      limit: String(limit),
    });

    const res = await fetch(`${REST_CANDLES_BASE}/${coinbaseProduct(symbol)}/candles?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Coinbase REST ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as CoinbaseCandlesResponse;
    const rows = data.candles ?? [];
    // Coinbase renvoie les bougies de la plus récente à la plus ancienne -> tri ascendant attendu par le chart.
    return rows.map((c) => coinbaseRestCandleToCandle(c, sec)).sort((a, b) => a.time - b.time);
  },

  // Le canal WS `candles` est FIXE à 5 min : on agrège le flux market_trades en bougies du tf demandé.
  subscribeKline(symbol, tf, cb) {
    const { sec } = coinbaseGran(tf); // valide le tf + fournit la largeur du bucket
    const tfMs = sec * 1000;

    let bucketStart: number | null = null;
    let cur: Candle | null = null;

    const onTrade = (t: Trade) => {
      const start = Math.floor(t.time / tfMs) * tfMs;
      if (cur === null || (bucketStart !== null && start > bucketStart)) {
        if (cur !== null) cb({ ...cur, closed: true }); // clôture du bucket précédent
        cur = {
          time: start,
          open: t.price,
          high: t.price,
          low: t.price,
          close: t.price,
          volume: t.qty,
          buyVolume: t.side === "buy" ? t.qty : 0,
          sellVolume: t.side === "sell" ? t.qty : 0,
          trades: 1,
          closed: false,
        };
        bucketStart = start;
      } else {
        cur.high = Math.max(cur.high, t.price);
        cur.low = Math.min(cur.low, t.price);
        cur.close = t.price;
        cur.volume += t.qty;
        cur.buyVolume = (cur.buyVolume ?? 0) + (t.side === "buy" ? t.qty : 0);
        cur.sellVolume = (cur.sellVolume ?? 0) + (t.side === "sell" ? t.qty : 0);
        cur.trades = (cur.trades ?? 0) + 1;
      }
      cb({ ...cur }); // copie : on ne diffuse jamais la référence mutée en interne
    };

    return subscribeMarketTrades(symbol, onTrade);
  },

  // Flux tick WS public `market_trades` (M5 orderflow : CVD + footprint).
  subscribeTrades(symbol, cb): Unsubscribe {
    return subscribeMarketTrades(symbol, cb);
  },
};
