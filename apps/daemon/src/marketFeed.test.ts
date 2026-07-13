import { describe, expect, test } from "bun:test";
import type { Candle } from "@axiom/types";
import {
  ajouterBougie,
  construireUrlFlux,
  FENETRE_BOUGIES,
  parserHistoriqueFunding,
  parserPremiumIndex,
  zScoreFunding,
} from "./marketFeed";

/** Fabrique une bougie minimale à un temps donné. */
function bougie(time: number, close = 1): Candle {
  return { time, open: close, high: close, low: close, close, volume: 0 };
}

describe("construireUrlFlux", () => {
  test("null si aucun symbole", () => {
    expect(construireUrlFlux([])).toBeNull();
  });

  test("streams combinés miniTicker + kline_1m en minuscules", () => {
    expect(construireUrlFlux(["BTCUSDT", "ETHUSDT"])).toBe(
      "wss://stream.binance.com:9443/stream?streams=" +
        "btcusdt@miniTicker/btcusdt@kline_1m/ethusdt@miniTicker/ethusdt@kline_1m",
    );
  });
});

describe("ajouterBougie", () => {
  test("ajoute en fin quand le temps est strictement plus grand", () => {
    const f: Candle[] = [bougie(1000)];
    ajouterBougie(f, bougie(2000));
    expect(f.map((c) => c.time)).toEqual([1000, 2000]);
  });

  test("remplace la dernière bougie à temps égal (mise à jour de clôture)", () => {
    const f: Candle[] = [bougie(1000), bougie(2000, 5)];
    ajouterBougie(f, bougie(2000, 9));
    expect(f).toHaveLength(2);
    expect(f[1]?.close).toBe(9);
  });

  test("ignore une bougie hors ordre (antérieure)", () => {
    const f: Candle[] = [bougie(2000)];
    ajouterBougie(f, bougie(1000));
    expect(f.map((c) => c.time)).toEqual([2000]);
  });

  test("borne la fenêtre à FENETRE_BOUGIES", () => {
    const f: Candle[] = [];
    for (let i = 0; i < FENETRE_BOUGIES + 50; i++) ajouterBougie(f, bougie(i * 60_000));
    expect(f).toHaveLength(FENETRE_BOUGIES);
    // Les plus anciennes sont évincées : la 1re restante = index 50.
    expect(f[0]?.time).toBe(50 * 60_000);
  });
});

describe("parserPremiumIndex", () => {
  test("tableau multi-symboles → Map fraction majuscules", () => {
    const map = parserPremiumIndex([
      { symbol: "btcusdt", lastFundingRate: "0.0001" },
      { symbol: "ETHUSDT", lastFundingRate: "-0.0005" },
      { symbol: "XRPUSDT", lastFundingRate: "oops" }, // ignoré
      { symbol: 42, lastFundingRate: "0.01" }, // symbole non string
    ]);
    expect(map.get("BTCUSDT")).toBe(0.0001);
    expect(map.get("ETHUSDT")).toBe(-0.0005);
    expect(map.has("XRPUSDT")).toBe(false);
    expect(map.size).toBe(2);
  });

  test("objet unique (query ?symbol=) aussi accepté", () => {
    const map = parserPremiumIndex({ symbol: "BTCUSDT", lastFundingRate: 0.001 });
    expect(map.get("BTCUSDT")).toBe(0.001);
  });

  test("payload invalide → Map vide", () => {
    expect(parserPremiumIndex(null).size).toBe(0);
    expect(parserPremiumIndex("x").size).toBe(0);
    expect(parserPremiumIndex([]).size).toBe(0);
  });
});

describe("parserHistoriqueFunding", () => {
  test("extrait les rates finis en ordre d'entrée", () => {
    expect(
      parserHistoriqueFunding([
        { fundingRate: "0.0001" },
        { fundingRate: -0.0002 },
        { fundingRate: "nan" },
        null,
      ]),
    ).toEqual([0.0001, -0.0002]);
  });

  test("non-tableau → []", () => {
    expect(parserHistoriqueFunding({})).toEqual([]);
  });
});

describe("zScoreFunding", () => {
  test("undefined si série trop courte", () => {
    expect(zScoreFunding([])).toBeUndefined();
    expect(zScoreFunding([1])).toBeUndefined();
  });

  test("z = 0 si tous les points égaux (sd nul)", () => {
    expect(zScoreFunding([0.001, 0.001, 0.001])).toBe(0);
  });

  test("dernier point extrême → |z| élevé", () => {
    // 29 points à 0 puis un spike à 1 → z clairement > 2
    const series = Array.from({ length: 29 }, () => 0).concat([1]);
    const z = zScoreFunding(series);
    expect(z).toBeDefined();
    expect(Math.abs(z as number)).toBeGreaterThan(2);
  });
});
