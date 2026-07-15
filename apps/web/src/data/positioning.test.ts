/**
 * Positionnement Binance futures — parseRatioResponse : lecture du champ ratio depuis
 * la réponse futures/data, filtrage du non-numérique, tri temporel.
 */
import { describe, expect, it } from "vitest";
import { parseRatioResponse } from "./positioning";

describe("parseRatioResponse", () => {
  it("lit longShortRatio et trie par temps croissant", () => {
    const json = [
      { symbol: "BTCUSDT", longShortRatio: "1.4785", timestamp: 2000 },
      { symbol: "BTCUSDT", longShortRatio: "1.2173", timestamp: 1000 },
    ];
    expect(parseRatioResponse(json, "longShortRatio")).toEqual([
      { time: 1000, value: 1.2173 },
      { time: 2000, value: 1.4785 },
    ]);
  });

  it("lit buySellRatio (endpoint taker)", () => {
    const json = [{ buySellRatio: "1.2404", buyVol: "2152", sellVol: "1735", timestamp: 500 }];
    expect(parseRatioResponse(json, "buySellRatio")).toEqual([{ time: 500, value: 1.2404 }]);
  });

  it("ignore les lignes non numériques et renvoie [] hors tableau", () => {
    const json = [
      { longShortRatio: "x", timestamp: 1000 },
      { longShortRatio: "1.1", timestamp: "bad" },
      { longShortRatio: "2.0", timestamp: 3000 },
    ];
    expect(parseRatioResponse(json, "longShortRatio")).toEqual([{ time: 3000, value: 2.0 }]);
    expect(parseRatioResponse({ code: -1121 }, "longShortRatio")).toEqual([]);
  });
});
