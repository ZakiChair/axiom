/**
 * @axiom/indicators — utils-session.test.ts
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { utcDayOf, sessionExtents } from "./utils-session";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

describe("utcDayOf", () => {
  it("bucket un timestamp ms en index de jour UTC (floor(ms / 86_400_000))", () => {
    expect(utcDayOf(0)).toBe(0);
    expect(utcDayOf(DAY_MS - 1)).toBe(0); // dernière ms du jour 0
    expect(utcDayOf(DAY_MS)).toBe(1); // première ms du jour 1
  });
});

describe("sessionExtents", () => {
  // Fixture 1h synthétique à cheval sur 2 jours UTC (3 bougies/jour).
  //
  // Jour 0 (t = 0, 1h, 2h) : O = ouverture de la PREMIÈRE bougie du jour
  //   (index 0) = 9, H = max(10, 12, 11) = 12, L = min(8, 8.5, 9) = 8,
  //   C = clôture de la DERNIÈRE bougie du jour (index 2) = 11.
  // Jour 1 (t = 24h, 25h, 26h) : O = ouverture de la première bougie du jour
  //   (index 3) = 11, H = max(13, 14, 13.5) = 14, L = min(10, 11, 9) = 9,
  //   C = clôture de la dernière bougie du jour (index 5) = 14.
  const candles: Candle[] = [
    { time: 0, open: 9, high: 10, low: 8, close: 9, volume: 0 },
    { time: HOUR_MS, open: 9, high: 12, low: 8.5, close: 10, volume: 0 },
    { time: 2 * HOUR_MS, open: 10, high: 11, low: 9, close: 11, volume: 0 },
    { time: DAY_MS, open: 11, high: 13, low: 10, close: 12, volume: 0 },
    { time: DAY_MS + HOUR_MS, open: 12, high: 14, low: 11, close: 13, volume: 0 },
    { time: DAY_MS + 2 * HOUR_MS, open: 13, high: 13.5, low: 9, close: 14, volume: 0 },
  ];

  it("agrège H/L/C par jour UTC, en ordre chronologique", () => {
    const extents = sessionExtents(candles);

    expect(extents.length).toBe(2);

    expect(extents[0]).toEqual({
      dayIdx: 0,
      open: 9,
      high: 12,
      low: 8,
      close: 11,
      from: 0,
      to: 2 * HOUR_MS,
    });
    expect(extents[1]).toEqual({
      dayIdx: 1,
      open: 11,
      high: 14,
      low: 9,
      close: 14,
      from: DAY_MS,
      to: DAY_MS + 2 * HOUR_MS,
    });
  });
});
