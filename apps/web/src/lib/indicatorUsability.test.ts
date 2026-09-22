import { describe, expect, it, vi } from "vitest";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import type { IndicatorDef } from "@axiom/types";

// `daemonSupporte` est l'état de la DERNIÈRE sonde /health — stubbé : ce test pilote
// le verdict sans dépendre d'un daemon réel.
vi.mock("../data/daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/daemon")>();
  return { ...actual, daemonSupporte: vi.fn(() => false) };
});

import { daemonSupporte } from "../data/daemon";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { raisonUnusableIndicateur, type ContexteIndicateur } from "./indicatorUsability";

const daemonSupporteMock = vi.mocked(daemonSupporte);

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
  it("réserve le RVOL saisonnier à H1 avec de vrais volumes et refuse les intervalles mark absents", () => {
    expect(raisonUnusableIndicateur(def("rvolSeasonal"), { ...binanceBtc, timeframe: "1h" })).toBeNull();
    expect(raisonUnusableIndicateur(def("rvolSeasonal"), binanceBtc)).toContain("1h");
    expect(raisonUnusableIndicateur(def("rvolSeasonal"), { ...binanceBtc, exchange: "synthetic", timeframe: "1h" })).toContain("Volume");
    expect(raisonUnusableIndicateur(def("basisPct"), { ...binanceBtc, timeframe: "3M" })).toContain("intervalle");
  });
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

  it.each([
    "cvd",
    "volumeDelta",
    "takerBuyRatio",
    "cvdDivergence",
    "cvdSpotPerp",
    "takerNetPct",
    "stratSpotBreakout",
    "vpin",
    "kyleLambda",
    "trappedVolume",
  ])(
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
      // Lot 2 : hashrate + métriques de cycle BGeometrics.
      "hashRibbons",
      "mvrvCohortes",
      "nrpl",
      "vddMultiple",
      "aviv",
      "offreEnProfit",
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
      "stratNetPositionFade",
      "stratSmartMoneyDivergence",
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

  it("liqParBougie exige une clé Coinalyze utilisable", () => {
    coinalyzeKeyStore.setState({ hasKey: false });
    expect(
      raisonUnusableIndicateur(def("liqParBougie"), { ...binanceBtc, timeframe: "1h" }),
    ).toBe("Nécessite une clé Coinalyze");
    coinalyzeKeyStore.setState({ hasKey: true });
    expect(
      raisonUnusableIndicateur(def("liqParBougie"), { ...binanceBtc, timeframe: "1h" }),
    ).toBeNull();
  });

  it("hlWhalesNet exige le daemon axiomd", () => {
    daemonSupporteMock.mockReturnValue(false);
    expect(
      raisonUnusableIndicateur(def("hlWhalesNet"), { ...binanceBtc, timeframe: "1h" }),
    ).toBe("Nécessite le daemon axiomd (collecte des niveaux HL)");
    daemonSupporteMock.mockReturnValue(true);
    expect(
      raisonUnusableIndicateur(def("hlWhalesNet"), { ...binanceBtc, timeframe: "1h" }),
    ).toBeNull();
    daemonSupporteMock.mockReturnValue(false);
  });

  it("accepte les 210 définitions sans lever", () => {
    expect(INDICATORS).toHaveLength(210);
    for (const indicateur of INDICATORS) {
      expect(() => raisonUnusableIndicateur(indicateur, binanceBtc), indicateur.id).not.toThrow();
    }
  });
});
