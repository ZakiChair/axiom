import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { ttmSqueeze } from "./ttmSqueeze";

/** Série plate → squeeze ON (BB étroit dans KC). */
function flat(n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      time: i * 60_000,
      open: 100,
      high: 100.1,
      low: 99.9,
      close: 100,
      volume: 1,
    });
  }
  return out;
}

describe("ttmSqueeze", () => {
  it("série plate : squeeze ON après amorçage", () => {
    const candles = flat(30);
    const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
    const { series } = ttmSqueeze.calc(
      candles,
      { length: 20, multBB: 2, multKC: 1.5 },
      { hl2: [], hlc3, ohlc4: [], source: candles.map((c) => c.close) },
    );
    const lastOn = series.on?.[29];
    expect(lastOn).toBe(1);
    // Momentum proche de 0 sur range plat.
    expect(Math.abs(series.mom?.[29] ?? 99)).toBeLessThan(1);
  });
});
