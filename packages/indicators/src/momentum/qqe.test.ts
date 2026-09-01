import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { qqe } from "./qqe";

describe("qqe", () => {
  it("produit une ligne QQE bornée après amorçage", () => {
    const candles: Candle[] = Array.from({ length: 80 }, (_, i) => {
      const close = 100 + Math.sin(i / 5) * 3 + i * 0.05;
      return {
        time: i,
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1,
      };
    });
    const source = candles.map((c) => c.close);
    const { series } = qqe.calc(
      candles,
      { rsiLength: 14, sf: 5, factor: 4.236 },
      { hl2: [], hlc3: [], ohlc4: [], source },
    );
    const last = series.qqe?.[79];
    expect(last).toBeDefined();
    expect(last!).toBeGreaterThanOrEqual(0);
    expect(last!).toBeLessThanOrEqual(100);
    expect(series.fast?.[79]).toBeDefined();
    expect(series.slow?.[79]).toBeDefined();
  });

  it("bascule de tendance : fast/slow échangent de côté quand le RSI lissé traverse les bandes", () => {
    // 5 phases de 40 barres à ±2 %/barre : le RSI lissé traverse franchement
    // les bandes à chaque retournement — le trend DOIT basculer (≥ 1 flip).
    // (Bug corrigé : tester rm contre les bandes DÉJÀ mises à jour rendait
    // rm > shortBand impossible → 0 flip sur toute la série.)
    const closes: number[] = [];
    let p = 100;
    for (let phase = 0; phase < 5; phase++) {
      const pas = phase % 2 === 0 ? 1.02 : 0.98;
      for (let b = 0; b < 40; b++) {
        p *= pas;
        closes.push(p);
      }
    }
    const candles: Candle[] = closes.map((close, i) => ({
      time: i,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1,
    }));
    const { series } = qqe.calc(
      candles,
      { rsiLength: 14, sf: 5, factor: 4.236 },
      { hl2: [], hlc3: [], ohlc4: [], source: closes },
    );
    let flips = 0;
    let dessous = 0; // barres avec fast < slow (trend long)
    let dessus = 0; // barres avec fast > slow (trend short/neutre)
    let prevSign: number | undefined;
    for (let i = 0; i < closes.length; i++) {
      const f = series.fast?.[i];
      const s = series.slow?.[i];
      if (f === undefined || s === undefined) continue;
      if (f < s) dessous++;
      else if (f > s) dessus++;
      const sign = Math.sign(f - s);
      if (prevSign !== undefined && sign !== 0 && sign !== prevSign) flips++;
      if (sign !== 0) prevSign = sign;
    }
    expect(flips).toBeGreaterThanOrEqual(1);
    expect(dessous).toBeGreaterThanOrEqual(1);
    expect(dessus).toBeGreaterThanOrEqual(1);
  });
});
