/**
 * @axiom/indicators — volatility/vhf.test.ts
 * VHF = (maxClose − minClose sur n) / Σ|Δclose| sur n. Valeurs calculées à la main.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { vhf } from "./vhf";

function candlesClose(vals: number[]): Candle[] {
  return vals.map((v) => ({ time: 0, open: v, high: v, low: v, close: v, volume: 1 }));
}
const noCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("vhf", () => {
  it("tendance pure (monotone) → VHF = 1 (déplacement net = somme des mouvements)", () => {
    // close monotone : |Δ| tous positifs → numérateur = dénominateur.
    const src = [10, 12, 14, 16]; // length=3 à idx3 : HH-LL=16-12=4 ; Σ|Δ| idx1..3=2+2+2=6 → 4/6
    const res = vhf.calc(candlesClose(src), { length: 3 }, noCtx);
    // idx3 : HH(14,16 sur close[1..3]=12,14,16)=16, LL=12 → 4 ; Σ|Δ| sur 3 = |14-12|+|16-14|...
    // fenêtre rollingSum length=3 à idx3 = absChange[1]+[2]+[3] = 2+2+2 = 6 → 4/6 = 0.6667
    expect(res.series.vhf?.[3]).toBeCloseTo(4 / 6, 9);
  });

  it("aller-retour (range) → VHF bas (amplitude nette faible vs mouvements)", () => {
    // oscillation : HH-LL petit, Σ|Δ| grand → VHF < tendance.
    const src = [10, 12, 10, 12]; // idx3 length=3 : close[1..3]=12,10,12 → HH=12,LL=10 →2 ; Σ|Δ|=2+2+2=6 → 0.333
    const res = vhf.calc(candlesClose(src), { length: 3 }, noCtx);
    expect(res.series.vhf?.[3]).toBeCloseTo(2 / 6, 9);
  });

  it("undefined tant que la fenêtre n'est pas pleine", () => {
    const src = [10, 12];
    const res = vhf.calc(candlesClose(src), { length: 3 }, noCtx);
    expect(res.series.vhf?.[1]).toBeUndefined();
  });
});
