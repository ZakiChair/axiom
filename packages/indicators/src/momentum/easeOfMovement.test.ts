/**
 * @axiom/indicators — momentum/easeOfMovement.test.ts
 *
 * EMV avec length = 2 pour rendre la SMA traçable à la main.
 *
 *   Bar0 : h=12 l=8  vol=100 -> hl2=10
 *   Bar1 : h=14 l=10 vol=200 -> hl2=12 ; emv1 = (12-10)*(14-10)/200 =  8/200 =  0.04
 *   Bar2 : h=13 l=9  vol=50  -> hl2=11 ; emv1 = (11-12)*(13-9)/50   = -4/50  = -0.08
 *   Bar3 : h=16 l=12 vol=400 -> hl2=14 ; emv1 = (14-11)*(16-12)/400 = 12/400 =  0.03
 *
 *   SMA(emv1, 2) :
 *     out[2] = (0.04 + (-0.08)) / 2 = -0.02
 *     out[3] = ((-0.08) + 0.03) / 2 = -0.025
 *   out[0], out[1] : fenêtre non pleine -> undefined.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { easeOfMovement } from "./easeOfMovement";

const bars: Candle[] = [
  { time: 0, open: 10, high: 12, low: 8, close: 10, volume: 100 },
  { time: 1, open: 12, high: 14, low: 10, close: 12, volume: 200 },
  { time: 2, open: 11, high: 13, low: 9, close: 11, volume: 50 },
  { time: 3, open: 14, high: 16, low: 12, close: 14, volume: 400 },
];

describe("Ease of Movement (EMV)", () => {
  it("calcule la SMA exacte (length=2) et laisse undefined avant la fenêtre pleine", () => {
    const { series } = computeIndicator(easeOfMovement, bars, { length: 2 });
    const out = series.emv;
    if (out === undefined) throw new Error("série emv absente");

    expect(out.length).toBe(bars.length);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeCloseTo(-0.02, 12);
    expect(out[3]).toBeCloseTo(-0.025, 12);
  });
});
