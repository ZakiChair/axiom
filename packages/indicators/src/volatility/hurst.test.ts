/**
 * @axiom/indicators — volatility/hurst.test.ts
 *
 * Exposant de Hurst par R/S sur les log-rendements DÉMOYENNÉS. Le signal ne mesure pas
 * la tendance brute mais la persistance des rendements :
 *  - rendements en RUNS (bloc + puis bloc −) → cumul démoyenné s'écarte loin → H > 0.5 ;
 *  - rendements ALTERNÉS (±) → cumul démoyenné borné → H < 0.5.
 * Les deux cas sont calculables à la main (cf. valeurs ci-dessous).
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { hurst } from "./hurst";

const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

/** Construit des bougies dont les close suivent des log-rendements donnés (close[0]=100). */
function candlesFromReturns(returns: number[]): Candle[] {
  let close = 100;
  const out: Candle[] = [{ time: 0, open: close, high: close, low: close, close, volume: 1 }];
  for (const r of returns) {
    close = close * Math.exp(r);
    out.push({ time: 0, open: close, high: close, low: close, close, volume: 1 });
  }
  return out;
}

describe("hurst", () => {
  it("rendements en runs (10× +0.02 puis 10× −0.02) → H ≈ ln(10)/ln(20) > 0.5 (persistant)", () => {
    // window=20 sur 20 rendements : R = 0.2 (cumul démoyenné), S = 0.02 → R/S = 10.
    const returns = [...Array(10).fill(0.02), ...Array(10).fill(-0.02)];
    const c = candlesFromReturns(returns); // 21 bougies
    const res = hurst.calc(c, { window: 20 }, baseCtx);
    const h = res.series.hurst?.[20];
    expect(h as number).toBeCloseTo(Math.log(10) / Math.log(20), 6);
    expect(h as number).toBeGreaterThan(0.5);
  });

  it("rendements alternés (±0.01) → R/S = 1 → H ≈ 0 < 0.5 (anti-persistant)", () => {
    const returns = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const c = candlesFromReturns(returns);
    const res = hurst.calc(c, { window: 20 }, baseCtx);
    const h = res.series.hurst?.[20];
    expect(h as number).toBeCloseTo(0, 6);
    expect(h as number).toBeLessThan(0.5);
  });

  it("undefined tant que la fenêtre de rendements est incomplète", () => {
    const c = candlesFromReturns(Array(15).fill(0.01)); // 16 bougies < window+1
    const res = hurst.calc(c, { window: 20 }, baseCtx);
    expect(res.series.hurst).toEqual(new Array(16).fill(undefined));
  });

  it("métadonnées conformes (volatility, pane separate, pas d'aux)", () => {
    expect(hurst.id).toBe("hurst");
    expect(hurst.category).toBe("volatility");
    expect(hurst.pane).toBe("separate");
    expect(hurst.aux).toBeUndefined();
  });
});
