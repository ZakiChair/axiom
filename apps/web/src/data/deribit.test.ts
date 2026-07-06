import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeMaxPain,
  fetchDvolHistory,
  parseOptionInstrument,
  putCallRatioOi,
  type StrikeOi,
} from "./deribit";

describe("parseOptionInstrument", () => {
  it("parse un put BTC daté (échéance à 08:00 UTC)", () => {
    const p = parseOptionInstrument("BTC-28AUG26-78000-P");
    expect(p).toEqual({
      currency: "BTC",
      expiryMs: Date.UTC(2026, 7, 28, 8, 0, 0),
      strike: 78000,
      type: "put",
    });
  });

  it("parse un call ETH et respecte la convention 08:00 UTC vérifiée sur les futures", () => {
    const p = parseOptionInstrument("ETH-2JUL26-3000-C");
    expect(p?.type).toBe("call");
    expect(p?.strike).toBe(3000);
    // BTC-2JUL26 a pour expiration_timestamp 1782979200000 (relevé réel Deribit).
    expect(p?.expiryMs).toBe(1782979200000);
  });

  it("gère un strike décimal (ex. options à petit prix)", () => {
    const p = parseOptionInstrument("BTC-5JUL26-0.5-C");
    expect(p?.strike).toBe(0.5);
  });

  it("renvoie null pour un future (pas d'option)", () => {
    expect(parseOptionInstrument("BTC-25SEP26")).toBeNull();
    expect(parseOptionInstrument("BTC-PERPETUAL")).toBeNull();
  });

  it("renvoie null pour un mois invalide", () => {
    expect(parseOptionInstrument("BTC-2ZZZ26-78000-P")).toBeNull();
  });
});

describe("computeMaxPain", () => {
  it("trouve le strike de douleur minimale (exemple contrôlé)", () => {
    // 90 (call 10), 100 (call 5 / put 5), 110 (put 10).
    // Douleur : S=90 → 250 ; S=100 → 200 ; S=110 → 250. Minimum en 100.
    const niveaux: StrikeOi[] = [
      { strike: 90, callOi: 10, putOi: 0 },
      { strike: 100, callOi: 5, putOi: 5 },
      { strike: 110, callOi: 0, putOi: 10 },
    ];
    expect(computeMaxPain(niveaux)).toBe(100);
  });

  it("ignore les strikes invalides et renvoie null si aucun strike valide", () => {
    expect(computeMaxPain([])).toBeNull();
    expect(computeMaxPain([{ strike: 0, callOi: 1, putOi: 1 }])).toBeNull();
  });

  it("tolère des OI non finis (traités comme absents)", () => {
    const niveaux: StrikeOi[] = [
      { strike: 100, callOi: NaN, putOi: 10 },
      { strike: 120, callOi: 10, putOi: NaN },
    ];
    // S=100 : puts K>100 → aucun ; calls K<100 → aucun → 0 (minimum).
    expect(computeMaxPain(niveaux)).toBe(100);
  });
});

describe("putCallRatioOi", () => {
  it("calcule Σputs / Σcalls", () => {
    const points = [
      { type: "call" as const, openInterest: 10 },
      { type: "call" as const, openInterest: 30 },
      { type: "put" as const, openInterest: 20 },
    ];
    expect(putCallRatioOi(points)).toBeCloseTo(20 / 40, 6);
  });

  it("renvoie NaN sans aucun call", () => {
    expect(Number.isNaN(putCallRatioOi([{ type: "put", openInterest: 5 }]))).toBe(true);
  });
});

/**
 * fetchDvolHistory : fetch global stubbé (pattern twelvedata.test.ts, PAS de vi.mock —
 * fetchJsonExt appelle le `fetch` global directement, cf. binanceDapi.ts:120-130). La
 * réponse simulée reprend l'enveloppe JSON-RPC Deribit ({ result: { data: [...] } }),
 * même forme que `fetchDvol` (deribit.ts ligne 300 : `appelDeribit<{ data: number[][] }>`).
 */
describe("fetchDvolHistory", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mappe chaque bougie [ts, o, h, l, c] en { time: ts, value: c }", async () => {
    const json = {
      result: {
        data: [
          [1_700_000_000_000, 50, 55, 45, 52],
          [1_700_086_400_000, 52, 60, 50, 58],
        ],
      },
    };
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(json) });

    const out = await fetchDvolHistory("BTC", 90);

    expect(out).toEqual([
      { time: 1_700_000_000_000, value: 52 },
      { time: 1_700_086_400_000, value: 58 },
    ]);
  });

  it("appelle get_volatility_index_data avec currency, résolution 86400 et un intervalle dérivé de `days`", async () => {
    const json = { result: { data: [] } };
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(json) });

    const avant = Date.now();
    await fetchDvolHistory("ETH", 30);
    const apres = Date.now();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("get_volatility_index_data");
    const params = new URL(url).searchParams;
    expect(params.get("currency")).toBe("ETH");
    expect(params.get("resolution")).toBe("86400");

    const fin = Number(params.get("end_timestamp"));
    const debut = Number(params.get("start_timestamp"));
    // end_timestamp doit être "maintenant" (borné par l'exécution du test, pas figé).
    expect(fin).toBeGreaterThanOrEqual(avant);
    expect(fin).toBeLessThanOrEqual(apres);
    // start_timestamp dérivé de `days` : exactement fin - 30 jours en ms.
    expect(debut).toBe(fin - 30 * 24 * 60 * 60 * 1000);
  });

  it("écarte les lignes non numériques (ts ou close invalide)", async () => {
    const json = {
      result: {
        data: [
          [1_700_000_000_000, 50, 55, 45, 52],
          [null, 52, 60, 50, 58], // ts invalide
          [1_700_172_800_000, 58, 62, 54, NaN], // close non fini
        ],
      },
    };
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(json) });

    const out = await fetchDvolHistory("BTC", 7);
    expect(out).toEqual([{ time: 1_700_000_000_000, value: 52 }]);
  });
});
