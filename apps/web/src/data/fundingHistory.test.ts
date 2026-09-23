import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chargerFundingVenue,
  normaliserCexFunding,
  parseBybitFundingPage,
  parseOkxFundingPage,
  parseHlFundingPage,
  viderCacheFundingHistorique,
} from "./fundingHistory";

const H = 3_600_000;
const NOW = 1_800_000_000_000;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); viderCacheFundingHistorique(); });
afterEach(() => vi.useRealTimers());

describe("parsers stricts des règlements", () => {
  it("Bybit ignore taux vide et valide retCode/symbole", () => {
    const rows = parseBybitFundingPage({ retCode: 0, result: { list: [
      { symbol: "BTCUSDT", fundingRateTimestamp: String(NOW - H), fundingRate: "" },
      { symbol: "BTCUSDT", fundingRateTimestamp: String(NOW - 2 * H), fundingRate: "0.0002" },
    ] } }, "BTCUSDT");
    expect(rows).toEqual([{ time: NOW - H, rate: undefined }, { time: NOW - 2 * H, rate: 0.0002 }]);
    expect(() => parseBybitFundingPage({ retCode: 10001, result: { list: [] } }, "BTCUSDT")).toThrow();
  });

  it("OKX lit realizedRate et jamais fundingRate prédit ; doublons contradictoires sont barrières", () => {
    const rows = parseOkxFundingPage({ code: "0", data: [
      { instId: "BTC-USDT-SWAP", fundingTime: String(NOW), fundingRate: "0.9", realizedRate: "0.0001" },
      { instId: "BTC-USDT-SWAP", fundingTime: String(NOW), fundingRate: "0.9", realizedRate: "0.0002" },
    ] }, "BTC-USDT-SWAP");
    expect(normaliserCexFunding(rows, "okx")[0]?.value).toBeUndefined();
    expect(rows[0]?.rate).toBe(0.0001);
  });

  it("Hyperliquid conserve le coin natif et rejette les chaînes vides", () => {
    expect(parseHlFundingPage([
      { coin: "kPEPE", time: NOW, fundingRate: "" },
      { coin: "kPEPE", time: NOW - H, fundingRate: "0.00001" },
    ], "kPEPE")).toEqual([
      { time: NOW, rate: undefined }, { time: NOW - H, rate: 0.00001 },
    ]);
    expect(() => parseHlFundingPage([{ coin: "PEPE", time: NOW, fundingRate: "0.9" }], "kPEPE")).toThrow();
  });
});

describe("normalisation causale", () => {
  it("demande deux intervalles cohérents et expire à la borne exclusive sans arrondir", () => {
    const rows = [
      { time: NOW - 3 * H, rate: 0.0003 },
      { time: NOW - 2 * H + 1_000, rate: 0.0003 },
      { time: NOW - H + 2_000, rate: 0.0003 },
    ];
    const p = normaliserCexFunding(rows, "bybit");
    expect(p.map((x) => x.value)).toEqual([undefined, undefined, 0.0003]);
    expect(p[2]?.time).toBe(NOW - H + 2_000);
    expect(p[2]?.validUntil).toBe(NOW + 2_000);
  });

  it("transition, trou et taux inconnu cassent la cadence ; OKX accepte 6 h", () => {
    const rows = [0, 6, 12, 18].map((h) => ({ time: NOW - (18 - h) * H, rate: 0.0006 }));
    expect(normaliserCexFunding(rows, "okx")[2]?.value).toBeCloseTo(0.0001);
    expect(normaliserCexFunding(rows, "bybit")[2]?.value).toBeUndefined();
    const trou = [{ time: 0, rate: 0.1 }, { time: H, rate: undefined }, { time: 2 * H, rate: 0.1 }, { time: 3 * H, rate: 0.1 }];
    expect(normaliserCexFunding(trou, "bybit").every((p) => p.value === undefined)).toBe(true);
  });
});

describe("client et cache partagé", () => {
  it("BTC-PERP HL et BTCUSDT partagent une seule promesse de cohorte CEX", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ retCode: 0, result: { list: [
      { symbol: "BTCUSDT", fundingRateTimestamp: String(NOW - H), fundingRate: "0.0001" },
    ] } }), { status: 200 }));
    const a = chargerFundingVenue("bybit", "BTCUSDT", 7, fetcher as typeof fetch, "binance");
    const b = chargerFundingVenue("bybit", "BTC-PERP", 7, fetcher as typeof fetch, "hyperliquid");
    expect(a).toBe(b);
    expect((await b).status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("symbol=BTCUSDT");
  });

  it("identités ambiguës n'émettent aucune requête historique", async () => {
    const fetcher = vi.fn();
    for (const [symbol, exchange] of [["BTCUSD", "binance"], ["BTC-PERP", "synthetic"], ["BTC/USDT", "hyperliquid"]] as const) {
      expect((await chargerFundingVenue("okx", symbol, 7, fetcher as typeof fetch, exchange)).status).toBe("error");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("Hyperliquid refuse huit pages pleines sans progression vers la date courante", async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ coin: "BTC", time: NOW - 90 * 24 * H + i * H, fundingRate: "0.0001" }));
    const fetcher = vi.fn(async () => new Response(JSON.stringify(page), { status: 200 }));
    const resultat = await chargerFundingVenue("hyperliquid", "BTCUSDT", 90, fetcher as typeof fetch);
    expect(resultat.status).toBe("error");
    expect(resultat.erreur).toMatch(/Pagination|tronqu/i);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("Hyperliquid refuse une huitième page pleine qui laisse le présent hors couverture", async () => {
    let debut = NOW - 90 * 24 * H;
    const fetcher = vi.fn(async () => {
      const page = Array.from({ length: 500 }, (_, i) => ({ coin: "BTC", time: debut + i * H / 4, fundingRate: "0.0001" }));
      debut += 500 * H / 4;
      return new Response(JSON.stringify(page), { status: 200 });
    });
    const resultat = await chargerFundingVenue("hyperliquid", "BTCUSDT", 90, fetcher as typeof fetch);
    expect(resultat.status).toBe("error");
    expect(resultat.erreur).toMatch(/tronqu/i);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("Bybit : pagination décroissante endTime=min−1, promesse en vol partagée", async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => ({ symbol: "BTCUSDT", fundingRateTimestamp: String(NOW - i * H), fundingRate: "0.0001" }));
    const fetcher = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({ retCode: 0, result: { list: fetcher.mock.calls.length === 1 ? page1 : [
      { symbol: "BTCUSDT", fundingRateTimestamp: String(NOW - 200 * H), fundingRate: "0.0001" },
    ] } }), { status: 200 }));
    const a = chargerFundingVenue("bybit", "BTCUSDT", 30, fetcher as typeof fetch);
    const b = chargerFundingVenue("bybit", "BTCUSDT", 30, fetcher as typeof fetch);
    expect(a).toBe(b);
    const result = await a;
    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain(`endTime=${NOW - 199 * H - 1}`);
  });

  it("timeout couvre aussi le corps JSON et n'efface pas les autres venues", async () => {
    const bloquee = vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) }));
    const attente = chargerFundingVenue("okx", "BTCUSDT", 7, bloquee as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(8_001);
    expect((await attente).status).toBe("error");
    const disponible = vi.fn(async () => new Response(JSON.stringify([{ coin: "BTC", time: NOW - H, fundingRate: "0.0001" }]), { status: 200 }));
    expect((await chargerFundingVenue("hyperliquid", "BTCUSDT", 7, disponible as typeof fetch)).status).toBe("ok");
  });
});
