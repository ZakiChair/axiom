/**
 * Funding Binance USDⓈ-M : règlements historiques de `/fapi/v1/fundingRate`.
 * L'API ne date pas les changements de cadence ; seuls les intervalles OBSERVÉS
 * entre règlements Regular permettent une conversion prudente à l'heure.
 */
import { extUrl } from "./extapi";

export interface ReglementFundingBinance {
  time: number;
  /** Fraction par règlement ; absent si taux/type inconnu ou contradictoire. */
  rate: number | undefined;
}

export interface PointFundingBinanceHourly {
  /** Instant réel du règlement, jamais arrondi à l'heure. */
  time: number;
  /** Fraction horaire ; absente tant que la cadence observée est incertaine. */
  value: number | undefined;
  /** Borne EXCLUSIVE : sans nouveau règlement attendu, la valeur devient inconnue. */
  validUntil: number | undefined;
}

const H = 3_600_000;
const LOOKBACK_MS = 90 * 24 * H;
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
const TIMEOUT_MS = 8_000;
const JITTER_MAX_MS = 60_000;
const CADENCES_H = new Set([1, 2, 4, 8]);
const RATE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Page Binance croissante ; un timestamp illisible invalide la page entière. */
export function parseBinanceFundingHistory(raw: unknown, symbol: string): ReglementFundingBinance[] {
  if (!Array.isArray(raw) || raw.length > PAGE_SIZE) throw new Error("Funding Binance : page invalide");
  const out: ReglementFundingBinance[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Funding Binance : règlement invalide");
    }
    const row = item as Record<string, unknown>;
    const time = row.fundingTime;
    if (row.symbol !== symbol || typeof time !== "number" || !Number.isSafeInteger(time) || time < 0) {
      throw new Error("Funding Binance : symbole ou timestamp invalide");
    }
    const previous = out.at(-1);
    if (previous !== undefined && time < previous.time) throw new Error("Funding Binance : ordre invalide");
    const rate = row.rateType !== "Regular"
      ? undefined
      : typeof row.fundingRate === "string" && RATE.test(row.fundingRate) && Number.isFinite(Number(row.fundingRate))
        ? Number(row.fundingRate)
        : undefined;
    if (previous !== undefined && time === previous.time) {
      // Deux observations contradictoires (ou Special) ne donnent aucun taux fiable.
      if (previous.rate !== rate) previous.rate = undefined;
    } else {
      out.push({ time, rate });
    }
  }
  return out;
}

/** Arrondi de cadence uniquement si l'écart à 1/2/4/8 h est au plus 60 s. */
function heuresObservees(deltaMs: number): number | undefined {
  const hours = Math.round(deltaMs / H);
  return CADENCES_H.has(hours) && Math.abs(deltaMs - hours * H) <= JITTER_MAX_MS
    ? hours
    : undefined;
}

/** Conversion causale : trois règlements Regular cohérents connus au plus à `time`. */
export function normaliserFundingHoraire(rows: readonly ReglementFundingBinance[]): PointFundingBinanceHourly[] {
  return rows.map((current, i) => {
    const prev = rows[i - 1];
    const prevPrev = rows[i - 2];
    const lastHours = prev === undefined ? undefined : heuresObservees(current.time - prev.time);
    const beforeHours = prev === undefined || prevPrev === undefined
      ? undefined
      : heuresObservees(prev.time - prevPrev.time);
    const hours = current.rate !== undefined && prev?.rate !== undefined && prevPrev?.rate !== undefined
      && lastHours !== undefined && lastHours === beforeHours
      ? lastHours
      : undefined;
    return {
      time: current.time,
      value: hours === undefined ? undefined : current.rate! / hours,
      validUntil: hours === undefined ? undefined : current.time + hours * H,
    };
  });
}

/** Historique de 90 j au plus, paginé en avant (bornes Binance inclusives). */
export async function fetchBinanceFundingHourly(
  symbol: string,
  sinceMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<PointFundingBinanceHourly[]> {
  if (!/^[A-Z0-9]+USDT$/.test(symbol) || !Number.isFinite(sinceMs)) return [];
  const end = Date.now();
  let start = Math.max(sinceMs, end - LOOKBACK_MS);
  if (start > end) return [];
  const rows: ReglementFundingBinance[] = [];
  try {
    for (let page = 0; page < MAX_PAGES && start <= end; page++) {
      const url = extUrl("fapi.binance.com", `fapi/v1/fundingRate?${new URLSearchParams({
        symbol, startTime: String(start), endTime: String(end), limit: String(PAGE_SIZE),
      })}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let raw: unknown;
      try {
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response.ok) return [];
        raw = await response.json() as unknown;
      } finally {
        clearTimeout(timer);
      }
      const parsed = parseBinanceFundingHistory(raw, symbol);
      if (parsed.length === 0) return normaliserFundingHoraire(rows);
      const first = parsed[0]!;
      const last = parsed[parsed.length - 1]!;
      if (first.time < start || last.time > end || (rows.length > 0 && first.time <= rows[rows.length - 1]!.time)) {
        return [];
      }
      rows.push(...parsed);
      if ((raw as unknown[]).length < PAGE_SIZE || last.time >= end) return normaliserFundingHoraire(rows);
      start = last.time + 1;
    }
  } catch {
    return []; // Page manquante, HTTP/JSON/timeout : aucun historique partiel exploité.
  }
  return []; // Pages épuisées avant la borne de fin : historique incomplet.
}
