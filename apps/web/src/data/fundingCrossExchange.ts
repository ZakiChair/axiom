/**
 * Funding cross-exchange — snapshot du taux de funding perp du symbole courant sur
 * plusieurs venues (Binance, Bybit, OKX, Hyperliquid), NORMALISÉ en APR annualisé.
 *
 * ⚠️ Les intervalles de funding DIFFÈRENT : Binance/Bybit/OKX règlent toutes les 8 h,
 * Hyperliquid toutes les 1 h. Comparer les taux bruts serait trompeur → on annualise
 * chaque taux (APR %) pour une base commune. La DIVERGENCE d'APR entre CEX et le perp
 * DEX (Hyperliquid) est le signal recherché (arbitrage de funding / stress relatif).
 *
 * Accès : Bybit/OKX/Hyperliquid renvoient CORS `*` (appel direct) ; Binance fapi passe
 * par le proxy /extapi. Chaque venue est indépendante (Promise.allSettled) : une source
 * en échec n'empêche pas d'afficher les autres.
 */
import { extUrl } from "./extapi";
import { splitSymbol } from "./symbol";

/** Un funding de venue, normalisé. */
export interface FundingVenue {
  exchange: string;
  label: string;
  /** Taux de funding brut par intervalle, en POURCENTAGE (ex. 0.01 = 0,01 %/8 h). */
  ratePct: number;
  /** Intervalle de règlement en heures (8 CEX, 1 Hyperliquid). */
  intervalHours: number;
  /** Taux annualisé (APR %) — base commune de comparaison. */
  apr: number;
}

/**
 * Annualise un taux de funding (fraction par intervalle) en APR %. PURE.
 *   apr% = rate · (24 / intervalHours) · 365 · 100
 * Ex. 0.0001 / 8 h → 10,95 % ; 0.0000125 / 1 h → 10,95 % (comparables).
 */
export function annualiserFunding(rate: number, intervalHours: number): number {
  if (!Number.isFinite(rate) || !Number.isFinite(intervalHours) || intervalHours <= 0) return NaN;
  return rate * (24 / intervalHours) * 365 * 100;
}

/** Base d'un symbole chart (BTCUSDT → BTC), ou null si illisible. */
function baseDe(symbol: string): string | null {
  try {
    return splitSymbol(symbol, "funding-x").base;
  } catch {
    return null;
  }
}

// ─────────────────────────── Parsers PURS (rate brut par intervalle) ───────────────────────────

/** Binance fapi premiumIndex → lastFundingRate (objet unique). */
export function parseBinanceFunding(json: unknown): number | null {
  const r = json as { lastFundingRate?: unknown };
  const v = Number(r?.lastFundingRate);
  return Number.isFinite(v) ? v : null;
}

/** Bybit v5 tickers (linear) → result.list[0].fundingRate. */
export function parseBybitFunding(json: unknown): number | null {
  const list = (json as { result?: { list?: Array<{ fundingRate?: unknown }> } })?.result?.list;
  const v = Number(list?.[0]?.fundingRate);
  return Number.isFinite(v) ? v : null;
}

/** OKX public/funding-rate → data[0].fundingRate. */
export function parseOkxFunding(json: unknown): number | null {
  const data = (json as { data?: Array<{ fundingRate?: unknown }> })?.data;
  const v = Number(data?.[0]?.fundingRate);
  return Number.isFinite(v) ? v : null;
}

/** Hyperliquid metaAndAssetCtxs → funding du coin (tuple [meta, ctxs]). */
export function parseHyperliquidFunding(json: unknown, coin: string): number | null {
  if (!Array.isArray(json) || json.length < 2) return null;
  const universe = (json[0] as { universe?: Array<{ name?: string }> })?.universe ?? [];
  const ctxs = json[1] as Array<{ funding?: unknown }>;
  const idx = universe.findIndex((u) => u?.name === coin);
  if (idx < 0) return null;
  const v = Number(ctxs?.[idx]?.funding);
  return Number.isFinite(v) ? v : null;
}

// ─────────────────────────── Fetchers par venue (rate → venue normalisée | null) ───────────────────────────

const CEX_INTERVAL_H = 8;
const HL_INTERVAL_H = 1;

async function jsonDirect(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBinance(base: string): Promise<FundingVenue | null> {
  const json = await jsonDirect(extUrl("fapi.binance.com", `fapi/v1/premiumIndex?symbol=${base}USDT`));
  const rate = parseBinanceFunding(json);
  return rate === null ? null : venue("binance", "Binance", rate, CEX_INTERVAL_H);
}

async function fetchBybit(base: string): Promise<FundingVenue | null> {
  const json = await jsonDirect(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${base}USDT`);
  const rate = parseBybitFunding(json);
  return rate === null ? null : venue("bybit", "Bybit", rate, CEX_INTERVAL_H);
}

async function fetchOkx(base: string): Promise<FundingVenue | null> {
  const json = await jsonDirect(`https://www.okx.com/api/v5/public/funding-rate?instId=${base}-USDT-SWAP`);
  const rate = parseOkxFunding(json);
  return rate === null ? null : venue("okx", "OKX", rate, CEX_INTERVAL_H);
}

async function fetchHyperliquid(base: string): Promise<FundingVenue | null> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rate = parseHyperliquidFunding(await res.json(), base);
  return rate === null ? null : venue("hyperliquid", "Hyperliquid (DEX)", rate, HL_INTERVAL_H);
}

function venue(exchange: string, label: string, rate: number, intervalHours: number): FundingVenue {
  return { exchange, label, ratePct: rate * 100, intervalHours, apr: annualiserFunding(rate, intervalHours) };
}

/**
 * Récupère le funding cross-exchange du symbole (USDT perp), trié par APR décroissant.
 * Une venue en échec (source down / symbole absent) est simplement omise (allSettled).
 * Renvoie [] si la base est illisible.
 */
export async function fetchFundingMatrix(symbol: string): Promise<FundingVenue[]> {
  const base = baseDe(symbol);
  if (base === null) return [];
  const résultats = await Promise.allSettled([
    fetchBinance(base),
    fetchBybit(base),
    fetchOkx(base),
    fetchHyperliquid(base),
  ]);
  const venues = résultats
    .filter((r): r is PromiseFulfilledResult<FundingVenue | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v): v is FundingVenue => v !== null);
  venues.sort((a, b) => b.apr - a.apr);
  return venues;
}

/** Écart (spread) d'APR entre la venue la plus chère et la moins chère, ou null si < 2. */
export function fundingSpreadApr(venues: FundingVenue[]): number | null {
  if (venues.length < 2) return null;
  const aprs = venues.map((v) => v.apr);
  return Math.max(...aprs) - Math.min(...aprs);
}
