import { describe, expect, it } from "vitest";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import type { IndicatorDef } from "@axiom/types";
import { raisonUnusableIndicateur, type ContexteIndicateur } from "./indicatorUsability";

function def(id: string): IndicatorDef {
  const found = getIndicator(id);
  if (found === undefined) throw new Error(`Indicateur absent: ${id}`);
  return found;
}

const binanceBtc: ContexteIndicateur = {
  exchange: "binance",
  symbol: "BTCUSDT",
  timeframe: "1d",
};

describe("raisonUnusableIndicateur", () => {
  it("respecte le timeframe minimal", () => {
    expect(
      raisonUnusableIndicateur(def("openInterest"), { ...binanceBtc, timeframe: "15m" }),
    ).toBe("Nécessite ≥ 1h");
    expect(
      raisonUnusableIndicateur(def("openInterest"), { ...binanceBtc, timeframe: "1h" }),
    ).toBeNull();
  });

  it("conserve la garde du volume synthétique", () => {
    expect(
      raisonUnusableIndicateur(def("volume"), {
        exchange: "synthetic",
        symbol: "binance:BTCUSDT|/|binance:ETHUSDT",
        timeframe: "1h",
      }),
    ).toBe("Volume non défini sur une série synthétique");
  });

  it.each(["cvd", "volumeDelta", "takerBuyRatio", "cvdDivergence", "cvdSpotPerp"])(
    "%s exige les volumes split de Binance",
    (id) => {
      expect(
        raisonUnusableIndicateur(def(id), {
          exchange: "kraken",
          symbol: "BTCUSD",
          timeframe: "1h",
        }),
      ).toContain("uniquement sur Binance");
      expect(
        raisonUnusableIndicateur(def(id), { ...binanceBtc, timeframe: "1h" }),
      ).toBeNull();
    },
  );

  it("refuse tous les indicateurs dépendant du volume sur le forex Twelve Data", () => {
    const extras = new Set([
      "vwma",
      "easeOfMovement",
      "forceIndex",
      "mfi",
      "marketFacilitationIndex",
      "netVolume",
      "mfiDivergence",
      "obvDivergence",
    ]);
    const concernes = INDICATORS.filter((d) => d.category === "volume" || extras.has(d.id));
    expect(concernes.length).toBeGreaterThan(0);
    for (const indicateur of concernes) {
      expect(
        raisonUnusableIndicateur(indicateur, {
          exchange: "twelvedata",
          symbol: "EUR/USD",
          timeframe: "1d",
        }),
        indicateur.id,
      ).toBe("Twelve Data ne fournit pas de volume pour le forex");
    }
    expect(
      raisonUnusableIndicateur(def("rsi"), {
        exchange: "twelvedata",
        symbol: "EUR/USD",
        timeframe: "1d",
      }),
    ).toBeNull();
  });

  it("limite les métriques on-chain de cycle et valorisation à BTC", () => {
    const ids = [
      "nvt",
      "mvrv",
      "mvrvZScore",
      "nupl",
      "puell",
      "sopr",
      "reserveRisk",
      "realizedPrice",
      "asopr",
      "sthSopr",
      "lthSopr",
      "rhodlRatio",
      "cvdd",
      "balancedPrice",
      "ssr",
    ];
    for (const id of ids) {
      expect(
        raisonUnusableIndicateur(def(id), { ...binanceBtc, symbol: "ETHUSDT" }),
        id,
      ).toBe("Métrique on-chain disponible uniquement pour BTC");
      expect(raisonUnusableIndicateur(def(id), binanceBtc), id).toBeNull();
    }
  });

  it("laisse les métriques globales utilisables quel que soit l'actif", () => {
    for (const id of ["btcDominance", "fearGreed", "stablecoinSupply"]) {
      expect(
        raisonUnusableIndicateur(def(id), {
          exchange: "twelvedata",
          symbol: "EUR/USD",
          timeframe: "1d",
        }),
        id,
      ).toBeNull();
    }
  });

  it("limite le basis trimestriel à BTC et ETH", () => {
    const quarterly = def("quarterlyBasis");
    expect(
      raisonUnusableIndicateur(quarterly, { ...binanceBtc, timeframe: "1h" }),
    ).toBeNull();
    expect(
      raisonUnusableIndicateur(quarterly, {
        ...binanceBtc,
        symbol: "ETHUSDT",
        timeframe: "1h",
      }),
    ).toBeNull();
    expect(
      raisonUnusableIndicateur(quarterly, {
        ...binanceBtc,
        symbol: "SOLUSDT",
        timeframe: "1h",
      }),
    ).toContain("BTC et ETH");
  });

  it("refuse les aux perp hors symbole crypto USDT compatible", () => {
    for (const id of [
      "openInterest",
      "fundingRate",
      "basisPct",
      "lsAccountRatio",
      "cvdSpotPerp",
    ]) {
      expect(raisonUnusableIndicateur(def(id), binanceBtc), id).toBeNull();
      expect(
        raisonUnusableIndicateur(def(id), { ...binanceBtc, symbol: "BTCUSD" }),
        id,
      ).toBe("Nécessite un symbole crypto USDT compatible");
    }
    const oi = def("openInterest");
    expect(
      raisonUnusableIndicateur(oi, {
        exchange: "bybit",
        symbol: "BTCUSDT",
        timeframe: "1h",
      }),
    ).toBeNull();
    for (const context of [
      { exchange: "twelvedata", symbol: "SPY", timeframe: "1h" },
      {
        exchange: "synthetic",
        symbol: "binance:BTCUSDT|/|binance:ETHUSDT",
        timeframe: "1h",
      },
    ] as const) {
      expect(raisonUnusableIndicateur(oi, context)).toBe(
        "Nécessite un symbole crypto USDT compatible",
      );
    }
  });

  it("accepte les 179 définitions sans lever", () => {
    expect(INDICATORS).toHaveLength(179);
    for (const indicateur of INDICATORS) {
      expect(() => raisonUnusableIndicateur(indicateur, binanceBtc), indicateur.id).not.toThrow();
    }
  });
});
