import { afterEach, describe, expect, it, vi } from "vitest";
import { chargerQuotesCarry, quoteCarryPerime, rapprocherCarnets, prixExecutable } from "./fundingCarryQuotes";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("carnets carry", () => {
  it("prix exécutable sur même quantité, refuse la profondeur partielle", () => {
    expect(prixExecutable([[100, 0.5], [101, 0.5]], 1)).toBeCloseTo(100.5);
    expect(prixExecutable([[100, 0.5]], 1)).toBeNull();
  });
  it("exige deux acquisitions chevauchantes et ne fabrique pas le timestamp spot", () => {
    const spot = { debut: 1000, fin: 1200, observeLe: null };
    const perp = { debut: 1100, fin: 1300, observeLe: 1150 };
    expect(rapprocherCarnets(spot, perp, 1400)).toBe(true);
    expect(rapprocherCarnets(spot, { ...perp, debut: 1201 }, 1400)).toBe(false);
    expect(rapprocherCarnets(spot, perp, 7000)).toBe(false);
    expect(rapprocherCarnets(spot, { ...perp, observeLe: 1401 }, 1400)).toBe(false);
    expect(rapprocherCarnets(spot, { ...perp, observeLe: NaN }, 1400)).toBe(false);
    expect(rapprocherCarnets({ debut: 10_000, fin: 10_200, observeLe: null }, { debut: 10_100, fin: 10_300, observeLe: 4_000 }, 10_400)).toBe(false);
  });
  it("expire au premier timestamp source ancien, même si la réception spot reste fraîche", () => {
    const q = { spot: { debut: 10_000, fin: 10_100, observeLe: null }, perp: { debut: 10_000, fin: 10_100, observeLe: 6_100 }, financement: { debut: 10_000, fin: 10_100, observeLe: 10_000 } };
    expect(quoteCarryPerime(q, 11_000)).toBe(false);
    expect(quoteCarryPerime(q, 11_101)).toBe(true);
  });
  it("charge les deux carnets publics et le funding, sans inventer un horodatage spot", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const fetcher = vi.fn(async (url: string, _options?: RequestInit) => {
      const data = url.includes("premiumIndex") ? { symbol: "BTCUSDT", lastFundingRate: "0.0001", nextFundingTime: now + 8 * 3_600_000, time: now }
        : url.includes("fundingInfo") ? []
        : url.includes("fapi/v1/depth") ? { T: now, bids: [["101", "2"]], asks: [["102", "2"]] }
        : { lastUpdateId: 1, bids: [["99", "2"]], asks: [["100", "2"]] };
      return { ok: true, json: async () => data };
    });
    vi.stubGlobal("fetch", fetcher);
    const r = await chargerQuotesCarry("BTCUSDT", 100);
    expect(r.statut).toBe("ok");
    if (r.statut === "ok") {
      expect(r.quote.quantite).toBe(1);
      expect(r.quote.spotEntree).toBe(100);
      expect(r.quote.perpEntree).toBe(101);
      expect(r.quote.spot.observeLe).toBeNull();
      expect(r.quote.perp.observeLe).toBe(now);
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.every((call) => (call[1] as { cache?: string })?.cache === "no-store")).toBe(true);
  });
  it.each([
    ["HTTP 503", null],
    ["payload non tableau", { data: [] }],
    ["entrée invalide", [{ symbol: "BTCUSDT", fundingIntervalHours: "inconnu" }]],
    ["entrée nulle", [null]],
    ["symbole absent", [{}]],
    ["cadence sans symbole", [{ fundingIntervalHours: 4 }]],
    ["doublon contradictoire", [{ symbol: "BTCUSDT", fundingIntervalHours: 4 }, { symbol: "BTCUSDT", fundingIntervalHours: 8 }]],
  ])("refuse une cadence non certifiée : %s", async (_cas, metadata) => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("fundingInfo")) return metadata === null ? { ok: false, status: 503 } : { ok: true, json: async () => metadata };
      const data = url.includes("premiumIndex") ? { symbol: "BTCUSDT", lastFundingRate: "0.0001", nextFundingTime: now + 4 * 3_600_000, time: now }
        : url.includes("fapi/v1/depth") ? { T: now, bids: [["101", "2"]], asks: [["102", "2"]] }
        : { bids: [["99", "2"]], asks: [["100", "2"]] };
      return { ok: true, json: async () => data };
    }));
    expect((await chargerQuotesCarry("BTCUSDT", 100)).statut).toBe("indisponible");
  });
  it.each(["perp", "funding"])("refuse un timestamp source futur : %s", async (source) => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const data = url.includes("fundingInfo") ? []
        : url.includes("premiumIndex") ? { symbol: "BTCUSDT", lastFundingRate: "0.0001", nextFundingTime: now + 8 * 3_600_000, time: now + (source === "funding" ? 4_000 : 0) }
        : url.includes("fapi/v1/depth") ? { T: now + (source === "perp" ? 4_000 : 0), bids: [["101", "2"]], asks: [["102", "2"]] }
        : { bids: [["99", "2"]], asks: [["100", "2"]] };
      return { ok: true, json: async () => data };
    }));
    expect((await chargerQuotesCarry("BTCUSDT", 100)).statut).toBe("indisponible");
  });
  it("utilise la cadence explicite de 4 h lorsqu'elle figure dans fundingInfo", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const data = url.includes("fundingInfo") ? [{ symbol: "BTCUSDT", fundingIntervalHours: 4 }]
        : url.includes("premiumIndex") ? { symbol: "BTCUSDT", lastFundingRate: "0.0001", nextFundingTime: now + 4 * 3_600_000, time: now }
        : url.includes("fapi/v1/depth") ? { T: now, bids: [["101", "2"]], asks: [["102", "2"]] }
        : { bids: [["99", "2"]], asks: [["100", "2"]] };
      return { ok: true, json: async () => data };
    }));
    const r = await chargerQuotesCarry("BTCUSDT", 100);
    expect(r.statut).toBe("ok");
    if (r.statut === "ok") expect(r.quote.intervalHours).toBe(4);
  });
});
