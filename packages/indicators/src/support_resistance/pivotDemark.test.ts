/**
 * @axiom/indicators — support_resistance/pivotDemark.test.ts
 *
 * On teste les TROIS branches de X (C<O, C>O, C=O), chacune hand-calc, en plaçant
 * trois bougies sources successives. L'index i utilise la bougie i-1.
 *
 *   bougie 0 : O=11,H=12,L=8,C=10  (C<O) -> X = H+2L+C = 12+16+10 = 38
 *              PP = 38/4 = 9.5 ; R1 = 19−8 = 11 ; S1 = 19−12 = 7   (lus à l'index 1)
 *   bougie 1 : O=10,H=12,L=8,C=11  (C>O) -> X = 2H+L+C = 24+8+11 = 43
 *              PP = 43/4 = 10.75 ; R1 = 21.5−8 = 13.5 ; S1 = 21.5−12 = 9.5  (index 2)
 *   bougie 2 : O=10,H=12,L=8,C=10  (C=O) -> X = H+L+2C = 12+8+20 = 40
 *              PP = 40/4 = 10 ; R1 = 20−8 = 12 ; S1 = 20−12 = 8   (index 3)
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { pivotDemark } from "./pivotDemark";

function candles(rows: { o: number; h: number; l: number; c: number }[]): Candle[] {
  return rows.map((r, i) => ({
    time: i * 60_000,
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: 0,
  }));
}

describe("Pivot Points DeMark", () => {
  it("couvre les trois branches de X (hand-calc)", () => {
    const cs = candles([
      { o: 11, h: 12, l: 8, c: 10 }, // C<O
      { o: 10, h: 12, l: 8, c: 11 }, // C>O
      { o: 10, h: 12, l: 8, c: 10 }, // C=O
      { o: 10, h: 11, l: 9, c: 10 }, // bougie supplémentaire (non lue)
    ]);
    const { series } = computeIndicator(pivotDemark, cs, {});

    const pp = series.pp;
    const r1 = series.r1;
    const s1 = series.s1;
    if (pp === undefined || r1 === undefined || s1 === undefined) {
      throw new Error("séries DeMark absentes");
    }

    expect(pp.length).toBe(cs.length);
    expect(pp[0]).toBeUndefined(); // bougie 0 sans précédente

    // C<O (depuis bougie 0)
    expect(pp[1]).toBeCloseTo(9.5, 9);
    expect(r1[1]).toBeCloseTo(11, 9);
    expect(s1[1]).toBeCloseTo(7, 9);

    // C>O (depuis bougie 1)
    expect(pp[2]).toBeCloseTo(10.75, 9);
    expect(r1[2]).toBeCloseTo(13.5, 9);
    expect(s1[2]).toBeCloseTo(9.5, 9);

    // C=O (depuis bougie 2)
    expect(pp[3]).toBeCloseTo(10, 9);
    expect(r1[3]).toBeCloseTo(12, 9);
    expect(s1[3]).toBeCloseTo(8, 9);

    // Invariant d'ordre S1 ≤ PP ≤ R1.
    for (let i = 1; i < cs.length; i++) {
      expect(s1[i]! <= pp[i]!).toBe(true);
      expect(pp[i]! <= r1[i]!).toBe(true);
    }
  });
});
