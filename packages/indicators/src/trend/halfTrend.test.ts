import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { halfTrend } from "./halfTrend";

describe("halfTrend", () => {
  it("produit une ligne et une direction ±1 sur une tendance", () => {
    const candles: Candle[] = Array.from({ length: 120 }, (_, i) => ({
      time: i,
      open: 100 + i * 0.5,
      high: 101 + i * 0.5,
      low: 99 + i * 0.5,
      close: 100.5 + i * 0.5,
      volume: 1,
    }));
    const { series } = halfTrend.calc(
      candles,
      { amplitude: 2, atrPeriod: 20 },
      { hl2: [], hlc3: [], ohlc4: [], source: candles.map((c) => c.close) },
    );
    expect(series.line?.[119]).toBeDefined();
    const dir = series.direction?.[119];
    expect(dir === 1 || dir === -1).toBe(true);
  });

  it("pullback léger en tendance haussière : PAS de bascule parasite (règle canonique)", () => {
    // Montée +2/barre, pullback de 2 barres (closes −1 puis −0,5, avec
    // close < low[1]) puis reprise : la SMA(high, amplitude) reste AU-DESSUS
    // du plus haut des creux ratcheté → le HalfTrend canonique ne bascule PAS.
    // (L'ancienne règle `close < maxLowPrice` basculait ici : direction −1
    // parasite aux barres 30-31.)
    const closes: number[] = [];
    let p = 100;
    for (let i = 0; i < 30; i++) {
      p += 2;
      closes.push(p);
    }
    closes.push(p - 1);
    closes.push(p - 1.5);
    p = p - 1.5;
    for (let i = 0; i < 28; i++) {
      p += 2;
      closes.push(p);
    }
    const candles: Candle[] = closes.map((close, i) => ({
      time: i,
      open: close,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1,
    }));
    const { series } = halfTrend.calc(
      candles,
      { amplitude: 2, atrPeriod: 10 },
      { hl2: [], hlc3: [], ohlc4: [], source: closes },
    );
    const barresBaissieres = (series.direction ?? [])
      .map((d, i) => (d === -1 ? i : -1))
      .filter((i) => i >= 0);
    expect(barresBaissieres).toEqual([]);
  });

  it("cassure franche : bascule haussière → baissière, un seul flip", () => {
    // 60 barres +2/barre puis 60 barres −2/barre : SMA(high, amplitude) passe
    // sous maxLowPrice ET close < low[1] → bascule baissière obligatoire,
    // unique (pas de flip-flop).
    const closes: number[] = [];
    let p = 100;
    for (let i = 0; i < 60; i++) {
      p += 2;
      closes.push(p);
    }
    for (let i = 0; i < 60; i++) {
      p -= 2;
      closes.push(p);
    }
    const candles: Candle[] = closes.map((close, i) => ({
      time: i,
      open: close,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1,
    }));
    const { series } = halfTrend.calc(
      candles,
      { amplitude: 2, atrPeriod: 10 },
      { hl2: [], hlc3: [], ohlc4: [], source: closes },
    );
    expect(series.direction?.[40]).toBe(1); // en pleine montée : haussier
    expect(series.direction?.[119]).toBe(-1); // après la cassure : baissier
    let flips = 0;
    for (let i = 1; i < 120; i++) {
      const d = series.direction?.[i];
      const dPrev = series.direction?.[i - 1];
      if (d !== undefined && dPrev !== undefined && d !== dPrev) flips++;
    }
    expect(flips).toBe(1);
    expect(series.line?.[119]).toBeDefined();
  });
});
