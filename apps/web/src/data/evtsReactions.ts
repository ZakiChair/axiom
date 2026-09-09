/** Transport M1 borné pour les réactions d'évènements BTC/ETH. */
import type { Candle } from "@axiom/types";

const MINUTE_MS = 60_000;
export const KLINES_M1_MAX_PAR_APPEL = 1000;
const MAX_PAGES = 6;

export interface SourceKlinesM1 {
  fetchKlines(
    symbol: string,
    tf: "1m",
    options?: { limit?: number; endTime?: number },
  ): Promise<Candle[]>;
}

function interrompre(): never {
  throw new DOMException("Chargement des réactions annulé", "AbortError");
}

/**
 * Charge [H0−24h−1m, H0+24h) par pages arrière Binance compatibles. La borne droite est
 * limitée à la dernière minute clôturée observée ; un résultat partiel reste exploitable par
 * horizon dans `calculerReactionEvenement`.
 */
export async function chargerFenetreReactionM1(
  source: SourceKlinesM1,
  symbol: string,
  eventTime: number,
  options: { maintenantMs: number; signal?: AbortSignal },
): Promise<Candle[]> {
  if (options.signal?.aborted) interrompre();
  const debut = eventTime - 1_441 * MINUTE_MS;
  const derniereCloturee = Math.floor(options.maintenantMs / MINUTE_MS) * MINUTE_MS - MINUTE_MS;
  let endTime = Math.min(eventTime + 1_439 * MINUTE_MS, derniereCloturee);
  if (endTime < debut) return [];

  const parTemps = new Map<number, Candle>();
  for (let page = 0; page < MAX_PAGES && endTime >= debut; page += 1) {
    if (options.signal?.aborted) interrompre();
    const batch = await source.fetchKlines(symbol, "1m", { limit: KLINES_M1_MAX_PAR_APPEL, endTime });
    if (options.signal?.aborted) interrompre();
    if (batch.length === 0) break;
    let plusAncien = Infinity;
    for (const candle of batch) {
      if (!Number.isFinite(candle.time)) continue;
      plusAncien = Math.min(plusAncien, candle.time);
      if (candle.time >= debut && candle.time <= endTime) parTemps.set(candle.time, candle);
    }
    if (!Number.isFinite(plusAncien) || plusAncien >= endTime) break;
    endTime = plusAncien - 1;
  }
  return [...parTemps.values()].sort((a, b) => a.time - b.time);
}
