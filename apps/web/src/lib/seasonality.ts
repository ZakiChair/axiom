import type { Candle } from "@axiom/types";

export type SeasonMode = "monthly" | "weekday" | "hourly";

export interface SeasonCell {
  bucket: number;
  mean: number;
  median: number;
  winRate: number;
  n: number;
}

export interface MonthCell {
  year: number;
  month: number;
  ret: number;
}

function bucketFor(time: number, mode: SeasonMode): number {
  const d = new Date(time);
  if (mode === "monthly") return d.getUTCMonth();
  if (mode === "hourly") return d.getUTCHours();
  return (d.getUTCDay() + 6) % 7;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const current = sorted[mid];
  if (current === undefined) return Number.NaN;
  if (sorted.length % 2 === 1) return current;
  const previous = sorted[mid - 1];
  return previous === undefined ? current : (previous + current) / 2;
}

/** Nettoie le bruit de représentation binaire (ex. 110/100-1 = 0.10000000000000009). */
function roundTiny(value: number): number {
  const rounded = Math.round(value * 1e10) / 1e10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function bucketReturns(candles: Candle[], mode: SeasonMode): SeasonCell[] {
  if (candles.length < 2) return [];
  const buckets = new Map<number, number[]>();

  for (let i = 1; i < candles.length; i++) {
    const previous = candles[i - 1];
    const current = candles[i];
    if (previous === undefined || current === undefined || previous.close === 0) continue;
    const ret = current.close / previous.close - 1;
    const bucket = bucketFor(current.time, mode);
    const values = buckets.get(bucket) ?? [];
    values.push(roundTiny(ret));
    buckets.set(bucket, values);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucket, values]) => {
      const sum = values.reduce((acc, value) => acc + value, 0);
      const wins = values.filter((value) => value > 0).length;
      return {
        bucket,
        mean: roundTiny(sum / values.length),
        median: roundTiny(median(values)),
        winRate: wins / values.length,
        n: values.length,
      };
    });
}

export function monthlyMatrix(candles: Candle[]): MonthCell[] {
  if (candles.length < 2) return [];

  const closes = new Map<string, { year: number; month: number; first: number; last: number }>();
  for (const candle of candles) {
    const d = new Date(candle.time);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const key = `${year}-${month}`;
    const existing = closes.get(key);
    if (existing === undefined) closes.set(key, { year, month, first: candle.close, last: candle.close });
    else existing.last = candle.close;
  }

  return [...closes.values()]
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
    .map((entry, index, entries) => {
      const previous = entries[index - 1];
      const base = previous?.last ?? entry.first;
      if (base === 0) return null;
      return { year: entry.year, month: entry.month, ret: roundTiny(entry.last / base - 1) };
    })
    .filter((entry): entry is MonthCell => entry !== null);
}
