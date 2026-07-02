import { describe, it, expect } from "vitest";
import { parseRatioHistory, parseTakerHistory, parseOiHistory } from "./binanceFutures";

/**
 * Fixtures = formes RÉELLES capturées sur fapi.binance.com/futures/data
 * (globalLongShortAccountRatio, topLongShortPositionRatio, takerlongshortRatio,
 * openInterestHist). Les champs numériques arrivent en CHAÎNES → parseurs = Number().
 */
describe("parseRatioHistory", () => {
  it("normalise les points L/S (fractions de comptes) en tri ascendant", () => {
    const raw = [
      { symbol: "BTCUSDT", longAccount: "0.6510", longShortRatio: "1.8653", shortAccount: "0.3490", timestamp: 1782951000000 },
      { symbol: "BTCUSDT", longAccount: "0.6511", longShortRatio: "1.8662", shortAccount: "0.3489", timestamp: 1782950700000 },
    ];
    const pts = parseRatioHistory(raw);
    expect(pts).toHaveLength(2);
    // Tri ascendant : le plus ancien d'abord.
    expect(pts[0]).toEqual({ time: 1782950700000, ratio: 1.8662, longAccount: 0.6511, shortAccount: 0.3489 });
    expect(pts[1]?.ratio).toBeCloseTo(1.8653, 6);
  });

  it("écarte les points sans timestamp ou ratio numérique", () => {
    const raw = [
      { longShortRatio: "1.10", longAccount: "0.5", shortAccount: "0.5", timestamp: 1 },
      { longShortRatio: "oops", longAccount: "0.5", shortAccount: "0.5", timestamp: 2 },
      { longShortRatio: "1.20", longAccount: "0.5", shortAccount: "0.5" }, // pas de timestamp
    ];
    expect(parseRatioHistory(raw)).toHaveLength(1);
  });

  it("renvoie [] si la réponse n'est pas un tableau (erreur API)", () => {
    expect(parseRatioHistory({ code: -1121, msg: "Invalid symbol." })).toEqual([]);
  });
});

describe("parseTakerHistory", () => {
  it("normalise les points taker achat/vente", () => {
    const raw = [
      { buySellRatio: "1.4761", sellVol: "277.9270", buyVol: "410.2530", timestamp: 1782950700000 },
      { buySellRatio: "1.3840", sellVol: "592.4720", buyVol: "819.9630", timestamp: 1782950400000 },
    ];
    const pts = parseTakerHistory(raw);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ time: 1782950400000, buySellRatio: 1.384, buyVol: 819.963, sellVol: 592.472 });
  });

  it("renvoie [] si non tableau", () => {
    expect(parseTakerHistory(null)).toEqual([]);
  });
});

describe("parseOiHistory", () => {
  it("retient le notionnel USD (sumOpenInterestValue) + les contrats", () => {
    const raw = [
      { symbol: "BTCUSDT", sumOpenInterest: "103443.59500000", sumOpenInterestValue: "6198862289.97510100", timestamp: 1782951000000 },
      { symbol: "BTCUSDT", sumOpenInterest: "103425.20800000", sumOpenInterestValue: "6193385024.63186700", timestamp: 1782950700000 },
    ];
    const pts = parseOiHistory(raw);
    expect(pts).toHaveLength(2);
    expect(pts[0]?.time).toBe(1782950700000); // tri ascendant
    expect(pts[1]?.oiUsd).toBeCloseTo(6198862289.9751, 2);
    expect(pts[1]?.oi).toBeCloseTo(103443.595, 3);
  });

  it("écarte les points au notionnel non numérique", () => {
    const raw = [{ sumOpenInterest: "1", sumOpenInterestValue: "x", timestamp: 1 }];
    expect(parseOiHistory(raw)).toEqual([]);
  });
});
