import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { liquidationsOi } from "./liquidationsOi";

const bougies: Candle[] = Array.from({ length: 3 }, (_, i) => ({ time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
const contexte = (l: Array<number | undefined>, s: Array<number | undefined>, oi: Array<number | undefined>) => ({
  hl2: [], hlc3: [], ohlc4: [], source: [], aux: { liqLongUsd: l, liqShortUsd: s, oiDebutLiqUsd: oi },
});

describe("intensité liquidations / OI initial", () => {
  it("ratios extrêmes représentables restent finis sans débordement intermédiaire", () => {
    const r = liquidationsOi.calc(bougies.slice(0, 1), {}, contexte([1e307], [1e307], [1e307]));
    expect(r.series.longs?.[0]).toBe(-100);
    expect(r.series.shorts?.[0]).toBe(100);
    expect(r.series.total?.[0]).toBe(200);
    expect(r.series.net?.[0]).toBe(0);
  });
  it("oracle USD : longs −2, shorts +1, total 3, net −1 %", () => {
    const r = liquidationsOi.calc(bougies.slice(0, 1), {}, contexte([200], [100], [10_000]));
    expect(r.series.longs).toEqual([-2]);
    expect(r.series.shorts).toEqual([1]);
    expect(r.series.total).toEqual([3]);
    expect(r.series.net).toEqual([-1]);
  });

  it("jambe manquante ou négative ne devient pas zéro ; total/net requièrent les deux", () => {
    const r = liquidationsOi.calc(bougies, {}, contexte([undefined, 0, -1], [100, undefined, 1], [10_000, 10_000, 10_000]));
    expect(r.series.longs).toEqual([undefined, 0, undefined]);
    expect(r.series.shorts).toEqual([1, undefined, 0.01]);
    expect(r.series.total).toEqual([undefined, undefined, undefined]);
    expect(r.series.net).toEqual([undefined, undefined, undefined]);
  });

  it("OI nul ou non fini bloque toutes les sorties ; aucun plafond à 100 %", () => {
    const r = liquidationsOi.calc(bougies, {}, contexte([200, 1, 1], [100, 1, 1], [100, 0, NaN]));
    expect(r.series.total).toEqual([300, undefined, undefined]);
  });
});
