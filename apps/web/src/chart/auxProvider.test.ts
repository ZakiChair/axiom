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
}));

import { AuxProvider } from "./auxProvider";
import { coinalyzeProvider } from "../data/coinalyze";
import { stablecoinsSupplyProvider } from "../data/macro/stablecoins";
import { fetchBgeometricMetrique } from "../data/onchain/bgeometrics";
import { fetchCoinMetrics } from "../data/onchain/coinmetrics";
import { histFunding, histOiUsd } from "../data/referentiels";
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
  /** Durée d'un bucket Coinalyze : les points OI/funding sont horodatés à sa FIN. */
  const H = 3_600_000;

  beforeEach(() => {
    vi.clearAllMocks();
    coinalyzeKeyStore.setState({ hasKey: true });
    oiFallbackMock.mockResolvedValue(null);
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
    expect(oiMock).toHaveBeenCalledTimes(1);
    // Signature vérifiée : (symbol, "1hour", sinceMs).
    expect(oiMock).toHaveBeenCalledWith("BTCUSDT", "1hour", expect.any(Number));
  });

  it("sans clé Coinalyze → OI Binance direct, sans requête Coinalyze", async () => {
    coinalyzeKeyStore.setState({ hasKey: false });
    oiFallbackMock.mockResolvedValue([{ t: 1000, v: 10 }, { t: 2000, v: 20 }]);
    const p = new AuxProvider();

    // Bougies [500, 1500) et [1500, 2500) : le relevé de 1000 est connu à la clôture de
    // la première, celui de 2000 à la clôture de la seconde.
    await new Promise<void>((resolve) => {
      p.getAligned(oiReq([500, 1500]), resolve);
    });

    expect(p.getAligned(oiReq([500, 1500]), () => {})).toEqual({
      status: "ready",
      aux: { oi: [10, 20] },
    });
    expect(oiFallbackMock).toHaveBeenCalledWith("BTCUSDT");
    expect(oiMock).not.toHaveBeenCalled();
  });

  it("après résolution → onReady appelé, 2e appel → ready avec série alignée (alignAux)", async () => {
    // Buckets [0, H) → 10 et [H, 2H) → 20 ; sur un chart 1 h, chaque bougie reçoit la
    // clôture du bucket qui lui correspond (cf. anti-régression plus bas).
    oiMock.mockResolvedValue([oiPoint(0, 10), oiPoint(H, 20)]);
    const p = new AuxProvider();

    await new Promise<void>((resolve) => {
      const first = p.getAligned(oiReq([0, H]), resolve);
      expect(first).toEqual({ status: "pending" });
    });

    // 2e appel même clé (id+symbole) → données prêtes, alignées sur candleTimes.
    const second = p.getAligned(oiReq([0, H]), () => {});
    expect(second).toEqual({ status: "ready", aux: { oi: [10, 20] } });
    // Le fetch n'est PAS relancé (mémoïsé).
    expect(oiMock).toHaveBeenCalledTimes(1);
  });

  it("replie OI sur Binance quand Coinalyze renvoie une série vide, mappe et trie", async () => {
    oiMock.mockResolvedValue([]);
    oiFallbackMock.mockResolvedValue([
      { t: 2000, v: 20 },
      { t: 1000, v: 10 },
    ]);
    const p = new AuxProvider();

    await new Promise<void>((resolve) => {
      p.getAligned(oiReq([500, 1500]), resolve);
    });

    expect(p.getAligned(oiReq([500, 1500]), () => {})).toEqual({
      status: "ready",
      aux: { oi: [10, 20] },
    });
    expect(oiMock).toHaveBeenCalledWith("BTCUSDT", "1hour", expect.any(Number));
    expect(oiFallbackMock).toHaveBeenCalledWith("BTCUSDT");
  });

  it("échec du fetch → error, puis pas de re-fetch avant 30 s", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    // Les DEUX sources doivent tomber : depuis la convention d'horodatage du 2026-09-02,
    // l'échec Coinalyze est rattrapé par le repli Binance (patron `histOiUsdAvecRepli`
    // déplié dans rawFetch). Seul l'échec du repli fait remonter l'erreur à l'écran.
    oiMock.mockRejectedValue(new Error("coinalyze down"));
    oiFallbackMock.mockRejectedValue(new Error("boom"));
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
    // Horodatages RÉALISTES (ms epoch, pas de bucket 1 h) : depuis la convention du
    // 2026-09-02, un point Coinalyze est réhorodaté à la FIN de son bucket. Le bucket
    // ouvrant à T0−1h est donc connu à T0, l'ouverture de la bougie mesurée.
    const H = 3_600_000;
    const T0 = 1_700_000_000_000;
    fundingMock.mockResolvedValue([fundingPoint(T0 - H, 0.0001)]);
    // Séries NON réhorodatées (quotidiennes, alignées sur l'ouverture) : inchangées.
    stableMock.mockResolvedValue([{ time: T0 - H, value: 1.6e11 }]);
    cmMock.mockResolvedValue({
      series: { CapMVRVCur: { points: [{ time: T0 - H, value: 2.3 }] } },
      ts: 0,
      perime: false,
    });
    const p = new AuxProvider();

    const req = {
      exchange: "binance" as const,
      symbol: "BTCUSDT",
      timeframe: "1h" as const,
      ids: ["funding" as const, "stablecoins" as const, "mvrv" as const],
      candleTimes: [T0],
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
      // Règlements Binance : ils portent DÉJÀ leur instant connu, donc pas de
      // réhorodatage — mais ils se lisent désormais à la CLÔTURE de bougie (2500 et
      // 3500 pour un pas de 1000). Un règlement par bougie, valeurs distinctes.
      fundingFallbackMock.mockResolvedValue([
        { t: 3000, v: 0.0002 },
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

/**
 * Horodatage des buckets Coinalyze (suggestion 17, vérifiée sur l'API le 2026-09-02) :
 * `t` est le DÉBUT du bucket et la valeur retenue (`c`) sa CLÔTURE — elle n'est donc
 * connue qu'à `t + 1 h`. Les deux moitiés du correctif se testent ENSEMBLE : décalage
 * des points à la fin du bucket ET alignement sur la clôture de bougie.
 */
describe("AuxProvider — horodatage des buckets Coinalyze", () => {
  const H = 3_600_000;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    coinalyzeKeyStore.setState({ hasKey: true });
    oiFallbackMock.mockResolvedValue(null);
    // Deux buckets 1 h CLOS : [0, H) → 10 et [H, 2H) → 20.
    oiMock.mockResolvedValue([oiPoint(0, 10), oiPoint(H, 20)]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Résout le fetch puis rend la série alignée sur `candleTimes`. */
  async function serieOi(candleTimes: number[], timeframe: "15m" | "1h") {
    const p = new AuxProvider();
    const req = {
      exchange: "binance" as const,
      symbol: "BTCUSDT",
      timeframe,
      ids: ["oi" as const],
      candleTimes,
    };
    await new Promise<void>((resolve) => {
      p.getAligned(req, resolve);
    });
    return p.getAligned(req, () => {});
  }

  it("chart 15 min : les bougies DANS le bucket ne reçoivent pas sa clôture (pas de look-ahead)", async () => {
    vi.setSystemTime(3 * H); // les deux buckets sont clos.
    // Bougies 15 min à l'intérieur de [0, H) : la clôture du bucket n'est connue qu'à H,
    // donc seule la bougie qui CLÔT à H (ouverte à 3H/4) peut l'afficher.
    const status = await serieOi([0, H / 4, H / 2, (3 * H) / 4, H], "15m");
    expect(status).toEqual({
      status: "ready",
      aux: { oi: [undefined, undefined, undefined, 10, 10] },
    });
  });

  it("chart 1 h : sortie INCHANGÉE par rapport à l'alignement d'avant correctif", async () => {
    vi.setSystemTime(3 * H);
    // Anti-régression : à pas de bougie = pas de bucket, décalage + clôture se compensent.
    const status = await serieOi([0, H, 2 * H], "1h");
    expect(status).toEqual({ status: "ready", aux: { oi: [10, 20, 20] } });
  });

  it("bucket EN COURS : borné à l'instant courant → la bougie live garde la valeur fraîche", async () => {
    vi.setSystemTime(H + H / 4); // le bucket [H, 2H) n'est pas clos : 20 est sa valeur du moment.
    const status = await serieOi([0, H / 4, H / 2, (3 * H) / 4, H], "15m");
    expect(status).toEqual({
      status: "ready",
      aux: { oi: [undefined, undefined, undefined, 10, 20] },
    });
  });
});
