/**
 * Liquidations Bybit — parse pur + convention de côté (S=Sell→long liquidé,
 * S=Buy→short liquidé) figée contre une inversion silencieuse ; résumé notionnel.
 * Format vérifié en réel : {topic:"allLiquidation.BTCUSDT", data:[{T,s,S,v,p}]}.
 */
import { describe, expect, it } from "vitest";
import { parseBybitLiquidation, resumerLiquidations, type Liquidation } from "./liquidations";

describe("parseBybitLiquidation", () => {
  it("S=Sell (taker vend) => position LONGUE liquidée", () => {
    expect(parseBybitLiquidation({ T: 1000, s: "BTCUSDT", S: "Sell", v: "2", p: "100" })?.side).toBe("long");
  });
  it("S=Buy (taker rachète) => position COURTE liquidée", () => {
    expect(parseBybitLiquidation({ T: 1000, s: "BTCUSDT", S: "Buy", v: "2", p: "100" })?.side).toBe("short");
  });
  it("calcule le notionnel v × p", () => {
    const l = parseBybitLiquidation({ T: 1, s: "BTCUSDT", S: "Sell", v: "0.007", p: "65513.30" });
    expect(l?.qty).toBe(0.007);
    expect(l?.price).toBe(65513.3);
    expect(l?.notionalUsd).toBeCloseTo(458.5931, 4);
  });
  it("rejette une entrée illisible (côté inconnu, prix ≤ 0, non numérique)", () => {
    expect(parseBybitLiquidation({ S: "X", v: "1", p: "1" })).toBeNull();
    expect(parseBybitLiquidation({ S: "Buy", v: "1", p: "0" })).toBeNull();
    expect(parseBybitLiquidation({ S: "Sell", v: "x", p: "1" })).toBeNull();
  });
});

describe("resumerLiquidations", () => {
  it("agrège le notionnel long/short et la part longue", () => {
    const liqs: Liquidation[] = [
      { time: 1, side: "long", qty: 1, price: 100, notionalUsd: 100 },
      { time: 2, side: "long", qty: 1, price: 200, notionalUsd: 200 },
      { time: 3, side: "short", qty: 1, price: 100, notionalUsd: 100 },
    ];
    expect(resumerLiquidations(liqs)).toEqual({ longUsd: 300, shortUsd: 100, total: 400, partLong: 0.75 });
  });
  it("part longue = null si aucune liquidation", () => {
    expect(resumerLiquidations([]).partLong).toBeNull();
  });
});
