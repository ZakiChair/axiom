/**
 * Flux ticker Binance (24 h) pour la watchlist.
 *
 * Un seul WebSocket « combiné » pour l'ensemble des symboles suivis :
 *   wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/...
 * Chaque message livre le dernier prix (`c`) et la variation 24 h en % (`P`).
 * Reconnexion à backoff exponentiel (même politique que data/binance.ts).
 *
 * Mises à jour HAUTE fréquence : l'appelant les écrit IMPÉRATIVEMENT dans le DOM
 * (aucun state React), conformément au BUILD-CONTRACT.
 */
import type { Unsubscribe } from "@axiom/types";

const WS_STREAM_BASE = "wss://stream.binance.com:9443/stream";

/** Donnée minimale exposée à la watchlist. */
export interface TickerUpdate {
  symbol: string; // ex. "BTCUSDT"
  price: number; // dernier prix
  changePercent: number; // variation 24 h en %
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

/**
 * Souscrit aux tickers des `symbols` donnés. `cb` est invoquée à chaque mise à
 * jour. Renvoie une fonction de désabonnement (ferme le WS, stoppe la reconnexion).
 */
export function subscribeTickers(
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
