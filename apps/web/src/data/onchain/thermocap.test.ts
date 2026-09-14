/**
 * Thermocap multiple = capitalisation ÷ émission cumulée valorisée (IssTotUSD cumulé).
 * Fixtures calculées à la main ; jointure par jour UTC.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculerThermocap } from "./thermocap";

const JOUR = 86_400_000;
const pt = (jour: number, value: number, decalageMs = 0) => ({ time: jour * JOUR + decalageMs, value });

describe("calculerThermocap", () => {
  it("cumule l'émission puis divise la capitalisation du même jour", () => {
    const iss = [pt(1, 100), pt(2, 100), pt(3, 200)]; // cumul 100, 200, 400
    const mcap = [pt(1, 1000), pt(2, 3000), pt(3, 2000)];
    const s = calculerThermocap(iss, mcap);
    expect(s.points).toEqual([pt(1, 10), pt(2, 15), pt(3, 5)]);
    expect(s.dernier).toEqual(pt(3, 5));
  });

  it("un jour sans capitalisation n'apparaît pas mais son émission compte dans le cumul", () => {
    const iss = [pt(1, 100), pt(2, 100), pt(3, 200)];
    const mcap = [pt(1, 1000), pt(3, 2000)];
    expect(calculerThermocap(iss, mcap).points).toEqual([pt(1, 10), pt(3, 5)]);
  });

  it("un jour sans émission reprend le dernier cumul connu", () => {
    const iss = [pt(1, 100), pt(2, 100)];
    const mcap = [pt(1, 1000), pt(2, 3000), pt(4, 4000)];
    expect(calculerThermocap(iss, mcap).points).toEqual([pt(1, 10), pt(2, 15), pt(4, 20)]);
  });

  it("avant la première émission : aucun point (pas de division par zéro)", () => {
    const iss = [pt(2, 100)];
    const mcap = [pt(1, 1000), pt(2, 500)];
    expect(calculerThermocap(iss, mcap).points).toEqual([pt(2, 5)]);
  });

  it("horodatages intra-journée rattachés au jour UTC", () => {
    const iss = [pt(1, 100, 3_600_000)];
    const mcap = [pt(1, 1000, 7_200_000)];
    expect(calculerThermocap(iss, mcap).points).toEqual([pt(1, 10)]);
  });
});

function stockage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("fetchThermocap : transport, pagination et cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("demande IssTotUSD et CapMrktCurUSD depuis 2010, suit next_page_url, met en cache la série dérivée", async () => {
    const { fetchThermocap } = await import("./thermocap");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ asset: "btc", time: "2026-09-01T00:00:00.000000000Z", IssTotUSD: "100", CapMrktCurUSD: "1000" }],
          next_page_url: "https://community-api.coinmetrics.io/v4/suite?page=2",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [{ asset: "btc", time: "2026-09-02T00:00:00.000000000Z", IssTotUSD: "100", CapMrktCurUSD: "3000" }],
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const r = await fetchThermocap();
    expect(r?.perime).toBe(false);
    expect(r?.donnee.points.map((p) => p.value)).toEqual([10, 15]);
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url).toContain("metrics=IssTotUSD%2CCapMrktCurUSD");
    expect(url).toContain("start_time=2010-07-01");
    expect(url).toContain("page_size=10000");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("page=2");
    const brut = localStorage.getItem("axiom:onchain:cm:thermocap:full");
    expect(brut).not.toBeNull();
    expect(JSON.parse(brut!).donnee.points).toHaveLength(2);
    await fetchThermocap();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("échec réseau : cache périmé resservi, sinon null", async () => {
    const { fetchThermocap } = await import("./thermocap");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    expect(await fetchThermocap()).toBeNull();
    localStorage.setItem(
      "axiom:onchain:cm:thermocap:full",
      JSON.stringify({ donnee: { points: [{ time: 1, value: 2 }], dernier: { time: 1, value: 2 } }, ts: 0 }),
    );
    const r = await fetchThermocap();
    expect(r?.perime).toBe(true);
    expect(r?.donnee.dernier).toEqual({ time: 1, value: 2 });
  });
});
