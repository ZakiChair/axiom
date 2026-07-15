/**
 * Positionnement Binance futures (perp USDT-M) — ratios long/short GRATUITS.
 *
 * Endpoints `fapi.binance.com/futures/data/*` (via proxy /extapi, host whitelisté) :
 *   - globalLongShortAccountRatio : ratio de COMPTES long/short (la « foule » retail) ;
 *   - topLongShortPositionRatio  : ratio de POSITIONS des top traders (gros comptes) ;
 *   - takerlongshortRatio        : volume taker acheteur / vendeur (flux agressif).
 * Chaque point : { timestamp, longShortRatio | buySellRatio, … }. `period` supporté
 * (5m…1d), `limit` ≤ 500. On récupère les 500 derniers points 1h (~20 j) : outil de
 * SENTIMENT récent (undefined au-delà, dégradation gracieuse honnête).
 *
 * Symbole : perp USDT-M (BTCUSDT). Un symbole non listé en futures Binance lève (état
 * visible dans le panneau santé), comme l'aux mark.
 */
import { extUrl } from "./extapi";

/** Point d'une série de ratio {time ms, value}. */
export interface RatioPoint {
  time: number;
  value: number;
}

/** Période et profondeur des séries de ratio (max 500 côté API). */
const PERIODE = "1h";
const LIMITE = 500;

/**
 * Parse une réponse futures/data (tableau d'objets datés) en points {time, value},
 * en lisant `champ` (« longShortRatio » ou « buySellRatio »). PURE et tolérante :
 * ignore les lignes non numériques ; trie par temps croissant.
 */
export function parseRatioResponse(json: unknown, champ: string): RatioPoint[] {
  if (!Array.isArray(json)) return [];
  const out: RatioPoint[] = [];
  for (const row of json) {
    const r = row as Record<string, unknown>;
    const time = Number(r.timestamp);
    const value = Number(r[champ]);
    if (Number.isFinite(time) && Number.isFinite(value)) out.push({ time, value });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Symbole perp USDT-M à partir d'un symbole chart (retire un éventuel suffixe PERP). */
function toFuturesSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/_PERP$/i, "").replace(/PERP$/i, "");
}

async function fetchRatio(endpoint: string, champ: string, symbol: string): Promise<RatioPoint[]> {
  const q = new URLSearchParams({ symbol: toFuturesSymbol(symbol), period: PERIODE, limit: String(LIMITE) });
  const res = await fetch(extUrl("fapi.binance.com", `futures/data/${endpoint}?${q}`));
  if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`);
  return parseRatioResponse(await res.json(), champ);
}

/** Ratio de comptes long/short (foule retail). */
export const fetchLsAccountRatio = (symbol: string): Promise<RatioPoint[]> =>
  fetchRatio("globalLongShortAccountRatio", "longShortRatio", symbol);

/** Ratio de positions des top traders (gros comptes). */
export const fetchLsTopTraderRatio = (symbol: string): Promise<RatioPoint[]> =>
  fetchRatio("topLongShortPositionRatio", "longShortRatio", symbol);

/** Ratio de volume taker acheteur / vendeur (flux agressif). */
export const fetchTakerRatio = (symbol: string): Promise<RatioPoint[]> =>
  fetchRatio("takerlongshortRatio", "buySellRatio", symbol);
