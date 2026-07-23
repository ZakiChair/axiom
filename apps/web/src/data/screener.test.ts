/**
 * Tests de la logique PURE du screener (data/screener.ts) : parsing du ticker 24h et
 * du premiumIndex, évaluation des conditions de base, sélection des candidats, et
 * dérivation d'un scalaire indicateur. Fixtures inline (aucun réseau).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { getIndicator } from "@axiom/indicators";
import {
  applyBaseFilters,
  applyFunding,
  applyLongShortRatio,
  applyOiChange,
  baseFieldValue,
  BUILTIN_PRESETS,
  compareOp,
  deriveScalar,
  evalBaseCondition,
  getIndicatorField,
  INDICATOR_FIELDS,
  lastClose,
  lastDefined,
  lastLongShortRatio,
  needsPositionMetrics,
  oiChangePctFromHist,
  parsePremiumIndex,
  parseTicker24h,
  selectCandidates,
  splitBaseConditions,
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

describe("positionnement OI / L-S (B2)", () => {
  it("oiChangePctFromHist calcule le Δ% notionnel (premier → dernier)", () => {
    expect(oiChangePctFromHist([{ oiUsd: 100 }, { oiUsd: 110 }])).toBeCloseTo(10, 10);
    expect(oiChangePctFromHist([{ oiUsd: 200 }, { oiUsd: 100 }])).toBeCloseTo(-50, 10);
    expect(oiChangePctFromHist([{ oiUsd: 100 }])).toBeUndefined();
    expect(oiChangePctFromHist([])).toBeUndefined();
    expect(oiChangePctFromHist([{ oiUsd: 0 }, { oiUsd: 10 }])).toBeUndefined();
  });

  it("lastLongShortRatio prend le dernier ratio fini", () => {
    expect(lastLongShortRatio([{ ratio: 1.1 }, { ratio: 1.5 }])).toBeCloseTo(1.5, 10);
    expect(lastLongShortRatio([{ ratio: 1.1 }, { ratio: NaN }])).toBeCloseTo(1.1, 10);
    expect(lastLongShortRatio([])).toBeUndefined();
  });

  it("applyOiChange / applyLongShortRatio annotent par symbole", () => {
    const rows: ScreenerRow[] = [
      { symbol: "BTCUSDT", quote: "USDT", lastPrice: 1, priceChangePct24h: 0, volumeUsd24h: 1 },
      { symbol: "ETHUSDT", quote: "USDT", lastPrice: 1, priceChangePct24h: 0, volumeUsd24h: 1 },
    ];
    applyOiChange(rows, new Map([["BTCUSDT", 5.5]]));
    applyLongShortRatio(rows, new Map([["BTCUSDT", 1.8], ["ETHUSDT", 0.6]]));
    expect(rows[0]?.oiChangePct).toBeCloseTo(5.5, 10);
    expect(rows[0]?.longShortRatio).toBeCloseTo(1.8, 10);
    expect(rows[1]?.oiChangePct).toBeUndefined();
    expect(rows[1]?.longShortRatio).toBeCloseTo(0.6, 10);
  });

  it("baseFieldValue lit OI / L-S / |funding|", () => {
    const row: ScreenerRow = {
      symbol: "BTCUSDT",
      quote: "USDT",
      lastPrice: 1,
      priceChangePct24h: 0,
      volumeUsd24h: 1,
      fundingPct: -0.04,
      oiChangePct: 3,
      longShortRatio: 1.2,
    };
    expect(baseFieldValue(row, "oiChangePct")).toBe(3);
    expect(baseFieldValue(row, "longShortRatio")).toBeCloseTo(1.2, 10);
    expect(baseFieldValue(row, "absFundingPct")).toBeCloseTo(0.04, 10);
  });

  it("filtre position échoue si métrique absente (échantillon non couvert)", () => {
    const row: ScreenerRow = {
      symbol: "X",
      quote: "USDT",
      lastPrice: 1,
      priceChangePct24h: 0,
      volumeUsd24h: 1e9,
    };
    const cond: BaseCondition = { kind: "base", field: "oiChangePct", op: ">", value: 0 };
    expect(evalBaseCondition(row, cond)).toBe(false);
  });

  it("needsPositionMetrics / splitBaseConditions séparent OI/L-S", () => {
    const conds: BaseCondition[] = [
      { kind: "base", field: "volumeUsd24h", op: ">", value: 1 },
      { kind: "base", field: "oiChangePct", op: ">", value: 2 },
      { kind: "base", field: "longShortRatio", op: ">", value: 1.5 },
      { kind: "base", field: "fundingPct", op: ">", value: 0 },
    ];
    expect(needsPositionMetrics(conds)).toBe(true);
    expect(needsPositionMetrics([{ kind: "base", field: "volumeUsd24h", op: ">", value: 1 }])).toBe(
      false,
    );
    const { pre, position } = splitBaseConditions(conds);
    expect(pre.map((c) => c.field)).toEqual(["volumeUsd24h", "fundingPct"]);
    expect(position.map((c) => c.field)).toEqual(["oiChangePct", "longShortRatio"]);
  });

  it("preset crowded-long = funding + ΔOI + L/S (ET logique)", () => {
    const crowded = BUILTIN_PRESETS.find((p) => p.id === "builtin:crowded-long");
    expect(crowded).toBeDefined();
    const fields = crowded!.baseConditions.map((c) => c.field);
    expect(fields).toContain("fundingPct");
    expect(fields).toContain("oiChangePct");
    expect(fields).toContain("longShortRatio");

    const pass: ScreenerRow = {
      symbol: "BTCUSDT",
      quote: "USDT",
      lastPrice: 60_000,
      priceChangePct24h: 1,
      volumeUsd24h: 50_000_000,
      fundingPct: 0.02,
      oiChangePct: 5,
      longShortRatio: 1.8,
    };
    const failLs: ScreenerRow = { ...pass, longShortRatio: 1.0 };
    expect(crowded!.baseConditions.every((c) => evalBaseCondition(pass, c))).toBe(true);
    expect(crowded!.baseConditions.every((c) => evalBaseCondition(failLs, c))).toBe(false);
  });

  it("expose les 4 presets positionnement B2", () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    expect(ids).toContain("builtin:crowded-long");
    expect(ids).toContain("builtin:crowded-short");
    expect(ids).toContain("builtin:funding-extreme");
    expect(ids).toContain("builtin:momentum-vol");
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

  it("derive « lastPct » = dernière valeur définie × 100", () => {
    const spec = INDICATOR_FIELDS.find((f) => f.id === "bbw") as IndicatorFieldSpec;
    // ratio brut 0.042 → 4.2 % (indépendant du close).
    expect(deriveScalar(spec, [undefined, 0.03, 0.042], 100)).toBeCloseTo(4.2, 10);
    // série vide → indéfini.
    expect(deriveScalar(spec, [], 100)).toBeUndefined();
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

describe("catalogue INDICATOR_FIELDS (ADX / BB bandwidth)", () => {
  it("résout ADX et BB bandwidth par id", () => {
    const adx = getIndicatorField("adx");
    expect(adx?.indicatorId).toBe("adx");
    expect(adx?.output).toBe("adx");
    expect(adx?.derive).toBe("last");

    const bbw = getIndicatorField("bbw");
    expect(bbw?.indicatorId).toBe("bbBandwidth");
    expect(bbw?.output).toBe("bandwidth");
    expect(bbw?.derive).toBe("lastPct");
  });

  it("intégrité registre : chaque champ pointe un output existant du def @axiom/indicators", () => {
    for (const spec of INDICATOR_FIELDS) {
      const def = getIndicator(spec.indicatorId);
      expect(def, `def « ${spec.indicatorId} » introuvable`).toBeDefined();
      expect(
        def?.outputs.some((o) => o.key === spec.output),
        `output « ${spec.output} » absent du def « ${spec.indicatorId} »`,
      ).toBe(true);
    }
  });
});
