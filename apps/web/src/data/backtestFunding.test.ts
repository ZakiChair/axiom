import { describe, expect, it } from "vitest";
import { fetchReglementsFundingBinance, parseKlinesPerpBinance, parseReglementsFundingBinance } from "./backtestFunding";

describe("funding historique Binance pour backtest", () => {
  it("conserve le taux en fraction et le mark associé au règlement", () => {
    expect(parseReglementsFundingBinance([
      { fundingTime: 8, fundingRate: "0.0001", markPrice: "105.25" },
      { fundingTime: 16, fundingRate: "-0.0002", markPrice: "106" },
    ])).toEqual([
      { temps: 8, taux: 0.0001, mark: 105.25, tempsMark: 8 },
      { temps: 16, taux: -0.0002, mark: 106, tempsMark: 16 },
    ]);
  });

  it("refuse une ligne sans mark plutôt que d'inventer un proxy", () => {
    expect(() => parseReglementsFundingBinance([{ fundingTime: 8, fundingRate: "0.0001" }]))
      .toThrow("markPrice");
  });

  it("télécharge une fenêtre bornée et expose sa couverture exacte", async () => {
    let appelee = 0;
    let urlAppelee = "";
    const fetcher: typeof fetch = async (input) => {
      appelee++;
      urlAppelee = String(input);
      return new Response(JSON.stringify([
        { fundingTime: 8, fundingRate: "0.0001", markPrice: "100" },
        { fundingTime: 16, fundingRate: "0.0002", markPrice: "101" },
      ]), { status: 200 });
    };
    const resultat = await fetchReglementsFundingBinance("BTCUSDT", 4, 20, fetcher);
    expect(appelee).toBe(1);
    expect(urlAppelee).toContain("symbol=BTCUSDT");
    expect(urlAppelee).toContain("startTime=4");
    expect(urlAppelee).toContain("endTime=20");
    expect(resultat).toEqual({
      reglements: [
        { temps: 8, taux: 0.0001, mark: 100, tempsMark: 8 },
        { temps: 16, taux: 0.0002, mark: 101, tempsMark: 16 },
      ],
      couverture: { debutMs: 8, finMs: 16, nombre: 2, source: "Binance USDⓈ-M fundingRate" },
    });
  });
});

describe("bougies perp Binance pour backtest", () => {
  it("ne conserve que les bougies dont le close réel est dans la borne haute exclusive", () => {
    const brut = [
      [0, "100", "110", "90", "105", "12", 59, "1260", 5, "7", "735", "0"],
      [60, "105", "115", "100", "110", "10", 119, "1100", 4, "6", "660", "0"],
    ];
    expect(parseKlinesPerpBinance(brut, 0, 60)).toEqual([{
      time: 0, open: 100, high: 110, low: 90, close: 105, volume: 12,
      quoteVolume: 1260, trades: 5, buyVolume: 7, sellVolume: 5, closed: true,
    }]);
  });
});
