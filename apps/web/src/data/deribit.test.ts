import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeMaxPain,
  fetchDeribitOptionChain,
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

  it.each([0, NaN, -10])("sans intérêt ouvert positif (%s), aucun max pain n’est défini", (oi) => {
    expect(computeMaxPain([
      { strike: 100, callOi: oi, putOi: oi },
      { strike: 120, callOi: oi, putOi: oi },
    ])).toBeNull();
  });

  it("un OI négatif est absent et ne crée jamais un paiement négatif", () => {
    // Le put positif à K=120 impose S=120 ; un faux call OI=-100 à K=100
    // ne doit pas attirer le minimum vers le candidat S=140.
    expect(computeMaxPain([
      { strike: 100, callOi: -100, putOi: NaN },
      { strike: 120, callOi: 0, putOi: 10 },
      { strike: 140, callOi: 0, putOi: 0 },
    ])).toBe(120);
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
 * fetchDeribitOptionChain : fetch global stubbé (même pattern que fetchDvolHistory
 * ci-dessous — appelDeribit appelle `fetchJsonExt` qui appelle le `fetch` global direct).
 */
describe("fetchDeribitOptionChain", () => {
  const now = Date.UTC(2026, 8, 28, 11);
  const book = {
    instrument_name: "BTC-2OCT26-78000-P", mark_iv: 55.5, open_interest: 120,
    underlying_price: 65_000, interest_rate: 0, volume: 12.5, mark_price: 0.023,
    creation_timestamp: now - 2_000,
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  let rows: Record<string, unknown>[];
  let index: unknown;
  beforeEach(() => {
    rows = [book];
    index = 64_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    fetchMock = vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => ({
      result: url.includes("get_index_price") ? { index_price: index } : rows,
    }) }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("charge un index agrégé distinct du forward et conserve date source et réception", async () => {
    const out = await fetchDeribitOptionChain("BTC");
    expect(out).toEqual([{
      instrument: book.instrument_name, expiryMs: Date.UTC(2026, 9, 2, 8), strike: 78_000,
      type: "put", markIv: 55.5, openInterest: 120, underlying: 65_000, indexPrice: 64_000,
      observedAt: now - 2_000, receivedAt: now, interestRate: 0, volume24h: 12.5, markPrice: .023,
    }]);
    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toHaveLength(2);
    expect(urls.filter((url) => url.includes("get_index_price"))).toHaveLength(1);
    expect(urls.find((url) => url.includes("get_index_price"))).toContain("index_name=btc_usd");
  });
  it("écarte autres devises, expirées à 08:00 UTC et noms invalides", async () => {
    rows = [book, { ...book, instrument_name: "ETH-2OCT26-3000-C" },
      { ...book, instrument_name: "BTC-28SEP26-78000-P" }, { ...book, instrument_name: "BTC-25SEP26-78000-P" },
      { ...book, instrument_name: null }];
    expect((await fetchDeribitOptionChain("BTC")).map((p) => p.instrument)).toEqual([book.instrument_name]);
  });
  it("valeurs manquantes/non numériques/négatives deviennent absentes, pas zéro", async () => {
    rows = [{ ...book, open_interest: null, mark_iv: "55", volume: null, mark_price: "N/A", underlying_price: -2 }];
    const [p] = await fetchDeribitOptionChain("BTC");
    expect(p?.openInterest).toBeNaN();
    expect(p?.markIv).toBeNaN();
    expect(p?.underlying).toBeNaN();
    expect(p?.volume24h).toBeNaN();
    expect(p?.markPrice).toBeNaN();
  });
  it("index absent ou invalide : erreur explicite, jamais remplacé par le forward", async () => {
    index = null;
    await expect(fetchDeribitOptionChain("BTC")).rejects.toThrow(/index/i);
  });
  it("ne fabrique pas de date source si creation_timestamp est absent/futur", async () => {
    rows = [{ ...book, creation_timestamp: undefined }, { ...book, creation_timestamp: now + 10_000 }];
    expect((await fetchDeribitOptionChain("BTC")).map((p) => p.observedAt)).toEqual([undefined, undefined]);
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
