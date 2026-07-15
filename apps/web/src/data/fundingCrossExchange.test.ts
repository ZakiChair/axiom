/**
 * Funding cross-exchange — logique PURE : annualisation (bases d'intervalle
 * différentes rendues comparables), parsers par venue, calcul du spread.
 */
import { describe, expect, it } from "vitest";
import {
  annualiserFunding,
  fundingSpreadApr,
  parseBinanceFunding,
  parseBybitFunding,
  parseHyperliquidFunding,
  parseOkxFunding,
  type FundingVenue,
} from "./fundingCrossExchange";

describe("annualiserFunding", () => {
  it("rend comparables un taux 8 h et un taux 1 h (même APR)", () => {
    // 0.0001/8h et 0.0000125/1h correspondent au même APR (10,95 %).
    expect(annualiserFunding(0.0001, 8)).toBeCloseTo(10.95, 6);
    expect(annualiserFunding(0.0000125, 1)).toBeCloseTo(10.95, 6);
  });

  it("renvoie NaN pour un intervalle nul/invalide", () => {
    expect(annualiserFunding(0.0001, 0)).toBeNaN();
  });
});

describe("parsers de funding", () => {
  it("Binance : lastFundingRate", () => {
    expect(parseBinanceFunding({ symbol: "BTCUSDT", lastFundingRate: "0.00010000" })).toBe(0.0001);
    expect(parseBinanceFunding({})).toBeNull();
  });
  it("Bybit : result.list[0].fundingRate", () => {
    expect(parseBybitFunding({ result: { list: [{ fundingRate: "0.0001" }] } })).toBe(0.0001);
    expect(parseBybitFunding({ result: { list: [] } })).toBeNull();
  });
  it("OKX : data[0].fundingRate", () => {
    expect(parseOkxFunding({ code: "0", data: [{ fundingRate: "0.0001" }] })).toBe(0.0001);
    expect(parseOkxFunding({ data: [] })).toBeNull();
  });
  it("Hyperliquid : funding du coin par index dans universe", () => {
    const json = [
      { universe: [{ name: "ETH" }, { name: "BTC" }] },
      [{ funding: "0.00001" }, { funding: "0.0000125" }],
    ];
    expect(parseHyperliquidFunding(json, "BTC")).toBe(0.0000125);
    expect(parseHyperliquidFunding(json, "SOL")).toBeNull(); // coin absent
    expect(parseHyperliquidFunding([{ universe: [] }], "BTC")).toBeNull(); // tuple incomplet
  });
});

describe("fundingSpreadApr", () => {
  it("écart entre APR max et min", () => {
    const venues: FundingVenue[] = [
      { exchange: "a", label: "A", ratePct: 0, intervalHours: 8, apr: 12 },
      { exchange: "b", label: "B", ratePct: 0, intervalHours: 1, apr: -3 },
    ];
    expect(fundingSpreadApr(venues)).toBe(15);
  });
  it("null si moins de 2 venues", () => {
    expect(fundingSpreadApr([])).toBeNull();
  });
});
