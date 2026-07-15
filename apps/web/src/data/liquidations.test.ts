/**
 * Liquidations Binance — parse pur + convention de côté (SELL=long liquidé,
 * BUY=short liquidé) figée contre une inversion silencieuse ; résumé notionnel.
 */
import { describe, expect, it } from "vitest";
import { parseForceOrder, resumerLiquidations, type Liquidation } from "./liquidations";

function msg(S: "BUY" | "SELL", q: string, p: string): unknown {
  return { e: "forceOrder", o: { s: "BTCUSDT", S, q, p, T: 1000 } };
}

describe("parseForceOrder", () => {
  it("SELL (ordre) => position LONGUE liquidée", () => {
    expect(parseForceOrder(msg("SELL", "2", "100"))?.side).toBe("long");
  });
  it("BUY (ordre) => position COURTE liquidée", () => {
    expect(parseForceOrder(msg("BUY", "2", "100"))?.side).toBe("short");
  });
  it("calcule le notionnel qty × prix et préfère ap (prix moyen) si présent", () => {
    const l = parseForceOrder(msg("SELL", "3", "100"));
    expect(l?.notionalUsd).toBe(300);
    const withAp = parseForceOrder({ e: "forceOrder", o: { S: "BUY", q: "1", p: "100", ap: "105", T: 1 } });
    expect(withAp?.price).toBe(105);
    expect(withAp?.notionalUsd).toBe(105);
  });
  it("rejette un message illisible (pas d'objet o, côté inconnu, prix ≤ 0)", () => {
    expect(parseForceOrder({ e: "forceOrder" })).toBeNull();
    expect(parseForceOrder({ e: "forceOrder", o: { S: "X", q: "1", p: "1" } })).toBeNull();
    expect(parseForceOrder({ e: "forceOrder", o: { S: "BUY", q: "1", p: "0" } })).toBeNull();
    expect(parseForceOrder({ e: "aggTrade", o: { S: "BUY", q: "1", p: "1" } })).toBeNull();
  });
});

describe("resumerLiquidations", () => {
  it("agrège le notionnel long/short et la part longue", () => {
    const liqs: Liquidation[] = [
      { time: 1, side: "long", qty: 1, price: 100, notionalUsd: 100 },
      { time: 2, side: "long", qty: 1, price: 200, notionalUsd: 200 },
      { time: 3, side: "short", qty: 1, price: 100, notionalUsd: 100 },
    ];
    const r = resumerLiquidations(liqs);
    expect(r).toEqual({ longUsd: 300, shortUsd: 100, total: 400, partLong: 0.75 });
  });
  it("part longue = null si aucune liquidation", () => {
    expect(resumerLiquidations([]).partLong).toBeNull();
  });
});
