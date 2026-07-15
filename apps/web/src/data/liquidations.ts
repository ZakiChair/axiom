/**
 * Liquidations perp MULTI-EXCHANGE (live front) — deux flux WS INDÉPENDANTS fusionnés :
 *  - BYBIT (v5 linear) : `allLiquidation.<symbol>` — GRATUIT, CORS `*`.
 *  - OKX  (v5 public)  : canal `liquidation-orders` (instType SWAP) — GRATUIT, CORS `*`.
 * `subscribeLiquidations(symbol, cb)` est l'AGRÉGATEUR : il ouvre les deux et fusionne
 * dans `cb` ; l'unsubscribe retourné ferme les deux. Chaque liquidation porte sa `venue`.
 *
 * ⚠️ Historique : la 1re implémentation utilisait Binance `@forceOrder` (fstream), mais
 * `fstream.binance.com` est GÉO-BLOQUÉ depuis certains réseaux (dont celui de Zaki) : le
 * WebSocket s'ouvre mais Binance ne pousse AUCUNE donnée futures (ni trades ni
 * liquidations) → la fenêtre restait vide « en attente ». Bybit + OKX sont accessibles
 * (CORS `*`, mêmes venues que les adaptateurs de charting) et délivrent en réel.
 *
 * BYBIT — format vérifié en réel :
 *   { topic:"allLiquidation.BTCUSDT", data:[{ T:ms, s:"BTCUSDT", S:"Sell", v:"0.007", p:"65513.30" }] }
 *   - S = côté TAKER de l'ordre de liquidation (convention Bybit, alignée sur Binance) :
 *     "Sell" → une position LONGUE est fermée de force (vente) → LONG liquidé ;
 *     "Buy"  → une position COURTE est fermée de force (rachat) → SHORT liquidé.
 *
 * OKX — canal `liquidation-orders` (VÉRIFIÉ doc officielle v5, cf. sources plus bas) :
 *   La souscription `{channel:"liquidation-orders", instType:"SWAP"}` pousse TOUTES les
 *   liquidations SWAP → on filtre `data[].instId === "<BASE>-<QUOTE>-SWAP"` côté client.
 *   { arg:{channel:"liquidation-orders", instType:"SWAP"},
 *     data:[{ instId:"BTC-USDT-SWAP", details:[{ posSide:"long", side:"sell", bkPx:"65000", sz:"20", ts:"ms" }] }] }
 *   - posSide (long/short/net) = côté de la POSITION liquidée, PRIORITAIRE sur `side` ;
 *     si posSide="net"/absent → repli `side` (sell→long liquidé, buy→short, comme Bybit).
 *   - `sz` est en CONTRATS → qty (base) = sz × ctVal, où ctVal (« face value » d'un
 *     contrat) vient de GET /api/v5/public/instruments?instType=SWAP&instFamily=<F>
 *     (mémoïsé par instId ; les liq reçues avant le ctVal sont bufferisées puis rejouées).
 *   Ces conventions long/short sont figées par des tests (les inverser fausserait en silence).
 *
 * HYPERLIQUID — NON implémenté (décision explicite, pas un oubli) : pas de flux public de
 * liquidations documenté à ce jour côté Hyperliquid (seul un flux `trades`/L2 existe).
 *
 * Flux LIVE only (aucun historique) : on accumule depuis la souscription, comme footprint/CVD.
 *
 * Sources (API OKX v5, vérifiées via doc officielle / context7) :
 *   - WS liquidation-orders : https://www.okx.com/docs-v5/en/#public-data-websocket-liquidation-orders-channel
 *   - REST instruments      : https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments
 */
import type { Unsubscribe } from "@axiom/types";
import { splitSymbol } from "./symbol";
import { connectWsLoop } from "./wsLoop";

const WS_URL = "wss://stream.bybit.com/v5/public/linear";
/** Endpoint public OKX du canal de liquidations (SWAP, non authentifié). */
const OKX_WS_URL = "wss://ws.okx.com:8443/ws/v5/public";
/** REST OKX des instruments (source du `ctVal`, CORS `*`). */
const OKX_INSTRUMENTS_URL = "https://www.okx.com/api/v5/public/instruments";
/** Canal public OKX des liquidations. */
const OKX_CANAL_LIQ = "liquidation-orders";
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
  venue: "bybit" | "okx"; // exchange d'origine de la liquidation
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
    venue: "bybit",
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
function subscribeLiquidationsBybit(symbol: string, cb: (l: Liquidation) => void): Unsubscribe {
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

// ─────────────────────────── OKX (canal liquidation-orders) ───────────────────────────

/** Un détail `data[].details[]` du message liquidation-orders OKX (champs bruts). */
interface OkxLiqDetail {
  posSide?: unknown; // "long" | "short" | "net" — côté de la position (PRIORITAIRE)
  side?: unknown; // "buy" | "sell" — côté de l'ordre (repli si posSide="net"/absent)
  bkPx?: unknown; // prix de faillite/liquidation
  sz?: unknown; // taille EN CONTRATS
  ts?: unknown; // timestamp (ms)
}
/** Une entrée `data[]` du message liquidation-orders OKX. */
interface OkxLiqEntry {
  instId?: unknown;
  details?: unknown;
}
interface OkxLiqMessage {
  arg?: { channel?: unknown; instType?: unknown };
  data?: unknown;
}
/** Réponse REST /public/instruments (seuls instId + ctVal nous intéressent). */
interface OkxInstrument {
  instId?: unknown;
  ctVal?: unknown;
}
interface OkxInstrumentsResponse {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
}

/**
 * instFamily OKX d'un symbole concaténé (ex. "BTCUSDT" → "BTC-USDT"), via le découpage
 * partagé `splitSymbol`. LÈVE si la cotation est inconnue (symbole non mappable vers OKX).
 * PURE & exportée (figée par test).
 */
export function okxInstFamily(symbol: string): string {
  const { base, quote } = splitSymbol(symbol, "OKX");
  return `${base}-${quote}`;
}

/**
 * OKX couvre-t-il ce symbole ? true si le mapping vers un instFamily OKX est possible
 * (`okxInstFamily` lève sur cotation inconnue → false). Sert au sous-titre honnête de la
 * fenêtre LIQ (« perp Bybit + OKX » vs « perp Bybit »). PURE & testée.
 */
export function okxCouvre(symbol: string): boolean {
  try {
    okxInstFamily(symbol);
    return true;
  } catch {
    return false;
  }
}

/**
 * Côté de la POSITION liquidée depuis `posSide`/`side` OKX. posSide PRIORITAIRE
 * (long/short) ; sinon (net/absent) repli sur `side` : sell→long liquidé, buy→short
 * (même convention que Bybit). Renvoie `null` si indéterminé. PURE (locale).
 */
function okxCoteLiquidee(posSide: unknown, side: unknown): "long" | "short" | null {
  if (posSide === "long") return "long";
  if (posSide === "short") return "short";
  if (side === "sell") return "long";
  if (side === "buy") return "short";
  return null;
}

/**
 * Parse un `details[]` de liquidation OKX en `Liquidation` (venue « okx »), ou `null` si
 * illisible. `instId` fait partie du contrat (contexte, non requis pour le calcul).
 * `sz` est en CONTRATS → qty (base) = sz × ctVal ; notionnel = qty × bkPx. Gardes : sz/bkPx
 * finis, bkPx > 0, ctVal > 0, côté déterminé. PURE & testée.
 */
export function parseOkxLiquidation(
  instId: string,
  detail: unknown,
  ctVal: number,
): Liquidation | null {
  void instId; // partie de la signature (contrat) ; non nécessaire au calcul
  if (!detail || typeof detail !== "object") return null;
  if (!Number.isFinite(ctVal) || ctVal <= 0) return null;
  const d = detail as OkxLiqDetail;
  const sz = Number(d.sz);
  const price = Number(d.bkPx);
  const time = Number(d.ts);
  if (!Number.isFinite(sz) || !Number.isFinite(price) || price <= 0) return null;
  const side = okxCoteLiquidee(d.posSide, d.side);
  if (side === null) return null;
  const qty = sz * ctVal;
  return {
    time: Number.isFinite(time) ? time : Date.now(),
    side,
    qty,
    price,
    notionalUsd: qty * price,
    venue: "okx",
  };
}

/** ctVal (« face value » d'un contrat) mémoïsé par instId OKX. Module-level (partagé). */
const ctValParInst = new Map<string, number>();
/** Taille max de la file de liq OKX bufferisées en attendant le ctVal. */
const OKX_BUFFER_MAX = 200;
/** Throttle des tentatives de fetch ctVal après un échec (1 min). */
const OKX_CTVAL_RETRY_MS = 60_000;

/** Fetch le ctVal du perp `instId` (instFamily `<F>`), ou LÈVE si indisponible/illisible. */
async function fetchCtValOkx(instFamily: string, instId: string): Promise<number> {
  const params = new URLSearchParams({ instType: "SWAP", instFamily });
  const res = await fetch(`${OKX_INSTRUMENTS_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`OKX instruments ${res.status} ${res.statusText}`);
  const json = (await res.json()) as OkxInstrumentsResponse;
  if (json.code !== "0") throw new Error(`OKX instruments code ${String(json.code)}: ${String(json.msg)}`);
  const liste = Array.isArray(json.data) ? (json.data as OkxInstrument[]) : [];
  const inst = liste.find((i) => i.instId === instId);
  const ctVal = Number(inst?.ctVal);
  if (!Number.isFinite(ctVal) || ctVal <= 0) throw new Error(`ctVal illisible pour ${instId}`);
  return ctVal;
}

/** Symboles déjà signalés comme non couverts par OKX (log console.info UNE fois). */
const okxIncouvertLogges = new Set<string>();
function logOkxIncouvertUneFois(symbol: string): void {
  const cle = symbol.trim().toUpperCase();
  if (okxIncouvertLogges.has(cle)) return;
  okxIncouvertLogges.add(cle);
  console.info(`[AXIOM] OKX ne couvre pas ${symbol} — liquidations Bybit seules`);
}

/**
 * S'abonne au canal OKX `liquidation-orders` (toutes les SWAP) et filtre `instId` du
 * symbole. Renvoie `null` si le symbole n'est pas mappable vers OKX (Bybit seul, cf.
 * agrégateur). Le `ctVal` est fetché au 1er besoin (mémoïsé) ; les liquidations reçues
 * AVANT sont bufferisées (≤ OKX_BUFFER_MAX) puis rejouées ; sur échec du fetch, la file
 * est jetée et on retente au prochain message (throttle OKX_CTVAL_RETRY_MS).
 */
function subscribeLiquidationsOkx(symbol: string, cb: (l: Liquidation) => void): Unsubscribe | null {
  let instFamily: string;
  try {
    instFamily = okxInstFamily(symbol);
  } catch {
    logOkxIncouvertUneFois(symbol);
    return null;
  }
  const instId = `${instFamily}-SWAP`;
  const sub = JSON.stringify({ op: "subscribe", args: [{ channel: OKX_CANAL_LIQ, instType: "SWAP" }] });

  const enAttente: unknown[] = []; // details reçus avant le ctVal (rejoués après résolution)
  let fetchEnCours = false;
  let dernierEchec = 0;
  let arrete = false; // vrai après unsubscribe : coupe les callbacks async encore en vol

  const rejouer = (ctVal: number): void => {
    // Garde anti-course : si l'abonnement a été fermé pendant que le fetch ctVal était en
    // vol (ex. changement de symbole), ne PAS rejouer — sinon les liq bufferisées du
    // symbole A fuiteraient dans le feed du symbole B (le consommateur n'a pas de garde).
    if (arrete) return;
    for (const detail of enAttente) {
      const liq = parseOkxLiquidation(instId, detail, ctVal);
      if (liq) cb(liq);
    }
    enAttente.length = 0;
  };

  const assurerCtVal = (): void => {
    if (ctValParInst.has(instId) || fetchEnCours) return;
    if (Date.now() - dernierEchec < OKX_CTVAL_RETRY_MS) return; // throttle après échec
    fetchEnCours = true;
    fetchCtValOkx(instFamily, instId)
      .then((ctVal) => {
        ctValParInst.set(instId, ctVal);
        rejouer(ctVal);
      })
      .catch((err) => {
        dernierEchec = Date.now();
        enAttente.length = 0; // file jetée ; on retentera au prochain message
        console.error("[AXIOM] ctVal OKX indisponible pour", instId, err);
      })
      .finally(() => {
        fetchEnCours = false;
      });
  };

  const stop = connectWsLoop({
    url: OKX_WS_URL,
    source: "okx:liquidations",
    staleMs: STALE_MS,
    onOpen: (ws) => ws.send(sub),
    onMessage: (data) => {
      try {
        const msg = JSON.parse(data) as OkxLiqMessage;
        if (msg.arg?.channel !== OKX_CANAL_LIQ || !Array.isArray(msg.data)) return false;
        const ctVal = ctValParInst.get(instId);
        for (const entree of msg.data as OkxLiqEntry[]) {
          if (!entree || entree.instId !== instId || !Array.isArray(entree.details)) continue;
          for (const detail of entree.details) {
            if (ctVal === undefined) {
              if (enAttente.length < OKX_BUFFER_MAX) enAttente.push(detail);
            } else {
              const liq = parseOkxLiquidation(instId, detail, ctVal);
              if (liq) cb(liq);
            }
          }
        }
        if (ctVal === undefined) assurerCtVal();
        return true; // message de données du canal (≠ ack de souscription)
      } catch (err) {
        console.error("[AXIOM] Message liquidation-orders OKX illisible", err);
      }
      return false;
    },
  });

  // Unsubscribe : arme le flag anti-course AVANT de fermer la WS, pour que tout fetch ctVal
  // encore en vol qui résout après coup ne rejoue plus rien dans `cb`.
  return () => {
    arrete = true;
    stop();
  };
}

// ─────────────────────────── Agrégateur (Bybit + OKX) ───────────────────────────

/**
 * S'abonne aux liquidations perp du symbole sur BYBIT + OKX (deux WS indépendantes),
 * fusionnées dans `cb`. L'unsubscribe retourné ferme les deux. Si OKX ne couvre pas le
 * symbole (mapping impossible), seul Bybit est ouvert (dégradation silencieuse).
 */
export function subscribeLiquidations(symbol: string, cb: (l: Liquidation) => void): Unsubscribe {
  const stopBybit = subscribeLiquidationsBybit(symbol, cb);
  const stopOkx = subscribeLiquidationsOkx(symbol, cb);
  return () => {
    stopBybit();
    stopOkx?.();
  };
}
