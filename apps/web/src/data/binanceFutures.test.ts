import { describe, it, expect } from "vitest";
import { parseRatioHistory, parseTakerHistory, parseOiHistory } from "./binanceFutures";
import { aggTradeToTrade, type BinanceAggTrade } from "./binance";

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

/**
 * `subscribePerpAggTrades` (flux WS fstream @aggTrade) réutilise TEL QUEL le mapping
 * `aggTradeToTrade` du spot (data/binance.ts, déjà figé par tradeMapping.test.ts) :
 * le schéma JSON de l'aggTrade perp (fstream) est identique à celui du spot sur les
 * champs utilisés (e, p, q, T, m). On fige ici, avec une fixture RÉALISTE capturée
 * sur le flux perp, que cette réutilisation produit bien le `Trade` attendu — même
 * convention agresseur/taker : m=true => acheteur MAKER => agresseur VENDEUR => sell.
 */
describe("mapping aggTrade perp (fstream) — via aggTradeToTrade réutilisé", () => {
  it("m=true (acheteur maker) => agresseur vendeur => side=sell", () => {
    const trade: BinanceAggTrade = {
      e: "aggTrade",
      E: 1782951000123,
      s: "BTCUSDT",
      a: 987654321,
      p: "67123.50",
      q: "0.015",
      T: 1782951000100,
      m: true,
    };
    expect(aggTradeToTrade(trade)).toEqual({
      time: 1782951000100,
      price: 67123.5,
      qty: 0.015,
      side: "sell",
    });
  });

  it("m=false (vendeur maker) => agresseur acheteur => side=buy", () => {
    const trade: BinanceAggTrade = {
      e: "aggTrade",
      E: 1782951000456,
      s: "BTCUSDT",
      a: 987654322,
      p: "67124.00",
      q: "0.203",
      T: 1782951000400,
      m: false,
    };
    expect(aggTradeToTrade(trade)).toEqual({
      time: 1782951000400,
      price: 67124,
      qty: 0.203,
      side: "buy",
    });
  });
});
