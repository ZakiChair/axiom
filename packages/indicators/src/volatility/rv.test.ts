/**
 * @axiom/indicators — volatility/rv.test.ts
 *
 * Tests pour RV (Volatilité Réalisée annualisée).
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { rv } from "./rv";

describe("rv — Realized Volatility (annualisée)", () => {
  it("retourne undefined tant que la fenêtre n'est pas pleine", () => {
    // Closes: [100, 110, 104.5, 115, 120]
    const candles: Candle[] = [
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { time: 1, open: 110, high: 111, low: 109, close: 110, volume: 1000 },
      { time: 2, open: 105, high: 106, low: 104, close: 104.5, volume: 1000 },
      { time: 3, open: 114, high: 116, low: 113, close: 115, volume: 1000 },
      { time: 4, open: 119, high: 121, low: 118, close: 120, volume: 1000 },
    ];

    const params = { length: 3, periodesParAn: 365 };
    const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

    const result = rv.calc(candles, params, ctx);
    const rvOut = result.series.rv as Array<number | undefined>;

    // Avec length=3, la fenêtre commence à i-length+1, donc:
    // - À i=0: fenêtre [0-2..-1] — invalide
    // - À i=1: fenêtre [-1..1] — invalide
    // - À i=2: fenêtre [0..2] — invalid (logReturns[0] = undefined)
    // - À i=3: fenêtre [1..3] — valide (3 logReturns définis)
    expect(rvOut[0]).toBeUndefined();
    expect(rvOut[1]).toBeUndefined();
    expect(rvOut[2]).toBeUndefined(); // Encore undefined (fenêtre non pleine)
    expect(rvOut[3]).toBeDefined(); // À partir de l'index 3, fenêtre pleine
  });

  it("calcule RV avec length=3, periodesParAn=365 sur une série connue", () => {
    // Closes: [100, 110, 104.5, 115]
    // logRet (compact, logRet[j] correspond à close[j+1]):
    //   r1 = ln(110/100)   = 0.0953101798...
    //   r2 = ln(104.5/110) = -0.0512932944...
    //   r3 = ln(115/104.5) = 0.0957450570...
    // À i=3 (index 3) : window = [r1, r2, r3] (les 3 seules valeurs, length=3)
    // r1² = 0.0090840304..., r2² = 0.0026310020..., r3² = 0.0091671159...
    // sum   = r1 + r2 + r3    = 0.1397619424...
    // sumSq = r1² + r2² + r3² = 0.0208821484...
    // sum²/length = (0.1397619424)^2 / 3 = 0.0065111335...
    // variance_pop = (sumSq - sum²/length) / length
    //              = (0.0208821484 - 0.0065111335) / 3
    //              = 0.0143710149 / 3
    //              = 0.0047903383
    // stdev = sqrt(0.0047903383) = 0.0692122697...
    // rv = 0.0692122697 * sqrt(365) * 100
    //    = 0.0692122697 * 19.1049731745 * 100
    //    = 132.2298556528...%
    //
    // Valeur attendue (hand-calculated): ~132.23%

    const candles: Candle[] = [
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { time: 1, open: 110, high: 111, low: 109, close: 110, volume: 1000 },
      { time: 2, open: 105, high: 106, low: 104, close: 104.5, volume: 1000 },
      { time: 3, open: 114, high: 116, low: 113, close: 115, volume: 1000 },
    ];

    const params = { length: 3, periodesParAn: 365 };
    const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

    const result = rv.calc(candles, params, ctx);
    const rvOut = result.series.rv as Array<number | undefined>;

    // À i=3, on a la première valeur définie
    // Les calculs manuels donnent ~132.23%
    expect(rvOut[3]).toBeCloseTo(132.23, 1);
  });

  it("réagit à la variation de periodesParAn (365 vs 252)", () => {
    // Même série de closes
    const candles: Candle[] = [
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { time: 1, open: 110, high: 111, low: 109, close: 110, volume: 1000 },
      { time: 2, open: 105, high: 106, low: 104, close: 104.5, volume: 1000 },
      { time: 3, open: 114, high: 116, low: 113, close: 115, volume: 1000 },
    ];

    const params365 = { length: 3, periodesParAn: 365 };
    const params252 = { length: 3, periodesParAn: 252 };
    const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

    const result365 = rv.calc(candles, params365, ctx);
    const result252 = rv.calc(candles, params252, ctx);

    const rvOut365 = result365.series.rv as Array<number | undefined>;
    const rvOut252 = result252.series.rv as Array<number | undefined>;

    const rv365 = rvOut365[3];
    const rv252 = rvOut252[3];

    // rv365 / rv252 = sqrt(365/252) ≈ 1.206
    expect(rv365).toBeDefined();
    expect(rv252).toBeDefined();
    if (rv365 !== undefined && rv252 !== undefined) {
      expect(rv365 / rv252).toBeCloseTo(Math.sqrt(365 / 252), 2);
    }
  });

  it("retourne undefined pour les indices avant length", () => {
    const candles: Candle[] = [
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { time: 1, open: 110, high: 111, low: 109, close: 110, volume: 1000 },
      { time: 2, open: 105, high: 106, low: 104, close: 104.5, volume: 1000 },
      { time: 3, open: 114, high: 116, low: 113, close: 115, volume: 1000 },
      { time: 4, open: 119, high: 121, low: 118, close: 120, volume: 1000 },
      { time: 5, open: 124, high: 126, low: 122, close: 125, volume: 1000 },
    ];

    const params = { length: 5, periodesParAn: 365 };
    const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

    const result = rv.calc(candles, params, ctx);
    const rvOut = result.series.rv as Array<number | undefined>;

    // Avec length=5, on a besoin d'au moins 6 closes pour avoir une première valeur définie
    // (car on besoin de 5 logReturns: logReturns[1..5])
    // Donc les indices 0-4 doivent être undefined, et l'index 5 doit être défini
    expect(rvOut[0]).toBeUndefined();
    expect(rvOut[1]).toBeUndefined();
    expect(rvOut[2]).toBeUndefined();
    expect(rvOut[3]).toBeUndefined();
    expect(rvOut[4]).toBeUndefined();
    expect(rvOut[5]).toBeDefined();
  });

  it("utilise les paramètres par défaut (length=30, periodesParAn=365)", () => {
    // Crée une série avec au moins 31 closes pour avoir une première valeur définie
    const candles: Candle[] = [];
    for (let i = 0; i < 32; i++) {
      candles.push({
        time: i,
        open: 100 + i * 0.5,
        high: 101 + i * 0.5,
        low: 99 + i * 0.5,
        close: 100 + i * 0.5,
        volume: 1000,
      });
    }

    // Paramètres sans spécifier length ni periodesParAn (doivent utiliser les défauts)
    const params = { length: 30, periodesParAn: 365 };
    const ctx: CalcContext = { hl2: [], hlc3: [], ohlc4: [] };

    const result = rv.calc(candles, params, ctx);
    const rvOut = result.series.rv as Array<number | undefined>;

    // À index 30, la première valeur doit être définie (window de 30 logReturns)
    expect(rvOut[30]).toBeDefined();
    expect(rvOut[29]).toBeUndefined();
  });
});
