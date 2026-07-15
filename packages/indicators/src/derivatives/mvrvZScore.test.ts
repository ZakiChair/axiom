/**
 * @axiom/indicators — derivatives/mvrvZScore.test.ts
 *
 * MVRV Z-Score = z-score du ratio MVRV sur une fenêtre glissante (même mécanique que
 * Funding Z-Score, sur ctx.aux.mvrv). On réutilise la propriété exacte du pic isolé :
 * pour n−1 valeurs égales + 1 pic dans une fenêtre de taille n, le z-score du pic vaut
 * toujours sqrt(n−1).
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { mvrvZScore } from "./mvrvZScore";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("mvrvZScore", () => {
  it("ctx.aux absent → série entièrement undefined, jamais de throw", () => {
    const c = candles(35);
    expect(() => mvrvZScore.calc(c, { window: 30 }, baseCtx)).not.toThrow();
    expect(mvrvZScore.calc(c, { window: 30 }, baseCtx).series.mvrvZScore).toEqual(new Array(35).fill(undefined));
  });

  it("pic isolé sur fond constant → z(dernier point) = sqrt(window−1)", () => {
    const c = candles(35);
    const mvrv = new Array(35).fill(1.5);
    mvrv[34] = 3.5;
    const res = mvrvZScore.calc(c, { window: 30 }, { ...baseCtx, aux: { mvrv } });
    expect(res.series.mvrvZScore?.[34] as number).toBeCloseTo(Math.sqrt(29), 9);
    expect(res.series.mvrvZScore?.[28]).toBeUndefined(); // fenêtre incomplète
  });

  it("métadonnées conformes (aux mvrv, pane separate, 1d)", () => {
    expect(mvrvZScore.id).toBe("mvrvZScore");
    expect(mvrvZScore.category).toBe("derivatives");
    expect(mvrvZScore.aux).toEqual(["mvrv"]);
    expect(mvrvZScore.minTimeframe).toBe("1d");
  });
});
