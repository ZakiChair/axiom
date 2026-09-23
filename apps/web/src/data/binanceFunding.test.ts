import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchBinanceFundingHourly,
  normaliserFundingHoraire,
  parseBinanceFundingHistory,
} from "./binanceFunding";

const H = 3_600_000;
const row = (time: number, rate = "0.00008", rateType: string | undefined = "Regular") => ({
  symbol: "BTCUSDT", fundingTime: time, fundingRate: rate, ...(rateType === undefined ? {} : { rateType }),
});

describe("funding Binance historique", () => {
  afterEach(() => vi.useRealTimers());

  it.each([1, 4, 8])("convertit le taux par règlement à la cadence observée de %ih, avec léger jitter", (hours) => {
    const debut = 1_790_000_000_000;
    const raw = [row(debut), row(debut + hours * H), row(debut + 2 * hours * H + 4, "0.00008")];
    const points = normaliserFundingHoraire(parseBinanceFundingHistory(raw, "BTCUSDT"));
    expect(points.map((p) => p.value)).toEqual([undefined, undefined, 0.00008 / hours]);
    expect(points[2]?.time).toBe(debut + 2 * hours * H + 4);
    expect(points[2]?.validUntil).toBe(debut + 3 * hours * H + 4);
  });

  it("respecte les timestamps de la sonde réelle avec deux écarts de 8h malgré 4 ms", () => {
    const times = [1790092800000, 1790121600000, 1790150400004, 1790179200004];
    const points = normaliserFundingHoraire(parseBinanceFundingHistory(times.map((time) => row(time)), "BTCUSDT"));
    expect(points.map((p) => p.time)).toEqual(times);
    expect(points.map((p) => p.value)).toEqual([undefined, undefined, 0.00001, 0.00001]);
  });

  it("refuse de déduire une cadence si le décalage dépasse 60 secondes", () => {
    const times = [0, 8 * H, 16 * H + 60_001];
    const points = normaliserFundingHoraire(parseBinanceFundingHistory(times.map((time) => row(time)), "BTCUSDT"));
    expect(points[2]?.value).toBeUndefined();
  });

  it("la transition 8h → 4h reste inconnue jusqu'à deux nouveaux intervalles, sans futur", () => {
    const times = [0, 8, 16, 20, 24, 28].map((h) => h * H);
    const rows = times.map((time) => row(time, "0.00008"));
    expect(normaliserFundingHoraire(parseBinanceFundingHistory(rows.slice(0, 4), "BTCUSDT")).map((p) => p.value))
      .toEqual([undefined, undefined, 0.00001, undefined]);
    expect(normaliserFundingHoraire(parseBinanceFundingHistory(rows, "BTCUSDT")).map((p) => p.value))
      .toEqual([undefined, undefined, 0.00001, undefined, 0.00002, 0.00002]);
  });

  it("une lacune, un taux invalide, Special et un doublon contradictoire coupent la cadence", () => {
    const times = [0, 8, 16, 32, 40, 48, 56, 64, 72].map((h) => h * H);
    const rows = times.map((time) => row(time));
    rows[6] = row(times[6]!, "invalide");
    rows[7] = row(times[7]!, "0.00008", "Special");
    const avecDoublon = [...rows, row(times[8]!, "0.00009")];
    const points = normaliserFundingHoraire(parseBinanceFundingHistory(avecDoublon, "BTCUSDT"));
    expect(points.map((p) => p.value)).toEqual([
      undefined, undefined, 0.00001, undefined, undefined, 0.00001,
      undefined, undefined, undefined,
    ]);
  });

  it("un rateType absent ou inconnu ne crée pas de taux Regular implicite", () => {
    const parsed = parseBinanceFundingHistory([
      { symbol: "BTCUSDT", fundingTime: 0, fundingRate: "0.00008" },
      row(8 * H, "0.00008", "Other"), row(16 * H),
    ], "BTCUSDT");
    expect(parsed.map((p) => p.rate)).toEqual([undefined, undefined, 0.00008]);
    expect(normaliserFundingHoraire(parsed).every((p) => p.value === undefined)).toBe(true);
  });

  it("refuse toute page dont un timestamp est invalide ou l'ordre contredit l'API", () => {
    expect(() => parseBinanceFundingHistory([row(0), { ...row(H), fundingTime: "oops" }], "BTCUSDT")).toThrow();
    expect(() => parseBinanceFundingHistory([row(H), row(0)], "BTCUSDT")).toThrow();
    expect(() => parseBinanceFundingHistory([row(0), { ...row(H), symbol: "ETHUSDT" }], "BTCUSDT")).toThrow();
  });

  it("pagine en ordre croissant sur 90 jours au plus, sans double lecture de la borne inclusive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100 * 24 * H);
    const first = Array.from({ length: 1000 }, (_, i) => row(10 * 24 * H + i * H));
    const second = [row(10 * 24 * H + 1000 * H)];
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify(fetcher.mock.calls.length === 1 ? first : second)));
    const points = await fetchBinanceFundingHourly("BTCUSDT", 0, fetcher as typeof fetch);
    expect(points).toHaveLength(1001);
    expect(points[2]?.value).toBe(0.00008);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const urls = fetcher.mock.calls.map(([url]) => new URL(url, "https://axiom.test"));
    expect(urls[0]?.pathname).toBe("/extapi/fapi.binance.com/fapi/v1/fundingRate");
    expect(urls[0]?.searchParams.get("startTime")).toBe(String(10 * 24 * H));
    expect(urls[0]?.searchParams.get("endTime")).toBe(String(100 * 24 * H));
    expect(urls[0]?.searchParams.get("limit")).toBe("1000");
    expect(urls[1]?.searchParams.get("startTime")).toBe(String(10 * 24 * H + 999 * H + 1));
  });

  it("échoue fermé si une page manque et borne le temps de chaque requête", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100 * 24 * H);
    const first = Array.from({ length: 1000 }, (_, i) => row(10 * 24 * H + i * H));
    const broken = vi.fn(async () => new Response(JSON.stringify(broken.mock.calls.length === 1 ? first : { error: true })));
    expect(await fetchBinanceFundingHourly("BTCUSDT", 0, broken as typeof fetch)).toEqual([]);

    const pending = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Timeout", "AbortError")));
    }));
    const result = fetchBinanceFundingHourly("BTCUSDT", 0, pending as typeof fetch);
    await vi.advanceTimersByTimeAsync(8_100);
    expect(await result).toEqual([]);
    expect(pending).toHaveBeenCalledTimes(1);
  });

  it("ne restitue aucune page partielle si une page suivante a un timestamp illisible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100 * 24 * H);
    const first = Array.from({ length: 1000 }, (_, i) => row(10 * 24 * H + i * H));
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fetcher.mock.calls.length === 1
      ? first
      : [{ ...row(10 * 24 * H + 1000 * H), fundingTime: "illisible" }])));
    expect(await fetchBinanceFundingHourly("BTCUSDT", 0, fetcher as typeof fetch)).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("borne aussi la lecture du corps JSON, pas seulement les en-têtes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100 * 24 * H);
    const bodyBlocked = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: () => new Promise<unknown>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Timeout", "AbortError")));
      }),
    }) as Response);
    let outcome: unknown = "pending";
    void fetchBinanceFundingHourly("BTCUSDT", 0, bodyBlocked as typeof fetch).then((value) => { outcome = value; });
    await vi.advanceTimersByTimeAsync(8_100);
    expect(outcome).toEqual([]);
  });
});
