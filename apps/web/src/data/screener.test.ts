/**
 * Tests de la logique PURE du screener (data/screener.ts) : parsing du ticker 24h et
 * du premiumIndex, évaluation des conditions de base, sélection des candidats, et
 * dérivation d'un scalaire indicateur. Fixtures inline (aucun réseau).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import {
  applyBaseFilters,
  applyFunding,
  baseFieldValue,
  compareOp,
  deriveScalar,
  evalBaseCondition,
  INDICATOR_FIELDS,
  lastClose,
  lastDefined,
  parsePremiumIndex,
  parseTicker24h,
  selectCandidates,
  type BaseCondition,
  type IndicatorFieldSpec,
  type ScreenerRow,
} from "./screener";

// Fixture ticker24h : BTC/ETH (USDT), un USDC, un symbole hors cotation, un corrompu.
const TICKER_FIXTURE = [
  { symbol: "BTCUSDT", lastPrice: "60000", priceChangePercent: "2.5", quoteVolume: "1000000000" },
  { symbol: "ETHUSDT", lastPrice: "3000", priceChangePercent: "-4.2", quoteVolume: "500000000" },
  { symbol: "SOLUSDC", lastPrice: "150", priceChangePercent: "8.0", quoteVolume: "20000000" },
  { symbol: "ETHBTC", lastPrice: "0.05", priceChangePercent: "0.1", quoteVolume: "3000" }, // hors USDT/USDC
  { symbol: "BADUSDT", lastPrice: "abc", priceChangePercent: "1", quoteVolume: "x" }, // non fini
  { symbol: 42 }, // symbole non-string
];

describe("parseTicker24h", () => {
  it("ne garde que les cotations USDT/USDC bien formées", () => {
    const rows = parseTicker24h(TICKER_FIXTURE);
    expect(rows.map((r) => r.symbol)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDC"]);
  });

  it("extrait prix, variation et volume, et rattache la cotation", () => {
    const [btc] = parseTicker24h(TICKER_FIXTURE);
    expect(btc).toMatchObject({
      symbol: "BTCUSDT",
      quote: "USDT",
      lastPrice: 60000,
      priceChangePct24h: 2.5,
      volumeUsd24h: 1_000_000_000,
    });
  });

  it("renvoie [] pour une entrée non tableau", () => {
    expect(parseTicker24h({ nope: true })).toEqual([]);
  });
});

describe("parsePremiumIndex + applyFunding", () => {
  it("convertit le taux brut en pourcentage et fusionne par symbole", () => {
    const map = parsePremiumIndex([
      { symbol: "BTCUSDT", lastFundingRate: "0.0001" }, // 0.01 %
      { symbol: "ETHUSDT", lastFundingRate: "-0.0005" }, // -0.05 %
      { symbol: "XRPUSDT", lastFundingRate: "oops" }, // ignoré
    ]);
    expect(map.get("BTCUSDT")).toBeCloseTo(0.01, 10);
    expect(map.get("ETHUSDT")).toBeCloseTo(-0.05, 10);
    expect(map.has("XRPUSDT")).toBe(false);

    const rows = parseTicker24h(TICKER_FIXTURE);
    applyFunding(rows, map);
    expect(rows.find((r) => r.symbol === "BTCUSDT")?.fundingPct).toBeCloseTo(0.01, 10);
    expect(rows.find((r) => r.symbol === "SOLUSDC")?.fundingPct).toBeUndefined(); // pas de perp
  });
});

describe("compareOp", () => {
  it("applique chaque opérateur", () => {
    expect(compareOp(5, ">", 3)).toBe(true);
    expect(compareOp(3, ">=", 3)).toBe(true);
    expect(compareOp(2, "<", 3)).toBe(true);
    expect(compareOp(3, "<=", 3)).toBe(true);
    expect(compareOp(2, ">", 3)).toBe(false);
  });
});

describe("baseFieldValue / evalBaseCondition", () => {
  const row: ScreenerRow = {
    symbol: "ETHUSDT",
    quote: "USDT",
    lastPrice: 3000,
    priceChangePct24h: -4.2,
    volumeUsd24h: 500_000_000,
    fundingPct: -0.03,
  };

  it("|Δ 24h| renvoie la valeur absolue", () => {
    expect(baseFieldValue(row, "absPriceChangePct24h")).toBeCloseTo(4.2, 10);
    expect(baseFieldValue(row, "priceChangePct24h")).toBeCloseTo(-4.2, 10);
  });

  it("un champ funding absent échoue la condition", () => {
    const sansFunding: ScreenerRow = { ...row, fundingPct: undefined };
    const cond: BaseCondition = { kind: "base", field: "fundingPct", op: "<", value: 0 };
    expect(evalBaseCondition(sansFunding, cond)).toBe(false);
    expect(evalBaseCondition(row, cond)).toBe(true);
  });

  it("compose plusieurs conditions (ET logique)", () => {
    const rows = parseTicker24h(TICKER_FIXTURE);
    const filtres: BaseCondition[] = [
      { kind: "base", field: "volumeUsd24h", op: ">", value: 100_000_000 },
      { kind: "base", field: "priceChangePct24h", op: "<", value: 0 },
    ];
    // Seul ETHUSDT : volume > 100M ET variation négative.
    expect(applyBaseFilters(rows, filtres).map((r) => r.symbol)).toEqual(["ETHUSDT"]);
  });

  it("sans condition, renvoie une COPIE de toutes les lignes", () => {
    const rows = parseTicker24h(TICKER_FIXTURE);
    const out = applyBaseFilters(rows, []);
    expect(out).toHaveLength(rows.length);
    expect(out).not.toBe(rows);
  });
});

describe("selectCandidates", () => {
  it("trie par volume décroissant et coupe au plafond", () => {
    const rows: ScreenerRow[] = [
      { symbol: "A", quote: "USDT", lastPrice: 1, priceChangePct24h: 0, volumeUsd24h: 10 },
      { symbol: "B", quote: "USDT", lastPrice: 1, priceChangePct24h: 0, volumeUsd24h: 30 },
      { symbol: "C", quote: "USDT", lastPrice: 1, priceChangePct24h: 0, volumeUsd24h: 20 },
    ];
    expect(selectCandidates(rows, 2).map((r) => r.symbol)).toEqual(["B", "C"]);
  });
});

describe("lastDefined / deriveScalar / lastClose", () => {
  it("lastDefined ignore undefined et NaN en fin de série", () => {
    expect(lastDefined([1, 2, 3])).toBe(3);
    expect(lastDefined([1, 2, undefined])).toBe(2);
    expect(lastDefined([1, NaN, undefined])).toBe(1);
    expect(lastDefined([])).toBeUndefined();
  });

  it("derive « last » = dernière valeur définie", () => {
    const spec = INDICATOR_FIELDS.find((f) => f.id === "rsi") as IndicatorFieldSpec;
    expect(deriveScalar(spec, [undefined, 40, 55], 100)).toBe(55);
  });

  it("derive « distPct » = écart signé prix/valeur en %", () => {
    const spec = INDICATOR_FIELDS.find((f) => f.id === "emaDist") as IndicatorFieldSpec;
    // close 110 vs EMA 100 → +10 %.
    expect(deriveScalar(spec, [90, 95, 100], 110)).toBeCloseTo(10, 10);
    // valeur 0 → indéfini (pas de division).
    expect(deriveScalar(spec, [0], 110)).toBeUndefined();
    // close manquant → indéfini.
    expect(deriveScalar(spec, [100], undefined)).toBeUndefined();
  });

  it("lastClose renvoie le close de la dernière bougie", () => {
    const candles: Candle[] = [
      { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 2, open: 1.5, high: 3, low: 1, close: 2.8, volume: 12 },
    ];
    expect(lastClose(candles)).toBe(2.8);
    expect(lastClose([])).toBeUndefined();
  });
});
