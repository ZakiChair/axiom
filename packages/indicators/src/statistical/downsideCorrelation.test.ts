import { describe, expect, it } from "vitest";
import { downsideCorrelation } from "./downsideCorrelation";

function prix(r: number[]): number[] {
  const out = [100];
  for (const v of r) out.push(out.at(-1)! * Math.exp(v));
  return out;
}

describe("corrélation sur baisses du benchmark", () => {
  it("emploie refCloseStrict, les closes actifs, et annote le compte hors axe", () => {
    const ry = Array.from({ length: 20 }, (_, i) => -0.01 - i * 0.001);
    const x = prix(ry.map((v) => 2 * v));
    const y = prix(ry);
    const candles = x.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 1 }));
    const r = downsideCorrelation.calc(candles, { length: 20, minDown: 20 }, {
      hl2: [], hlc3: [], ohlc4: [], source: Array(x.length).fill(999), aux: { refCloseStrict: y },
    });
    expect(downsideCorrelation.aux).toEqual(["refCloseStrict"]);
    expect(r.series.corr?.at(-1)).toBeCloseTo(1, 10);
    expect(r.series.count).toBeUndefined();
    expect(r.annotations?.labels?.at(-1)?.texte).toContain("20");
  });
});
