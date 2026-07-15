/**
 * @axiom/indicators — indicateurs de cycle on-chain BTC (NUPL, Puell, SOPR, Reserve
 * Risk). Tous recopient leur série aux respective (bitcoin-data.com / BGeometrics) sur
 * l'index des bougies, sans fetch (moteur pur). Test paramétré : copie fidèle + tolérance
 * à l'absence d'aux + métadonnées (pane separate, catégorie derivatives, 1d).
 */
import { describe, it, expect } from "vitest";
import type { AuxSeriesId, Candle, IndicatorDef } from "@axiom/types";
import { nupl } from "./nupl";
import { puell } from "./puell";
import { sopr } from "./sopr";
import { reserveRisk } from "./reserveRisk";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

const CAS: Array<{ def: IndicatorDef; aux: AuxSeriesId; out: string }> = [
  { def: nupl, aux: "nupl", out: "nupl" },
  { def: puell, aux: "puell", out: "puell" },
  { def: sopr, aux: "sopr", out: "sopr" },
  { def: reserveRisk, aux: "reserveRisk", out: "reserveRisk" },
];

describe.each(CAS)("indicateur on-chain $aux", ({ def, aux, out }) => {
  it("recopie la série aux sur l'index des bougies", () => {
    const c = candles(3);
    const serie = [0.1, undefined, 0.3];
    const res = def.calc(c, {}, { ...baseCtx, aux: { [aux]: serie } });
    expect(res.series[out]).toEqual([0.1, undefined, 0.3]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(3);
    expect(() => def.calc(c, {}, baseCtx)).not.toThrow();
    expect(def.calc(c, {}, baseCtx).series[out]).toEqual([undefined, undefined, undefined]);
  });

  it("métadonnées conformes (aux dédié, separate, 1d)", () => {
    expect(def.aux).toEqual([aux]);
    expect(def.pane).toBe("separate");
    expect(def.category).toBe("derivatives");
    expect(def.minTimeframe).toBe("1d");
  });
});
