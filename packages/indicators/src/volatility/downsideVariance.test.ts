import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { getIndicator } from "../registry";

function bars(returns: number[]): Candle[] {
  let close = 100;
  return [0, ...returns].map((r, i) => { close *= Math.exp(r); return { time: i * 60_000, open: close, high: close, low: close, close, volume: 1 }; });
}
function calc(c: Candle[], length = 3) {
  const def = getIndicator("downsideVariance");
  expect(def, "variance baissière raccordée au registre").toBeDefined();
  return computeIndicator(def!, c, { length });
}

describe("downsideVariance — semivariances autour de zéro", () => {
  it("sépare les variations quadratiques positives et négatives", () => {
    const r = calc(bars([0.1, -0.2, 0.1]));
    expect(r.series.down?.[2]).toBeUndefined();
    expect(r.series.down?.[3]).toBeCloseTo(100 * 4 / 6, 8);
    expect(r.series.up?.[3]).toBeCloseTo(100 * 2 / 6, 8);
    expect(r.series.down?.[3]! + r.series.up?.[3]!).toBeCloseTo(100, 8);
  });
  it("tout hausse vaut 0 % baissier, tout baisse 100 %, sans mouvement reste absent", () => {
    expect(calc(bars([0.1, 0.2, 0.1])).series.down?.[3]).toBe(0);
    expect(calc(bars([-0.1, -0.2, -0.1])).series.down?.[3]).toBe(100);
    expect(calc(bars([0, 0, 0])).series.down?.[3]).toBeUndefined();
  });
  it("un prix absent invalide la fenêtre entière sans créer un rendement nul", () => {
    const c = bars([0.1, -0.2, 0.1, 0.1, 0.1, -0.1]);
    c[2]!.close = NaN;
    const r = calc(c);
    expect(r.series.down?.slice(2, 6).every((v) => v === undefined)).toBe(true);
    expect(r.series.down?.[6]).toBeCloseTo(100 / 3, 8);
  });
  it("les futures bougies ne changent pas la part passée", () => {
    const c = bars([0.1, -0.2, 0.1, -0.4, 0.5]);
    expect(calc(c).series.down?.slice(0, 4)).toEqual(calc(c.slice(0, 4)).series.down);
  });
});
