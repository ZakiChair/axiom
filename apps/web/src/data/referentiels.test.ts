import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _viderCacheReferentiels,
  bucketsHoraires,
  deltasFenetre,
  histOiUsdAvecRepli,
} from "./referentiels";
import type { PointSerie } from "../lib/referentiel";
import { coinalyzeProvider } from "./coinalyze";
import { fetchOpenInterestHist } from "./binanceFutures";

vi.mock("./coinalyze", () => ({
  coinalyzeProvider: { fetchOpenInterestHistory: vi.fn() },
}));
vi.mock("./binanceFutures", () => ({
  fetchOpenInterestHist: vi.fn(),
  futuresSymbol: (s: string) => s.trim().toUpperCase(),
}));

const H = 3_600_000;

describe("deltasFenetre", () => {
  const base = 1_700_000_000_000;
  const points: PointSerie[] = [
    { t: base, v: 100 },
    { t: base + H, v: 110 },
    { t: base + 2 * H, v: 99 },
  ];
  it("variation % vs le dernier point ≤ t − fenêtre", () => {
    const d = deltasFenetre(points, H);
    expect(d).toHaveLength(2);
    expect(d[0]?.t).toBe(base + H);
    expect(d[0]?.v).toBeCloseTo(10, 6);
    expect(d[1]?.v).toBeCloseTo(-10, 6);
  });
  it("fenêtre plus large que la série → vide ; référence à 0 ignorée", () => {
    expect(deltasFenetre(points, 3 * H)).toEqual([]);
    expect(deltasFenetre([{ t: base, v: 0 }, { t: base + H, v: 5 }], H)).toEqual([]);
  });
});

describe("bucketsHoraires", () => {
  it("agrège l'USD par heure pleine et remplit les heures vides à 0", () => {
    const t0 = Math.floor(1_700_000_000_000 / H) * H; // heure pleine
    const events = [
      { t: t0 + 60_000, usd: 100 },
      { t: t0 + 120_000, usd: 50 },
      { t: t0 + 2 * H + 1, usd: 7 },
    ];
    const buckets = bucketsHoraires(events, t0 + 3 * H);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toEqual({ t: t0, v: 150 });
    expect(buckets[1]).toEqual({ t: t0 + H, v: 0 });
    expect(buckets[2]).toEqual({ t: t0 + 2 * H, v: 7 });
  });
  it("vide → vide", () => {
    expect(bucketsHoraires([], 1_700_000_000_000)).toEqual([]);
  });
});

/**
 * Repli OI : Coinalyze (primaire, 30 j) → Binance `futures/data/openInterestHist`
 * (gratuit, SANS clé) dès que Coinalyze est indisponible / sans clé / à vide.
 */
describe("histOiUsdAvecRepli", () => {
  const oiCoinalyze = vi.mocked(coinalyzeProvider.fetchOpenInterestHistory);
  const oiBinance = vi.mocked(fetchOpenInterestHist);
  const t0 = 1_700_000_000_000;
  const depuis = t0 - 30 * 24 * H;

  beforeEach(() => {
    _viderCacheReferentiels();
    vi.clearAllMocks();
  });

  it("sert Coinalyze quand il répond, SANS appeler Binance (quota préservé)", async () => {
    oiCoinalyze.mockResolvedValue([
      { time: t0, symbol: "BTCUSDT_PERP.A", oi: Number.NaN, oiUsd: 6.0e9 },
      { time: t0 + H, symbol: "BTCUSDT_PERP.A", oi: Number.NaN, oiUsd: 6.2e9 },
    ]);

    expect(await histOiUsdAvecRepli("BTCUSDT", "1hour", depuis)).toEqual([
      { t: t0, v: 6.0e9 },
      { t: t0 + H, v: 6.2e9 },
    ]);
    expect(oiBinance).not.toHaveBeenCalled();
  });

  it("replie sur Binance quand Coinalyze rejette (401 sans clé, quota saturé…)", async () => {
    oiCoinalyze.mockRejectedValue(new Error("Coinalyze 401 Unauthorized"));
    oiBinance.mockResolvedValue([{ time: t0, oi: 1, oiUsd: 5.5e9 }]);

    expect(await histOiUsdAvecRepli("BTCUSDT", "1hour", depuis)).toEqual([{ t: t0, v: 5.5e9 }]);
    // Historique horaire (période `/futures/data`, ≤ 500 points ≈ 20 j).
    expect(oiBinance).toHaveBeenCalledWith("BTCUSDT", "1h", 500);
  });

  it("replie sur Binance quand Coinalyze rend une série VIDE (purge quotidienne)", async () => {
    oiCoinalyze.mockResolvedValue([]);
    oiBinance.mockResolvedValue([{ time: t0, oi: 1, oiUsd: 5.5e9 }]);

    expect(await histOiUsdAvecRepli("BTCUSDT", "1hour", depuis)).toEqual([{ t: t0, v: 5.5e9 }]);
  });

  it("rend une série vide (jamais d'exception) si les DEUX sources échouent", async () => {
    oiCoinalyze.mockRejectedValue(new Error("Coinalyze indisponible"));
    oiBinance.mockRejectedValue(new Error("fapi injoignable"));

    expect(await histOiUsdAvecRepli("BTCUSDT", "1hour", depuis)).toEqual([]);
  });
});
