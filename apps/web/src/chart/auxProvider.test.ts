import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuxSeriesId, FundingRate, OpenInterest } from "@axiom/types";

// Mocks des fournisseurs sous-jacents (pattern extapi/mexc.test) — hissés par Vitest
// avant les imports statiques. On stub UNIQUEMENT ce que consomme l'AuxProvider.
vi.mock("../data/coinalyze", () => ({
  setCoinalyzeApiKey: vi.fn(),
  coinalyzeProvider: {
    fetchOpenInterestHistory: vi.fn(),
    fetchFundingRateHistory: vi.fn(),
  },
}));
vi.mock("../data/macro/stablecoins", () => ({
  stablecoinsSupplyProvider: { fetchSeries: vi.fn() },
}));
vi.mock("../data/onchain/coinmetrics", () => ({
  fetchCoinMetrics: vi.fn(),
}));
vi.mock("../data/onchain/bgeometrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/onchain/bgeometrics")>();
  return { ...actual, fetchBgeometricMetrique: vi.fn() };
});
vi.mock("../store/onchain", () => ({
  getBgeometricsKey: vi.fn(),
}));
vi.mock("../data/referentiels", () => ({
  histFunding: vi.fn(),
  histOiUsd: vi.fn(),
  histOiUsdAvecRepli: vi.fn(),
}));

import { AuxProvider } from "./auxProvider";
import { coinalyzeProvider } from "../data/coinalyze";
import { stablecoinsSupplyProvider } from "../data/macro/stablecoins";
import { fetchBgeometricMetrique } from "../data/onchain/bgeometrics";
import { fetchCoinMetrics } from "../data/onchain/coinmetrics";
import { histFunding, histOiUsd, histOiUsdAvecRepli } from "../data/referentiels";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { getBgeometricsKey } from "../store/onchain";

const oiMock = vi.mocked(coinalyzeProvider.fetchOpenInterestHistory);
const fundingMock = vi.mocked(coinalyzeProvider.fetchFundingRateHistory);
const stableMock = vi.mocked(stablecoinsSupplyProvider.fetchSeries);
const cmMock = vi.mocked(fetchCoinMetrics);
const bgFetchMock = vi.mocked(fetchBgeometricMetrique);
const bgKeyMock = vi.mocked(getBgeometricsKey);
const fundingFallbackMock = vi.mocked(histFunding);
const oiFallbackMock = vi.mocked(histOiUsd);
const oiWithFallbackMock = vi.mocked(histOiUsdAvecRepli);

/** Point OpenInterest de test (seul `oiUsd` est lu par l'AuxProvider). */
function oiPoint(time: number, oiUsd: number): OpenInterest {
  return { time, symbol: "BTCUSDT_PERP.A", oi: NaN, oiUsd };
}
/** Point FundingRate de test (seul `rate` est lu). */
function fundingPoint(time: number, rate: number): FundingRate {
  return { time, symbol: "BTCUSDT_PERP.A", rate, nextFundingTime: 0, markPrice: NaN };
}

/** Requête OI minimale ; on surcharge candleTimes selon le scénario. */
function oiReq(candleTimes: number[]) {
  return {
    exchange: "binance" as const,
    symbol: "BTCUSDT",
    timeframe: "1h" as const,
    ids: ["oi" as const],
    candleTimes,
  };
}

function fundingReq(candleTimes: number[]) {
  return {
    exchange: "binance" as const,
    symbol: "BTCUSDT",
    timeframe: "1h" as const,
    ids: ["funding" as const],
    candleTimes,
  };
}

describe("AuxProvider.getAligned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coinalyzeKeyStore.setState({ hasKey: true });
    oiFallbackMock.mockResolvedValue(null);
    oiWithFallbackMock.mockImplementation(async (symbol, interval, since) => {
      const points = await oiMock(symbol, interval, since);
      return points.map((point) => ({ t: point.time, v: point.oiUsd }));
    });
    fundingFallbackMock.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("1er appel → pending + déclenche le fetch sous-jacent", () => {
    oiMock.mockReturnValue(new Promise<OpenInterest[]>(() => {})); // jamais résolu
    const p = new AuxProvider();

    const status = p.getAligned(oiReq([1500, 2500]), () => {});

    expect(status).toEqual({ status: "pending" });
    expect(oiWithFallbackMock).toHaveBeenCalledTimes(1);
    expect(oiMock).toHaveBeenCalledTimes(1);
    // Signature vérifiée : (symbol, "1hour", sinceMs).
    expect(oiWithFallbackMock).toHaveBeenCalledWith("BTCUSDT", "1hour", expect.any(Number));
    expect(oiMock).toHaveBeenCalledWith("BTCUSDT", "1hour", expect.any(Number));
  });

  it("sans clé Coinalyze → OI Binance direct, sans requête Coinalyze", async () => {
    coinalyzeKeyStore.setState({ hasKey: false });
    oiFallbackMock.mockResolvedValue([{ t: 1000, v: 10 }, { t: 2000, v: 20 }]);
    const p = new AuxProvider();

    await new Promise<void>((resolve) => {
      p.getAligned(oiReq([1500, 2500]), resolve);
    });

    expect(p.getAligned(oiReq([1500, 2500]), () => {})).toEqual({
      status: "ready",
      aux: { oi: [10, 20] },
    });
    expect(oiFallbackMock).toHaveBeenCalledWith("BTCUSDT");
    expect(oiWithFallbackMock).not.toHaveBeenCalled();
    expect(oiMock).not.toHaveBeenCalled();
  });

  it("après résolution → onReady appelé, 2e appel → ready avec série alignée (alignAux)", async () => {
    oiMock.mockResolvedValue([oiPoint(1000, 10), oiPoint(2000, 20)]);
    const p = new AuxProvider();

    await new Promise<void>((resolve) => {
      const first = p.getAligned(oiReq([1500, 2500]), resolve);
      expect(first).toEqual({ status: "pending" });
    });

    // 2e appel même clé (id+symbole) → données prêtes, alignées sur candleTimes.
    const second = p.getAligned(oiReq([1500, 2500]), () => {});
    expect(second).toEqual({ status: "ready", aux: { oi: [10, 20] } });
    // Le fetch n'est PAS relancé (mémoïsé).
    expect(oiMock).toHaveBeenCalledTimes(1);
  });

  it("mappe et aligne les points fournis par le repli OI", async () => {
    oiWithFallbackMock.mockResolvedValue([
      { t: 2000, v: 20 },
      { t: 1000, v: 10 },
    ]);
    const p = new AuxProvider();

    await new Promise<void>((resolve) => {
      p.getAligned(oiReq([1500, 2500]), resolve);
    });

    expect(p.getAligned(oiReq([1500, 2500]), () => {})).toEqual({
      status: "ready",
      aux: { oi: [10, 20] },
    });
    expect(oiWithFallbackMock).toHaveBeenCalledWith("BTCUSDT", "1hour", expect.any(Number));
    expect(oiMock).not.toHaveBeenCalled();
  });

  it("échec du fetch → error, puis pas de re-fetch avant 30 s", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    oiMock.mockRejectedValue(new Error("boom"));
    const p = new AuxProvider();

    await new Promise<void>((resolve) => {
      p.getAligned(oiReq([1500]), resolve);
    });

    const errStatus = p.getAligned(oiReq([1500]), () => {});
    expect(errStatus).toEqual({ status: "error", message: "boom" });
    expect(oiMock).toHaveBeenCalledTimes(1);

    // Encore dans la fenêtre de 30 s → aucun re-fetch.
    vi.setSystemTime(29_000);
    p.getAligned(oiReq([1500]), () => {});
    expect(oiMock).toHaveBeenCalledTimes(1);

    // Passé 30 s → l'échec est purgé, un re-fetch est autorisé.
    vi.setSystemTime(31_000);
    p.getAligned(oiReq([1500]), () => {});
    expect(oiMock).toHaveBeenCalledTimes(2);
  });

  it("deux getAligned simultanés, même clé → UN seul fetch (single-flight)", () => {
    oiMock.mockReturnValue(new Promise<OpenInterest[]>(() => {})); // en vol
    const p = new AuxProvider();

    p.getAligned(oiReq([1500]), () => {});
    p.getAligned(oiReq([1500]), () => {});

    expect(oiMock).toHaveBeenCalledTimes(1);
  });

  it("aligne funding, stablecoins et mvrv depuis leurs fournisseurs respectifs", async () => {
    fundingMock.mockResolvedValue([fundingPoint(1000, 0.0001)]);
    stableMock.mockResolvedValue([{ time: 1000, value: 1.6e11 }]);
    cmMock.mockResolvedValue({
      series: { CapMVRVCur: { points: [{ time: 1000, value: 2.3 }] } },
      ts: 0,
      perime: false,
    });
    const p = new AuxProvider();

    const req = {
      exchange: "binance" as const,
      symbol: "BTCUSDT",
      timeframe: "1h" as const,
      ids: ["funding" as const, "stablecoins" as const, "mvrv" as const],
      candleTimes: [1500],
    };

    await new Promise<void>((resolve) => {
      let pending = 3;
      p.getAligned(req, () => {
        pending -= 1;
        if (pending === 0) resolve();
      });
    });

    const status = p.getAligned(req, () => {});
    expect(status).toEqual({
      status: "ready",
      aux: { funding: [0.0001], stablecoins: [1.6e11], mvrv: [2.3] },
    });
    // mvrv dérive l'asset "btc" de "BTCUSDT".
    expect(cmMock).toHaveBeenCalledWith("btc");
    expect(fundingFallbackMock).not.toHaveBeenCalled();
  });

  it("sans clé Coinalyze → funding Binance direct", async () => {
    coinalyzeKeyStore.setState({ hasKey: false });
    fundingFallbackMock.mockResolvedValue([{ t: 1000, v: 0.0001 }]);
    const p = new AuxProvider();

    await new Promise<void>((resolve) => {
      p.getAligned(fundingReq([1500]), resolve);
    });

    expect(p.getAligned(fundingReq([1500]), () => {})).toEqual({
      status: "ready",
      aux: { funding: [0.0001] },
    });
    expect(fundingMock).not.toHaveBeenCalled();
    expect(fundingFallbackMock).toHaveBeenCalledWith("BTCUSDT");
  });

  it.each(["exception", "série vide"] as const)(
    "replie funding sur Binance quand Coinalyze renvoie une %s",
    async (mode) => {
      if (mode === "exception") fundingMock.mockRejectedValue(new Error("Coinalyze 401"));
      else fundingMock.mockResolvedValue([]);
      fundingFallbackMock.mockResolvedValue([
        { t: 2000, v: 0.0002 },
        { t: 1000, v: 0.0001 },
      ]);
      const p = new AuxProvider();

      await new Promise<void>((resolve) => {
        p.getAligned(fundingReq([1500, 2500]), resolve);
      });

      expect(p.getAligned(fundingReq([1500, 2500]), () => {})).toEqual({
        status: "ready",
        aux: { funding: [0.0001, 0.0002] },
      });
      expect(fundingMock).toHaveBeenCalledWith("BTCUSDT", "1hour", expect.any(Number));
      expect(fundingFallbackMock).toHaveBeenCalledWith("BTCUSDT");
    },
  );

  it("rend funding vide sans inventer de valeur quand les deux sources sont vides", async () => {
    fundingMock.mockResolvedValue([]);
    fundingFallbackMock.mockResolvedValue([]);
    const p = new AuxProvider();

    await new Promise<void>((resolve) => {
      p.getAligned(fundingReq([1500]), resolve);
    });

    expect(p.getAligned(fundingReq([1500]), () => {})).toEqual({
      status: "ready",
      aux: { funding: [undefined] },
    });
  });

  it("transmet la clé personnelle à toutes les séries BGeometrics", async () => {
    const personalKey = "cle-bgeometrics-de-test";
    const ids: AuxSeriesId[] = [
      "nupl",
      "puell",
      "sopr",
      "reserveRisk",
      "mvrvZ",
      "realizedPrice",
      "asopr",
      "sthSopr",
      "lthSopr",
      "rhodl",
      "cvdd",
      "balancedPrice",
      "btcDominance",
    ];
    bgKeyMock.mockReturnValue(personalKey);
    bgFetchMock.mockResolvedValue({
      serie: { points: [{ time: 1000, value: 1 }], dernier: { time: 1000, value: 1 } },
      ts: 0,
      perime: false,
    });
    const p = new AuxProvider();
    const req = {
      exchange: "binance" as const,
      symbol: "BTCUSDT",
      timeframe: "1h" as const,
      ids,
      candleTimes: [1500],
    };

    await new Promise<void>((resolve) => {
      let pending = ids.length;
      p.getAligned(req, () => {
        pending -= 1;
        if (pending === 0) resolve();
      });
    });

    expect(p.getAligned(req, () => {}).status).toBe("ready");
    expect(bgKeyMock).toHaveBeenCalledTimes(ids.length);
    expect(bgFetchMock).toHaveBeenCalledTimes(ids.length);
    expect(bgFetchMock.mock.calls.map(([def]) => def.id).sort()).toEqual(
      [
        "nupl",
        "puell",
        "sopr",
        "reserveRisk",
        "mvrv",
        "realizedPrice",
        "asopr",
        "sthSopr",
        "lthSopr",
        "rhodl",
        "cvdd",
        "balancedPrice",
        "btcDominance",
      ].sort(),
    );
    for (const [, key] of bgFetchMock.mock.calls) expect(key).toBe(personalKey);
  });
});
