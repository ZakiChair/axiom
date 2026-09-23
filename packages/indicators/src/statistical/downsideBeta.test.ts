import { describe, expect, it } from "vitest";
import { downsideBeta } from "./downsideBeta";

function prix(r: number[]): number[] {
  const out = [100];
  for (const v of r) out.push(out.at(-1)! * Math.exp(v));
  return out;
}

describe("bêta sur baisses du benchmark", () => {
  it("x=−2y donne bêta −2 et minimum de baisses configuré", () => {
    const ry = Array.from({ length: 20 }, (_, i) => -0.01 - i * 0.001);
    const x = prix(ry.map((v) => -2 * v));
    const y = prix(ry);
    const candles = x.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 1 }));
    const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [], aux: { refCloseStrict: y } };
    expect(downsideBeta.calc(candles, { length: 20, minDown: 20 }, ctx).series.beta?.at(-1)).toBeCloseTo(-2, 10);
    expect(downsideBeta.calc(candles, { length: 20, minDown: 21 }, ctx).series.beta?.at(-1)).toBeCloseTo(-2, 10);
    expect(downsideBeta.aux).toEqual(["refCloseStrict"]);
  });
});
