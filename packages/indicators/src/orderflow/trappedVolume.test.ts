import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { trappedVolume } from "./trappedVolume";

function c(partial: Partial<Candle> & Pick<Candle, "time" | "close">): Candle {
  return {
    open: partial.close,
    high: partial.close,
    low: partial.close,
    volume: 0,
    ...partial,
  };
}

const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("trappedVolume", () => {
  it("undefined tant que la fenêtre n'est pas pleine", () => {
    const candles = [
      c({ time: 1, close: 100, high: 100, low: 90, volume: 10 }),
      c({ time: 2, close: 100, high: 100, low: 90, volume: 10 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    expect(series.trappedLong).toEqual([undefined, undefined]);
    expect(series.trappedShort).toEqual([undefined, undefined]);
  });

  it("compte au nord le volume traité au-dessus du close courant", () => {
    // Fenêtre pleine à i=2, close courant 95 : les deux barres [100,110] sont
    // entièrement au-dessus → tout leur volume = longs piégés.
    const candles = [
      c({ time: 1, close: 105, high: 110, low: 100, volume: 100 }),
      c({ time: 2, close: 105, high: 110, low: 100, volume: 50 }),
      c({ time: 3, close: 95, high: 96, low: 94, volume: 20 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    // barre courante : [94,96] vs P=95 → moitié au-dessus (10) / moitié en-dessous (10).
    expect(series.trappedLong?.[2]).toBeCloseTo(160);
    expect(series.trappedShort?.[2]).toBeCloseTo(-10);
  });

  it("compte au sud le volume traité en-dessous du close courant", () => {
    const candles = [
      c({ time: 1, close: 105, high: 110, low: 100, volume: 100 }),
      c({ time: 2, close: 105, high: 110, low: 100, volume: 50 }),
      c({ time: 3, close: 120, high: 122, low: 118, volume: 20 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    // 150 de volume entièrement sous 120 → shorts piégés ; barre courante coupée en 2.
    expect(series.trappedLong?.[2]).toBeCloseTo(10);
    expect(series.trappedShort?.[2]).toBeCloseTo(-160);
  });

  it("répartit uniformément une bougie qui chevauche le prix courant", () => {
    const candles = [
      c({ time: 1, close: 100, high: 110, low: 90, volume: 40 }),
      c({ time: 2, close: 100, high: 110, low: 90, volume: 40 }),
      c({ time: 3, close: 100, high: 110, low: 90, volume: 40 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    // P = 100, milieu de [90,110] → moitié au-dessus, moitié en-dessous.
    expect(series.trappedLong?.[2]).toBeCloseTo(60);
    expect(series.trappedShort?.[2]).toBeCloseTo(-60);
  });

  it("traite une bougie-point (high = low) comme tout-ou-rien", () => {
    const candles = [
      c({ time: 1, close: 105, high: 105, low: 105, volume: 30 }),
      c({ time: 2, close: 105, high: 105, low: 105, volume: 30 }),
      c({ time: 3, close: 100, high: 100, low: 100, volume: 10 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    // 105 > 100 → les deux points sont entièrement au nord ; le point courant à 100 est sous P ? non : low = P → fracAbove 0.
    expect(series.trappedLong?.[2]).toBeCloseTo(60);
    expect(series.trappedShort?.[2]).toBeCloseTo(-10);
  });

  it("ignore les trous de bougies dans la fenêtre", () => {
    const candles = [
      c({ time: 1, close: 105, high: 110, low: 100, volume: 100 }),
      undefined,
      c({ time: 3, close: 95, high: 96, low: 94, volume: 20 }),
    ] as Candle[];
    const { series } = trappedVolume.calc(candles, { length: 3 }, ctx);
    expect(series.trappedLong?.[2]).toBeCloseTo(110);
    expect(series.trappedShort?.[2]).toBeCloseTo(-10);
  });

  it("glisse la fenêtre : une barre sort de la fenêtre ne compte plus", () => {
    const candles = [
      c({ time: 1, close: 130, high: 130, low: 120, volume: 80 }), // sortira de la fenêtre à i=2
      c({ time: 2, close: 105, high: 110, low: 100, volume: 50 }),
      c({ time: 3, close: 95, high: 96, low: 94, volume: 20 }),
    ];
    const { series } = trappedVolume.calc(candles, { length: 2 }, ctx);
    // À i=2, fenêtre = barres 1..2 : la barre 0 (80 au nord) est exclue.
    expect(series.trappedLong?.[2]).toBeCloseTo(50 + 10);
    expect(series.trappedShort?.[2]).toBeCloseTo(-10);
    // À i=1, fenêtre = barres 0..1, P = 105 : barre 0 [120,130] tout au nord → 80 ;
    // barre 1 [100,110] → moitié → 25 au nord, 25 au sud.
    expect(series.trappedLong?.[1]).toBeCloseTo(105);
    expect(series.trappedShort?.[1]).toBeCloseTo(-25);
  });
});
