import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingRate, OpenInterest } from "@axiom/types";

// Mocks des fournisseurs sous-jacents (pattern extapi/mexc.test) — hissés par Vitest
// avant les imports statiques. On stub UNIQUEMENT ce que consomme l'AuxProvider.
vi.mock("../data/coinalyze", () => ({
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

import { AuxProvider } from "./auxProvider";
import { coinalyzeProvider } from "../data/coinalyze";
import { stablecoinsSupplyProvider } from "../data/macro/stablecoins";
import { fetchCoinMetrics } from "../data/onchain/coinmetrics";

const oiMock = vi.mocked(coinalyzeProvider.fetchOpenInterestHistory);
const fundingMock = vi.mocked(coinalyzeProvider.fetchFundingRateHistory);
const stableMock = vi.mocked(stablecoinsSupplyProvider.fetchSeries);
const cmMock = vi.mocked(fetchCoinMetrics);

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

describe("AuxProvider.getAligned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("1er appel → pending + déclenche le fetch sous-jacent", () => {
    oiMock.mockReturnValue(new Promise<OpenInterest[]>(() => {})); // jamais résolu
    const p = new AuxProvider();

    const status = p.getAligned(oiReq([1500, 2500]), () => {});

    expect(status).toEqual({ status: "pending" });
    expect(oiMock).toHaveBeenCalledTimes(1);
    // Signature vérifiée : (symbol, "1hour", sinceMs).
    expect(oiMock).toHaveBeenCalledWith("BTCUSDT", "1hour", expect.any(Number));
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
  });
});
