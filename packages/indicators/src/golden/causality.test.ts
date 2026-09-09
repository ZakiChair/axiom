import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { getIndicator } from "../registry";

function bougie(time: number, open: number, high: number, low: number, close: number, volume: number): Candle {
  return { time, open, high, low, close, volume, closed: true };
}

function serie(id: string, output: string, candles: Candle[], params: Record<string, number | string>) {
  const def = getIndicator(id);
  if (def === undefined) throw new Error(`indicateur ${id} absent`);
  const values = computeIndicator(def, candles, params).series[output];
  if (values === undefined) throw new Error(`sortie ${id}.${output} absente`);
  return values;
}

describe("oracles numériques indépendants", () => {
  it("ATR(3) suit exactement le seed et la récurrence de Wilder", () => {
    const candles = [
      bougie(0, 10, 11, 9, 10, 1),
      bougie(1, 13, 14, 12, 13, 1),
      bougie(2, 12, 14, 11, 12, 1),
      bougie(3, 17, 18, 15, 17, 1),
    ];
    expect(serie("atr", "atr", candles, { length: 3 })).toEqual([undefined, undefined, 3, 4]);
  });

  it("RSI(3) utilise trois deltas puis le lissage Wilder", () => {
    const closes = [10, 12, 11, 14, 12];
    const values = serie("rsi", "rsi", closes.map((c, i) => bougie(i, c, c, c, c, 1)), { length: 3 });
    expect(values.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(values[3]).toBeCloseTo(250 / 3, 10);
    expect(values[4]).toBeCloseTo(500 / 9, 10);
  });

  it("Bollinger(3,2) emploie la variance population", () => {
    const candles = [1, 2, 3].map((c, i) => bougie(i, c, c, c, c, 1));
    expect(serie("bollinger", "basis", candles, { length: 3, mult: 2 })).toEqual([undefined, undefined, 2]);
    expect(serie("bollinger", "upper", candles, { length: 3, mult: 2 })[2]).toBeCloseTo(3.632993161855452, 12);
    expect(serie("bollinger", "lower", candles, { length: 3, mult: 2 })[2]).toBeCloseTo(0.367006838144548, 12);
  });

  it("RVOL compare uniquement les mêmes heures UTC strictement antérieures", () => {
    const J = 86_400_000;
    const candles = [10, 20, 30, 120].map((volume, i) => bougie(i * J, 1, 1, 1, 1, volume));
    expect(serie("rvolSeasonal", "references", candles, { jours: 84, minimum: 3, mode: "heure UTC" }))
      .toEqual([0, 1, 2, 3]);
    expect(serie("rvolSeasonal", "rvol", candles, { jours: 84, minimum: 3, mode: "heure UTC" }))
      .toEqual([undefined, undefined, undefined, 6]);
  });
});

describe("causalité par préfixe", () => {
  const H = 3_600_000;
  const candles = Array.from({ length: 80 }, (_, i) => {
    const close = 100 + Math.sin(i / 3) * 5 + i / 10;
    return bougie(i * H, close - 0.5, close + 2, close - 2, close, 10 + (i % 9));
  });

  it.each([
    ["atr", "atr", { length: 14 }, [13, 14, 38, 77]],
    ["rsi", "rsi", { length: 14 }, [13, 14, 38, 77]],
    ["bollinger", "upper", { length: 20, mult: 2 }, [18, 19, 38, 77]],
  ] as const)("%s.%s ne change jamais son passé", (id, output, params, prefixes) => {
    const complet = serie(id, output, candles, params);
    for (const k of prefixes) {
      const prefix = candles.slice(0, k + 1);
      const alterees = candles.map((c, i) => i <= k ? c : { ...c, high: 1e12 + i, low: 1, close: 1e12 - i, volume: 1e12 });
      expect(serie(id, output, prefix, params)).toEqual(complet.slice(0, k + 1));
      expect(serie(id, output, alterees, params).slice(0, k + 1)).toEqual(complet.slice(0, k + 1));
    }
  });

  it("RVOL ne change jamais les ratios historiques quand le futur varie", () => {
    const J = 86_400_000;
    const base = Array.from({ length: 12 }, (_, i) => bougie(i * J, 1, 1, 1, 1, 10 + i));
    const params = { jours: 84, minimum: 3, mode: "heure UTC" };
    const complet = serie("rvolSeasonal", "rvol", base, params);
    for (const k of [2, 3, 6, 10]) {
      const alterees = base.map((c, i) => i <= k ? c : { ...c, volume: 1e12 });
      expect(serie("rvolSeasonal", "rvol", base.slice(0, k + 1), params)).toEqual(complet.slice(0, k + 1));
      expect(serie("rvolSeasonal", "rvol", alterees, params).slice(0, k + 1)).toEqual(complet.slice(0, k + 1));
    }
  });
});
