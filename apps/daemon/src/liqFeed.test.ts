import { describe, expect, it } from "bun:test";
import { parseBybitLiqDaemon, SYMBOLES_DEFAUT, symbolesSurveilles } from "./liqFeed";

describe("parseBybitLiqDaemon", () => {
  it("parse une entrée réelle Bybit (S=Sell → long liquidé, venue bybit)", () => {
    const liq = parseBybitLiqDaemon({ T: 1700000000000, s: "BTCUSDT", S: "Sell", v: "0.007", p: "65513.30" });
    expect(liq).not.toBeNull();
    expect(liq?.t).toBe(1700000000000);
    expect(liq?.venue).toBe("bybit");
    expect(liq?.side).toBe("long");
    expect(liq?.price).toBe(65513.3);
    expect(liq?.qty).toBe(0.007);
    expect(liq?.usd).toBeCloseTo(458.6, 1);
  });

  it("convention figée : S=Buy → short liquidé", () => {
    expect(parseBybitLiqDaemon({ T: 1, S: "Buy", v: "1", p: "10" })?.side).toBe("short");
  });

  it("rejette une entrée illisible (prix<=0, S invalide, non-objet)", () => {
    expect(parseBybitLiqDaemon({ T: 1, S: "Sell", v: "1", p: "0" })).toBeNull();
    expect(parseBybitLiqDaemon({ T: 1, S: "Long", v: "1", p: "10" })).toBeNull();
    expect(parseBybitLiqDaemon(null)).toBeNull();
    expect(parseBybitLiqDaemon("x")).toBeNull();
  });
});

describe("symbolesSurveilles", () => {
  it("repli sur le défaut quand la valeur KV est absente ou invalide", () => {
    const defaut = [...SYMBOLES_DEFAUT];
    expect(symbolesSurveilles(undefined)).toEqual(defaut);
    expect(symbolesSurveilles(null)).toEqual(defaut);
    expect(symbolesSurveilles([])).toEqual(defaut);
  });

  it("normalise la liste KV en majuscules (dédoublonnée)", () => {
    expect(symbolesSurveilles(["dogeusdt"])).toEqual(["DOGEUSDT"]);
    expect(symbolesSurveilles(["btcusdt", "BTCUSDT", " ethusdt "])).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
});
