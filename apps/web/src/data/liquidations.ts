/**
 * Liquidations Binance USDⓈ-M — flux WS `<symbol>@forceOrder` (fstream), GRATUIT.
 *
 * Une liquidation forcée est un ordre au marché passé par le moteur de risque :
 *   - o.S = "SELL" → une position LONGUE est fermée de force (vente) → LONG liquidé ;
 *   - o.S = "BUY"  → une position COURTE est fermée de force (rachat) → SHORT liquidé.
 * Cette convention est fixée par un test (comme les côtés taker) : l'inverser
 * fausserait silencieusement l'affichage long/short.
 *
 * ⚠️ Binance throttle le flux à ~1 message / s / symbole : c'est un ÉCHANTILLON des
 * liquidations, pas l'exhaustif (documenté à l'affichage). Flux LIVE only (aucun
 * historique) : on accumule depuis la souscription, comme le footprint/CVD.
 *
 * CORS : fstream est un WebSocket (pas soumis à CORS) → connexion directe, résilience
 * (backoff/watchdog) déléguée à connectWsLoop.
 */
import type { Unsubscribe } from "@axiom/types";
import { connectWsLoop } from "./wsLoop";

const WS_FUTURES_BASE_URL = "wss://fstream.binance.com/ws";

/** Une liquidation normalisée. `side` = côté de la POSITION liquidée. */
export interface Liquidation {
  time: number;
  side: "long" | "short";
  qty: number; // quantité en actif de base
  price: number; // prix d'exécution
  notionalUsd: number; // qty × price (USDT-M → notionnel ≈ USD)
}

/** Objet `o` du message forceOrder (champs utiles). */
interface ForceOrderPayload {
  s?: string; // symbole
  S?: string; // "BUY" | "SELL" (côté de l'ORDRE de liquidation)
  q?: string; // quantité
  p?: string; // prix
  ap?: string; // prix moyen d'exécution (préféré si présent)
  T?: number; // tradeTime (ms)
}
interface ForceOrderMessage {
  e?: string;
  o?: ForceOrderPayload;
}

/**
 * Parse un message forceOrder en Liquidation, ou null si illisible. PURE & testée.
 * side : "SELL" (ordre) → "long" liquidé ; "BUY" (ordre) → "short" liquidé.
 */
export function parseForceOrder(raw: unknown): Liquidation | null {
  const msg = raw as ForceOrderMessage;
  const o = msg?.o;
  if (!o || (msg.e !== undefined && msg.e !== "forceOrder")) return null;
  const qty = Number(o.q);
  const price = Number(o.ap ?? o.p);
  const time = Number(o.T);
  if (!Number.isFinite(qty) || !Number.isFinite(price) || price <= 0) return null;
  if (o.S !== "BUY" && o.S !== "SELL") return null;
  return {
    time: Number.isFinite(time) ? time : Date.now(),
    side: o.S === "SELL" ? "long" : "short",
    qty,
    price,
    notionalUsd: qty * price,
  };
}

/** Résumé agrégé d'un lot de liquidations (notionnel long/short, dominance). PURE. */
export interface ResumeLiquidations {
  longUsd: number;
  shortUsd: number;
  total: number;
  /** Part des liquidations LONGUES dans le notionnel total (0..1), ou null si vide. */
  partLong: number | null;
}

export function resumerLiquidations(liqs: Liquidation[]): ResumeLiquidations {
  let longUsd = 0;
  let shortUsd = 0;
  for (const l of liqs) {
    if (l.side === "long") longUsd += l.notionalUsd;
    else shortUsd += l.notionalUsd;
  }
  const total = longUsd + shortUsd;
  return { longUsd, shortUsd, total, partLong: total > 0 ? longUsd / total : null };
}

/** S'abonne au flux de liquidations du perpétuel. `cb` reçoit chaque liquidation. */
export function subscribeLiquidations(symbol: string, cb: (l: Liquidation) => void): Unsubscribe {
  const url = `${WS_FUTURES_BASE_URL}/${symbol.toLowerCase()}@forceOrder`;
  return connectWsLoop({
    url,
    source: "binance:liquidations",
    onMessage: (data) => {
      try {
        const liq = parseForceOrder(JSON.parse(data));
        if (liq) {
          cb(liq);
          return true;
        }
      } catch (err) {
        console.error("[AXIOM] Message forceOrder Binance illisible", err);
      }
      return false;
    },
  });
}
