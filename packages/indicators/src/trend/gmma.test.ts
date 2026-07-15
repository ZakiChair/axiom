/**
 * @axiom/indicators — trend/gmma.test.ts
 * GMMA = 12 EMA (6 court + 6 long) de la source. Vérifie la structure (12 séries) et
 * qu'une bande = l'EMA correspondante (délègue à `ema`, déjà testé).
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { gmma } from "./gmma";
import { ema } from "../utils";

function candlesClose(vals: number[]): Candle[] {
  return vals.map((v) => ({ time: 0, open: v, high: v, low: v, close: v, volume: 1 }));
}

describe("gmma", () => {
  it("produit 12 séries (EMA 3/5/8/10/12/15 + 30/35/40/45/50/60)", () => {
    const src = Array.from({ length: 70 }, (_, i) => 100 + i);
    const res = gmma.calc(candlesClose(src), {}, { hl2: [], hlc3: [], ohlc4: [], source: src });
    const cles = Object.keys(res.series).sort();
    expect(cles).toHaveLength(12);
    expect(cles).toContain("s3");
    expect(cles).toContain("l60");
  });

  it("la bande s5 est exactement l'EMA(5) de la source", () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const res = gmma.calc(candlesClose(src), {}, { hl2: [], hlc3: [], ohlc4: [], source: src });
    expect(res.series.s5).toEqual(ema(src, 5));
  });

  it("overlay, catégorie trend", () => {
    expect(gmma.pane).toBe("overlay");
    expect(gmma.category).toBe("trend");
    expect(gmma.outputs).toHaveLength(12);
  });
});
