import { describe, it, expect } from "vitest";
import {
  parseRatioHistory,
  parseTakerHistory,
  parseOiHistory,
  deltaDepuisKlinesPerp,
  timeframeToFapiInterval,
} from "./binanceFutures";
import type { Timeframe } from "@axiom/types";
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
 * `deltaDepuisKlinesPerp` : delta agresseur par bougie depuis les lignes brutes de
 * `fapi/v1/klines` (mêmes 12 champs que le spot — cf. `restKlineToCandle`, binance.ts) :
 * indice 0 = open time, 5 = volume base, 9 = taker buy base. Champs numériques en
 * CHAÎNES → `Number()`. delta = 2 × takerBuyBase − volume (= buyVol − sellVol).
 */
describe("deltaDepuisKlinesPerp", () => {
  it("calcule le delta agresseur par bougie (achat dominant => positif)", () => {
    const rows = [
      // volume 100, takerBuy 70 => sell 30 => delta = 140 - 100 = +40 (achat dominant)
      [1782950400000, "67000.0", "67100.0", "66950.0", "67080.0", "100", 1782950699999, "6.7e6", 500, "70", "4.7e6", "0"],
      // volume 200, takerBuy 80 => sell 120 => delta = 160 - 200 = -40 (vente dominante)
      [1782950700000, "67080.0", "67120.0", "67000.0", "67010.0", "200", 1782950999999, "1.3e7", 900, "80", "5.3e6", "0"],
    ];
    const out = deltaDepuisKlinesPerp(rows);
    expect(out).toEqual([
      { t: 1782950400000, delta: 40 },
      { t: 1782950700000, delta: -40 },
    ]);
  });

  it("ignore les lignes malformées (trop courtes, temps/volume/takerBuy non numériques)", () => {
    const rows = [
      [1782950400000, "6", "6", "6", "6", "100", 1, "0", 1, "70", "0", "0"], // valide => +40
      [1782950700000, "6", "6", "6", "6", "100"], // trop courte (pas d'indice 9)
      ["oops", "6", "6", "6", "6", "100", 1, "0", 1, "70", "0", "0"], // temps non numérique
      [1782951000000, "6", "6", "6", "6", "x", 1, "0", 1, "70", "0", "0"], // volume non numérique
      [1782951300000, "6", "6", "6", "6", "100", 1, "0", 1, "y", "0", "0"], // takerBuy non numérique
    ];
    expect(deltaDepuisKlinesPerp(rows)).toEqual([{ t: 1782950400000, delta: 40 }]);
  });

  it("renvoie [] pour un tableau vide", () => {
    expect(deltaDepuisKlinesPerp([])).toEqual([]);
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

describe("timeframeToFapiInterval", () => {
  it("mappe les timeframes communs vers l'intervalle fapi (identité)", () => {
    const supportes: Timeframe[] = [
      "1m", "3m", "5m", "15m", "30m",
      "1h", "2h", "4h", "6h", "12h",
      "1d", "3d", "1w", "1M",
    ];
    for (const tf of supportes) expect(timeframeToFapiInterval(tf)).toBe(tf);
  });

  it("rend undefined pour le sous-minute (fapi minimum = 1m)", () => {
    expect(timeframeToFapiInterval("1s")).toBeUndefined();
    expect(timeframeToFapiInterval("5s")).toBeUndefined();
    expect(timeframeToFapiInterval("15s")).toBeUndefined();
  });

  it("rend undefined pour les agrégats client absents de fapi (3M/6M/12M)", () => {
    expect(timeframeToFapiInterval("3M")).toBeUndefined();
    expect(timeframeToFapiInterval("6M")).toBeUndefined();
    expect(timeframeToFapiInterval("12M")).toBeUndefined();
  });
});
