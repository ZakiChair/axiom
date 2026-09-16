import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { skewKurt } from "./skewKurt";

function ctxDe(candles: Candle[]) {
  return { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) };
}

describe("skewKurt", () => {
  it("rendements symétriques [−2,−1,0,1,2] ×2 : skew = 0, kurtosis d'excès = −1,3", () => {
    // Distribution discrète {−2,−1,0,1,2} : m2 = 2, m3 = 0, m4 = 6,8 ⇒ skew = 0,
    // kurtosis = 6,8/4 − 3 = −1,3. La fenêtre minimale du def est de 10 rendements.
    const rets = [-2, -1, 0, 1, 2, -2, -1, 0, 1, 2];
    const closes = [1];
    for (const r of rets) closes.push(closes[closes.length - 1]! * Math.exp(r));
    const candles: Candle[] = closes.map((close, i) => ({
      time: i,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
    }));
    const { series } = skewKurt.calc(candles, { length: 10 }, ctxDe(candles));
    expect(series.skew?.[10]).toBeCloseTo(0, 12);
    expect(series.kurt?.[10]).toBeCloseTo(-1.3, 12);
  });

  it("série plate : variance nulle → skew et kurtosis non définis", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1,
    }));
    const { series } = skewKurt.calc(candles, { length: 20 }, ctxDe(candles));
    expect(series.skew?.[29]).toBeUndefined();
    expect(series.kurt?.[29]).toBeUndefined();
  });

  it("kurtosis d'excès positive sur une série à sauts (queues épaisses)", () => {
    // Rendements : 19 petits (+0,001) et 1 grand (−0,05) → distribution leptokurtique.
    const rets = [...Array.from({ length: 19 }, () => 0.001), -0.05];
    const closes = [1];
    for (const r of rets) closes.push(closes[closes.length - 1]! * Math.exp(r));
    const candles: Candle[] = closes.map((close, i) => ({
      time: i,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
    }));
    const { series } = skewKurt.calc(candles, { length: 20 }, ctxDe(candles));
    expect(series.kurt?.[20]).toBeGreaterThan(0);
    expect(series.skew?.[20]).toBeLessThan(0);
  });
});
