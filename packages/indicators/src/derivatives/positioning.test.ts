/**
 * @axiom/indicators — indicateurs de positionnement Binance futures (L/S comptes, L/S
 * top traders, taker buy/sell). Tous recopient leur aux respective sur l'index des
 * bougies (moteur pur). Test paramétré : copie + tolérance absence d'aux + métadonnées.
 */
import { describe, it, expect } from "vitest";
import type { AuxSeriesId, Candle, IndicatorDef } from "@axiom/types";
import { lsAccountRatio } from "./lsAccountRatio";
import { lsTopTraderRatio } from "./lsTopTraderRatio";
import { takerBuySellRatio } from "./takerBuySellRatio";

function candles(n: number): Candle[] {
  return new Array(n).fill(0).map(() => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
}
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

const CAS: Array<{ def: IndicatorDef; aux: AuxSeriesId; out: string }> = [
  { def: lsAccountRatio, aux: "lsAccount", out: "lsAccountRatio" },
  { def: lsTopTraderRatio, aux: "lsTopTrader", out: "lsTopTraderRatio" },
  { def: takerBuySellRatio, aux: "lsTaker", out: "takerBuySellRatio" },
];

describe.each(CAS)("indicateur positionnement $aux", ({ def, aux, out }) => {
  it("recopie la série aux sur l'index des bougies", () => {
    const c = candles(3);
    const res = def.calc(c, {}, { ...baseCtx, aux: { [aux]: [1.2, undefined, 0.9] } });
    expect(res.series[out]).toEqual([1.2, undefined, 0.9]);
  });

  it("aux absent → tout undefined, jamais de throw", () => {
    const c = candles(2);
    expect(() => def.calc(c, {}, baseCtx)).not.toThrow();
    expect(def.calc(c, {}, baseCtx).series[out]).toEqual([undefined, undefined]);
  });

  it("métadonnées conformes (aux dédié, separate, 1h)", () => {
    expect(def.aux).toEqual([aux]);
    expect(def.pane).toBe("separate");
    expect(def.category).toBe("derivatives");
    expect(def.minTimeframe).toBe("1h");
  });
});
