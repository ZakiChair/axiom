import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdapter } from "./adapters";
import { collecterMultifactoriel, cotationScen } from "./scenMultifactorLoader";

vi.mock("./adapters", () => ({ getAdapter: vi.fn() }));
const jour = (s: string) => Date.parse(`${s}T00:00:00Z`);
const candle = (date: string, close: number) => ({ time: jour(date), close });
afterEach(() => vi.restoreAllMocks());
function reponses(series: Record<string, Array<{ time: number; close: number }>>) {
  vi.mocked(getAdapter).mockImplementation(() => ({ fetchKlines: async (symbol: string) => series[symbol] ?? [] } as unknown as ReturnType<typeof getAdapter>));
}
const position = (symbole: string, source: "binance" | "twelvedata" = "binance", taille = 1) => ({ symbole, source, direction: "long" as const, taille, prixEntree: 100 });

describe("collecte SCEN par identité", () => {
  it("résout la vraie quote du forex et refuse un ticker tradfi libre sans devise prouvée", () => {
    expect(cotationScen("USD/JPY", "twelvedata")).toBe("JPY");
    expect(cotationScen("EUR/JPY", "twelvedata")).toBe("JPY");
    expect(cotationScen("SPY", "twelvedata")).toBe("USD");
    expect(cotationScen("XYZ", "twelvedata")).toBeNull();
    expect(cotationScen("BTC-PERP", "hyperliquid")).toBeNull();
  });
  it("valorise USD/JPY en JPY et ne publie pas sa taille comme des USD", async () => {
    vi.spyOn(Date, "now").mockReturnValue(jour("2026-01-10"));
    reponses({ "USD/JPY": [candle("2026-01-08", 160)], BTCUSDT: [candle("2026-01-08", 100)] });
    const r = await collecterMultifactoriel([position("USD/JPY", "twelvedata", 10_000), position("XYZ", "twelvedata")], ["btc"], 90);
    expect(r.lignes[0]?.devise).toBe("JPY");
    expect(r.lignes[0]?.valeurSignee).toBe(1_600_000);
    expect(r.lignes[1]?.valeurSignee).toBeNull();
    expect(r.lignes[1]?.estimation.raison).toMatch(/devise/);
  });
  it("conserve le point NaN comme barrière et ne forme pas 01→03", async () => {
    vi.spyOn(Date, "now").mockReturnValue(jour("2026-01-10"));
    reponses({ SOLUSDT: [candle("2026-01-01", 100), candle("2026-01-02", NaN), candle("2026-01-03", 121)], BTCUSDT: [candle("2026-01-01", 100), candle("2026-01-02", 110), candle("2026-01-03", 121)] });
    const r = await collecterMultifactoriel([position("SOLUSDT")], ["btc"], 90);
    expect(r.lignes[0]?.estimation.n).toBe(0);
    expect(r.lignes[0]?.estimation.excluesInvalides).toBe(2);
    expect(r.lignes[0]?.valeurSignee).toBe(121);
  });
  it("écarte la bougie future du prix de valorisation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(jour("2026-01-10"));
    reponses({ SOLUSDT: [candle("2026-01-08", 100), candle("2026-01-11", 999)], BTCUSDT: [candle("2026-01-08", 100)] });
    const r = await collecterMultifactoriel([position("SOLUSDT")], ["btc"], 90);
    expect(r.lignes[0]?.datePrix).toBe("2026-01-08");
    expect(r.lignes[0]?.valeurSignee).toBe(100);
  });
});
