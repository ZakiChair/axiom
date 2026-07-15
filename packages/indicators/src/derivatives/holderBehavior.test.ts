/**
 * @axiom/indicators — indicateurs de comportement des détenteurs (aSOPR, STH-SOPR,
 * LTH-SOPR, RHODL Ratio). Tous recopient leur aux respective (bitcoin-data.com) sur
 * l'index des bougies (moteur pur). Test paramétré.
 */
import { describe, it, expect } from "vitest";
import type { AuxSeriesId, Candle, IndicatorDef } from "@axiom/types";
import { asopr } from "./asopr";
import { sthSopr } from "./sthSopr";
import { lthSopr } from "./lthSopr";
import { rhodlRatio } from "./rhodlRatio";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

const CAS: Array<{ def: IndicatorDef; aux: AuxSeriesId; out: string }> = [
  { def: asopr, aux: "asopr", out: "asopr" },
  { def: sthSopr, aux: "sthSopr", out: "sthSopr" },
  { def: lthSopr, aux: "lthSopr", out: "lthSopr" },
  { def: rhodlRatio, aux: "rhodl", out: "rhodlRatio" },
];

describe.each(CAS)("indicateur détenteurs $aux", ({ def, aux, out }) => {
  it("recopie la série aux sur l'index des bougies", () => {
    const c = candles(3);
    const res = def.calc(c, {}, { ...baseCtx, aux: { [aux]: [1.01, undefined, 0.98] } });
    expect(res.series[out]).toEqual([1.01, undefined, 0.98]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(2);
    expect(() => def.calc(c, {}, baseCtx)).not.toThrow();
    expect(def.calc(c, {}, baseCtx).series[out]).toEqual([undefined, undefined]);
  });

  it("métadonnées conformes (aux dédié, separate, 1d)", () => {
    expect(def.aux).toEqual([aux]);
    expect(def.pane).toBe("separate");
    expect(def.minTimeframe).toBe("1d");
  });
});
