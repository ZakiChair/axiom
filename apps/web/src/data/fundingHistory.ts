/** Historique strict du funding, partagé par FUNDX et les aux du chart. */
import { fetchBinanceFundingHourly } from "./binanceFunding";
import { hyperliquidCoin } from "./symbol";
import { normaliserIdentiteFunding, type IdentiteFunding } from "./fundingIdentity";
import type { ExchangeId } from "@axiom/types";

export type VenueFunding = "binance" | "bybit" | "okx" | "hyperliquid";
export const VENUES_FUNDING: readonly VenueFunding[] = ["binance", "bybit", "okx", "hyperliquid"];
export interface ReglementFunding { time: number; rate: number | undefined }
export interface PointFundingHoraire { time: number; value: number | undefined; validUntil: number | undefined }
export interface HistoriqueFundingVenue {
  venue: VenueFunding;
  status: "ok" | "partial" | "error";
  points: PointFundingHoraire[];
  requestedFrom: number;
  effectiveFrom: number | undefined;
  effectiveTo: number | undefined;
  erreur?: string;
}

const H = 3_600_000;
const JOUR = 24 * H;
const MAX_DAYS = 90;
const TIMEOUT_MS = 8_000;
const TAUX = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER = /^\d+$/;

function tauxStrict(v: unknown): number | undefined {
  return typeof v === "string" && TAUX.test(v) && Number.isFinite(Number(v)) ? Number(v) : undefined;
}
function timestamp(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && INTEGER.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/** La page garde les doublons : la fusion les transforme en barrière si contradictoires. */
export function parseBybitFundingPage(raw: unknown, symbol: string): ReglementFunding[] {
  const r = raw as { retCode?: unknown; result?: { list?: unknown } };
  if (r?.retCode !== 0 || !Array.isArray(r.result?.list) || r.result.list.length > 200) throw new Error("Historique Bybit invalide");
  return r.result.list.map((v) => {
    const row = v as Record<string, unknown>;
    const time = timestamp(row?.fundingRateTimestamp);
    if (row?.symbol !== symbol || time === undefined) throw new Error("Règlement Bybit invalide");
    return { time, rate: tauxStrict(row.fundingRate) };
  });
}

export function parseOkxFundingPage(raw: unknown, instId: string): ReglementFunding[] {
  const r = raw as { code?: unknown; data?: unknown };
  if (r?.code !== "0" || !Array.isArray(r.data) || r.data.length > 400) throw new Error("Historique OKX invalide");
  return r.data.map((v) => {
    const row = v as Record<string, unknown>;
    const time = timestamp(row?.fundingTime);
    if (row?.instId !== instId || time === undefined) throw new Error("Règlement OKX invalide");
    // realizedRate est le règlement ; fundingRate n'est qu'une prévision.
    return { time, rate: tauxStrict(row.realizedRate) };
  });
}

export function parseHlFundingPage(raw: unknown, coin: string): ReglementFunding[] {
  if (!Array.isArray(raw) || raw.length > 500) throw new Error("Historique Hyperliquid invalide");
  return raw.map((v) => {
    const row = v as Record<string, unknown>;
    const time = timestamp(row?.time);
    if (row?.coin !== coin || time === undefined) throw new Error("Règlement Hyperliquid invalide");
    return { time, rate: tauxStrict(row.fundingRate) };
  });
}

/** Tri, fusion des doublons contradictoires et barrières explicites. */
function fusionner(rows: ReglementFunding[]): ReglementFunding[] {
  const sorted = rows.slice().sort((a, b) => a.time - b.time);
  const out: ReglementFunding[] = [];
  for (const row of sorted) {
    const prev = out.at(-1);
    if (prev?.time === row.time) {
      if (prev.rate !== row.rate) prev.rate = undefined;
    } else out.push({ ...row });
  }
  return out;
}

/** Deux intervalles antérieurs cohérents sont requis ; jamais de cadence actuelle rétroprojetée. */
export function normaliserCexFunding(rows: ReglementFunding[], venue: "binance" | "bybit" | "okx"): PointFundingHoraire[] {
  const unique = fusionner(rows);
  const cadences = venue === "okx" ? [1, 2, 4, 6, 8] : [1, 2, 4, 8];
  const cadence = (delta: number): number | undefined => cadences.find((h) => Math.abs(delta - h * H) <= 60_000);
  return unique.map((row, i) => {
    const prev = unique[i - 1];
    const prevPrev = unique[i - 2];
    const a = prev ? cadence(row.time - prev.time) : undefined;
    const b = prev && prevPrev ? cadence(prev.time - prevPrev.time) : undefined;
    const h = row.rate !== undefined && prev?.rate !== undefined && prevPrev?.rate !== undefined && a !== undefined && a === b ? a : undefined;
    return { time: row.time, value: h === undefined ? undefined : row.rate! / h, validUntil: h === undefined ? undefined : row.time + h * H };
  });
}

function normaliserHl(rows: ReglementFunding[]): PointFundingHoraire[] {
  return fusionner(rows).map((row) => ({ time: row.time, value: row.rate, validUntil: row.rate === undefined ? undefined : row.time + H }));
}

/** Abort du transport et rejet indépendant du corps JSON qui pourrait rester bloqué. */
async function jsonBorne(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Délai historique funding dépassé")); }, TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function collecterDescendant(
  venue: "bybit" | "okx", identite: IdentiteFunding, since: number, maintenant: number, fetchImpl: typeof fetch,
): Promise<ReglementFunding[]> {
  const rows: ReglementFunding[] = [];
  const pageSize = venue === "bybit" ? 200 : 400;
  const maxPages = venue === "bybit" ? 12 : 6;
  let end = maintenant;
  for (let page = 0; page < maxPages && end >= since; page++) {
    const url = venue === "bybit"
      ? `https://api.bybit.com/v5/market/funding/history?${new URLSearchParams({ category: "linear", symbol: identite.cexSymbol, limit: String(pageSize), endTime: String(end) })}`
      : `https://www.okx.com/api/v5/public/funding-rate-history?${new URLSearchParams({ instId: identite.okxInstId, limit: String(pageSize), after: String(end) })}`;
    const raw = await jsonBorne(fetchImpl, url);
    const parsed = venue === "bybit"
      ? parseBybitFundingPage(raw, identite.cexSymbol)
      : parseOkxFundingPage(raw, identite.okxInstId);
    if (parsed.length === 0) break;
    const minimum = Math.min(...parsed.map((p) => p.time));
    const maximum = Math.max(...parsed.map((p) => p.time));
    if (maximum > end || minimum < 0 || (page > 0 && maximum >= rows.at(-1)!.time)) throw new Error("Pagination funding incohérente");
    rows.push(...parsed);
    if (minimum <= since || parsed.length < pageSize) break;
    if (page === maxPages - 1) throw new Error("Historique funding tronqué : limite de pagination");
    end = minimum - 1;
  }
  return rows.filter((r) => r.time >= since && r.time <= maintenant);
}

async function collecterHl(coin: string, since: number, maintenant: number, fetchImpl: typeof fetch): Promise<ReglementFunding[]> {
  const rows: ReglementFunding[] = [];
  let start = since;
  for (let page = 0; page < 8 && start <= maintenant; page++) {
    const raw = await jsonBorne(fetchImpl, "https://api.hyperliquid.xyz/info", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "fundingHistory", coin, startTime: start }),
    });
    const parsed = parseHlFundingPage(raw, coin);
    if (parsed.length === 0) break;
    const maximum = Math.max(...parsed.map((p) => p.time));
    if (maximum < start) throw new Error("Pagination Hyperliquid incohérente");
    rows.push(...parsed);
    if (parsed.length < 500 || maximum >= maintenant) break;
    if (page === 7) throw new Error("Historique Hyperliquid tronqué : limite de pagination");
    start = maximum + 1;
  }
  return rows.filter((r) => r.time >= since && r.time <= maintenant);
}

interface CacheEntry { depuis: number; expiration: number; promesse: Promise<HistoriqueFundingVenue> }
const cache = new Map<string, CacheEntry>();
/** Test et réinitialisation ciblée : aucun effet sur les caches d'autres fournisseurs. */
export function viderCacheFundingHistorique(): void { cache.clear(); }

async function charger(venue: VenueFunding, identite: IdentiteFunding | null, depuis: number, requestedFrom: number, fetchImpl: typeof fetch): Promise<HistoriqueFundingVenue> {
  if (identite === null) {
    return { venue, status: "error", points: [], requestedFrom, effectiveFrom: undefined, effectiveTo: undefined, erreur: "Identité de funding incompatible" };
  }
  const base = identite.base;
  let points: PointFundingHoraire[] = [];
  try {
    if (venue === "binance") {
      const rows = await fetchBinanceFundingHourly(identite.cexSymbol, depuis, fetchImpl);
      if (rows.length === 0) throw new Error("Historique Binance absent ou indisponible");
      points = rows.map((p) => ({ time: p.time, value: p.value, validUntil: p.validUntil }));
    } else if (venue === "bybit" || venue === "okx") {
      const rows = await collecterDescendant(venue, identite, depuis, Date.now(), fetchImpl);
      points = normaliserCexFunding(rows, venue);
    } else {
      const rows = await collecterHl(hyperliquidCoin(`${base}-PERP`), depuis, Date.now(), fetchImpl);
      points = normaliserHl(rows);
    }
    const connues = points.filter((p) => p.value !== undefined && p.validUntil !== undefined);
    return { venue, status: "ok", points, requestedFrom, effectiveFrom: connues[0]?.time, effectiveTo: connues.at(-1)?.time };
  } catch (err) {
    return { venue, status: "error", points: [], requestedFrom, effectiveFrom: undefined, effectiveTo: undefined,
      erreur: err instanceof Error ? err.message : "Historique indisponible" };
  }
}

/** Cache promesse par venue/symbole ; une demande plus large remplace la couverture. */
export function chargerFundingVenue(
  venue: VenueFunding, symbol: string, jours: 7 | 30 | 90, fetchImpl: typeof fetch = fetch,
  exchange: ExchangeId = "binance",
): Promise<HistoriqueFundingVenue> {
  const now = Date.now();
  const requestedFrom = now - Math.min(MAX_DAYS, jours) * JOUR;
  const depuis = Math.max(now - MAX_DAYS * JOUR, requestedFrom - 16 * H);
  const identite = normaliserIdentiteFunding(exchange, symbol);
  const key = identite === null ? `${venue}:incompatible:${exchange}:${symbol}` : `${venue}:${identite.base}`;
  const old = cache.get(key);
  if (old && old.expiration > now && old.depuis <= depuis) {
    if (old.depuis === depuis) return old.promesse;
    return old.promesse.then((r) => ({ ...r, requestedFrom }));
  }
  const promesse = old && old.expiration > now
    ? old.promesse.then(() => charger(venue, identite, depuis, requestedFrom, fetchImpl))
    : charger(venue, identite, depuis, requestedFrom, fetchImpl);
  cache.set(key, { depuis, expiration: now + 60_000, promesse });
  return promesse;
}
