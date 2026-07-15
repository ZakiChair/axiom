/**
 * @axiom/indicators — momentum/disparity.test.ts
 * disparity[i] = 100·(source[i] − SMA[i])/SMA[i]. Valeurs calculées à la main.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { disparity } from "./disparity";

/** Bougies dont le close = source par défaut (hlc3 = close si o=h=l=c). */
function candlesClose(vals: number[]): Candle[] {
  return vals.map((v) => ({ time: 0, open: v, high: v, low: v, close: v, volume: 1 }));
}
function ctx(src: number[]) {
  return { hl2: src, hlc3: src, ohlc4: src, source: src };
}

describe("disparity", () => {
  it("length=3 : undefined avant la MM pleine, puis écart % au SMA", () => {
    const src = [10, 20, 30, 40]; // SMA3 : idx2=(10+20+30)/3=20 ; idx3=(20+30+40)/3=30
    const res = disparity.calc(candlesClose(src), { length: 3 }, ctx(src));
    // idx2 : 100*(30-20)/20 = 50 ; idx3 : 100*(40-30)/30 = 33.333…
    expect(res.series.disparity?.[0]).toBeUndefined();
    expect(res.series.disparity?.[1]).toBeUndefined();
    expect(res.series.disparity?.[2]).toBeCloseTo(50, 9);
    expect(res.series.disparity?.[3]).toBeCloseTo(100 / 3, 9);
  });

  it("prix = MM → disparité 0", () => {
    const src = [5, 5, 5, 5];
    const res = disparity.calc(candlesClose(src), { length: 2 }, ctx(src));
    expect(res.series.disparity?.[3]).toBe(0);
  });

  it("métadonnées (momentum, separate)", () => {
    expect(disparity.category).toBe("momentum");
    expect(disparity.pane).toBe("separate");
  });
});
