/**
 * Liquidations perp — flux WS `allLiquidation.<symbol>` de BYBIT (v5 linear), GRATUIT.
 *
 * ⚠️ Historique : la 1re implémentation utilisait Binance `@forceOrder` (fstream), mais
 * `fstream.binance.com` est GÉO-BLOQUÉ depuis certains réseaux (dont celui de Zaki) : le
 * WebSocket s'ouvre mais Binance ne pousse AUCUNE donnée futures (ni trades ni
 * liquidations) → la fenêtre restait vide « en attente ». Bybit est accessible (CORS `*`,
 * même venue que l'adaptateur de charting) et délivre les liquidations en réel.
 *
 * Format vérifié en réel :
 *   { topic:"allLiquidation.BTCUSDT", data:[{ T:ms, s:"BTCUSDT", S:"Sell", v:"0.007", p:"65513.30" }] }
 *   - S = côté TAKER de l'ordre de liquidation (convention Bybit, alignée sur Binance) :
 *     "Sell" → une position LONGUE est fermée de force (vente) → LONG liquidé ;
 *     "Buy"  → une position COURTE est fermée de force (rachat) → SHORT liquidé.
 *   Cette convention est figée par un test (l'inverser fausserait long/short en silence).
 *
 * Flux LIVE only (aucun historique) : on accumule depuis la souscription, comme footprint/CVD.
 */
import type { Unsubscribe } from "@axiom/types";
import { connectWsLoop } from "./wsLoop";

const WS_URL = "wss://stream.bybit.com/v5/public/linear";
/** Staleness large : les liquidations sont sparses par nature (ne pas fermer une socket
 *  saine faute de messages ; une socket morte lèvera `onclose` de toute façon). */
const STALE_MS = 10 * 60_000;

/** Une liquidation normalisée. `side` = côté de la POSITION liquidée. */
export interface Liquidation {
  time: number;
  side: "long" | "short";
  qty: number; // quantité en actif de base
  price: number; // prix d'exécution
  notionalUsd: number; // qty × price (perp USDT → notionnel ≈ USD)
}

/** Une entrée `data[]` du message allLiquidation Bybit. */
interface BybitLiqEntry {
  T?: number; // timestamp (ms)
  s?: string; // symbole
  S?: string; // "Buy" | "Sell" (côté taker de la liquidation)
  v?: string; // volume (base)
  p?: string; // prix
}
interface BybitLiqMessage {
  topic?: string;
  data?: BybitLiqEntry[];
}

/**
 * Parse une entrée de liquidation Bybit en Liquidation, ou null si illisible. PURE & testée.
 * S="Sell" (taker vend) → LONG liquidé ; S="Buy" (taker rachète) → SHORT liquidé.
 */
export function parseBybitLiquidation(entry: BybitLiqEntry): Liquidation | null {
  const qty = Number(entry?.v);
  const price = Number(entry?.p);
  const time = Number(entry?.T);
  if (!Number.isFinite(qty) || !Number.isFinite(price) || price <= 0) return null;
  if (entry.S !== "Buy" && entry.S !== "Sell") return null;
  return {
    time: Number.isFinite(time) ? time : Date.now(),
    side: entry.S === "Sell" ? "long" : "short",
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

/** Symbole perp Bybit linear (BTCUSDT-style). Retire un éventuel suffixe PERP. */
function bybitPerpSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/_PERP$/i, "").replace(/PERP$/i, "");
}

/** S'abonne au flux de liquidations perp Bybit du symbole. `cb` reçoit chaque liquidation. */
export function subscribeLiquidations(symbol: string, cb: (l: Liquidation) => void): Unsubscribe {
  const topic = `allLiquidation.${bybitPerpSymbol(symbol)}`;
  return connectWsLoop({
    url: WS_URL,
    source: "bybit:liquidations",
    staleMs: STALE_MS,
    onOpen: (ws) => ws.send(JSON.stringify({ op: "subscribe", args: [topic] })),
    onMessage: (data) => {
      try {
        const msg = JSON.parse(data) as BybitLiqMessage;
        if (msg.topic === topic && Array.isArray(msg.data)) {
          for (const entry of msg.data) {
            const liq = parseBybitLiquidation(entry);
            if (liq) cb(liq);
          }
          return true; // message de données (≠ ack de souscription)
        }
      } catch (err) {
        console.error("[AXIOM] Message allLiquidation Bybit illisible", err);
      }
      return false;
    },
  });
}
