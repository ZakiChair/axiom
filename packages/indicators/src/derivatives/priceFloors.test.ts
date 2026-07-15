/**
 * @axiom/indicators — modèles de plancher de prix on-chain (CVDD, Balanced Price).
 * Recopie de l'aux respective en OVERLAY sur le prix (USD). Moteur pur.
 */
import { describe, it, expect } from "vitest";
import type { AuxSeriesId, Candle, IndicatorDef } from "@axiom/types";
import { cvdd } from "./cvdd";
import { balancedPrice } from "./balancedPrice";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

const CAS: Array<{ def: IndicatorDef; aux: AuxSeriesId; out: string }> = [
  { def: cvdd, aux: "cvdd", out: "cvdd" },
  { def: balancedPrice, aux: "balancedPrice", out: "balancedPrice" },
];

describe.each(CAS)("plancher $aux", ({ def, aux, out }) => {
  it("recopie l'aux sur l'index des bougies", () => {
    const c = candles(3);
    const res = def.calc(c, {}, { ...baseCtx, aux: { [aux]: [13500, undefined, 28500] } });
    expect(res.series[out]).toEqual([13500, undefined, 28500]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(2);
    expect(() => def.calc(c, {}, baseCtx)).not.toThrow();
    expect(def.calc(c, {}, baseCtx).series[out]).toEqual([undefined, undefined]);
  });

  it("métadonnées : OVERLAY sur le prix (aux dédié, 1d)", () => {
    expect(def.pane).toBe("overlay");
    expect(def.aux).toEqual([aux]);
    expect(def.minTimeframe).toBe("1d");
  });
});
