/**
 * Funding cross-exchange — logique PURE : annualisation (bases d'intervalle
 * différentes rendues comparables), parsers par venue, calcul du spread.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annualiserFunding,
  etatMatrice,
  fetchFundingMatrix,
  fundingSpreadApr,
  parseBinanceFunding,
  parseBinanceFundingIntervalH,
  parseBybitFunding,
  parseBybitFundingIntervalH,
  parseHyperliquidFunding,
  parseOkxFunding,
  parseOkxFundingIntervalH,
  type FundingVenue,
} from "./fundingCrossExchange";

describe("annualiserFunding", () => {
  it("rend comparables un taux 8 h et un taux 1 h (même APR)", () => {
    // 0.0001/8h et 0.0000125/1h correspondent au même APR (10,95 %).
    expect(annualiserFunding(0.0001, 8)).toBeCloseTo(10.95, 6);
    expect(annualiserFunding(0.0000125, 1)).toBeCloseTo(10.95, 6);
  });

  it("renvoie NaN pour un intervalle nul/invalide", () => {
    expect(annualiserFunding(0.0001, 0)).toBeNaN();
  });
});

describe("parsers de funding", () => {
  it("Binance : lastFundingRate", () => {
    expect(parseBinanceFunding({ symbol: "BTCUSDT", lastFundingRate: "0.00010000" })).toBe(0.0001);
    expect(parseBinanceFunding({})).toBeNull();
  });
  it("Bybit : result.list[0].fundingRate", () => {
    expect(parseBybitFunding({ result: { list: [{ fundingRate: "0.0001" }] } })).toBe(0.0001);
    expect(parseBybitFunding({ result: { list: [] } })).toBeNull();
  });
  it("OKX : data[0].fundingRate", () => {
    expect(parseOkxFunding({ code: "0", data: [{ fundingRate: "0.0001" }] })).toBe(0.0001);
    expect(parseOkxFunding({ data: [] })).toBeNull();
  });
  it("Hyperliquid : funding du coin par index dans universe", () => {
    const json = [
      { universe: [{ name: "ETH" }, { name: "BTC" }] },
      [{ funding: "0.00001" }, { funding: "0.0000125" }],
    ];
    expect(parseHyperliquidFunding(json, "BTC")).toBe(0.0000125);
    expect(parseHyperliquidFunding(json, "SOL")).toBeNull(); // coin absent
    expect(parseHyperliquidFunding([{ universe: [] }], "BTC")).toBeNull(); // tuple incomplet
  });
});

describe("parsers d'intervalle de funding (heures)", () => {
  it("OKX : nextFundingTime − fundingTime de la même réponse funding-rate", () => {
    const h4 = { data: [{ fundingRate: "0.0001", fundingTime: "1700000000000", nextFundingTime: "1700014400000" }] };
    expect(parseOkxFundingIntervalH(h4)).toBe(4); // 4 h exactes
    expect(parseOkxFundingIntervalH({ data: [{ fundingRate: "0.0001" }] })).toBeNull(); // champs absents
    expect(parseOkxFundingIntervalH({ data: [{ fundingTime: "2", nextFundingTime: "1" }] })).toBeNull(); // incohérent
  });

  it("Bybit : fundingInterval (minutes) d'instruments-info converti en heures", () => {
    expect(parseBybitFundingIntervalH({ result: { list: [{ fundingInterval: 240 }] } })).toBe(4);
    expect(parseBybitFundingIntervalH({ result: { list: [{ fundingInterval: 480 }] } })).toBe(8);
    expect(parseBybitFundingIntervalH({ result: { list: [] } })).toBeNull();
  });

  it("Binance : fundingIntervalHours de fundingInfo (liste des perps HORS 8 h ; absent = null → défaut 8)", () => {
    const info = [{ symbol: "PUMPUSDT", fundingIntervalHours: 4 }];
    expect(parseBinanceFundingIntervalH(info, "PUMPUSDT")).toBe(4);
    expect(parseBinanceFundingIntervalH(info, "BTCUSDT")).toBeNull(); // absent = cadence standard 8 h
    expect(parseBinanceFundingIntervalH({}, "BTCUSDT")).toBeNull(); // réponse inattendue
  });
});

describe("fundingSpreadApr", () => {
  it("écart entre APR max et min", () => {
    const venues: FundingVenue[] = [
      { exchange: "a", label: "A", ratePct: 0, intervalHours: 8, apr: 12 },
      { exchange: "b", label: "B", ratePct: 0, intervalHours: 1, apr: -3 },
    ];
    expect(fundingSpreadApr(venues)).toBe(15);
  });
  it("null si moins de 2 venues", () => {
    expect(fundingSpreadApr([])).toBeNull();
  });
});

// ─────────────────────────── fetchFundingMatrix : panne ≠ absence de perp ───────────────────────────

/**
 * Réponses par défaut d'un symbole NON LISTÉ en perp USDT (relevées par curl le
 * 2026-09-02) : Binance répond HTTP 400 « Invalid symbol », Bybit/OKX répondent 200
 * avec une liste vide, Hyperliquid ne connaît pas le coin. Aucune n'est une PANNE.
 */
function reponsesSymboleInconnu(url: string): Response {
  if (url.includes("premiumIndex")) {
    return new Response(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), { status: 400 });
  }
  if (url.includes("bybit")) {
    return new Response(JSON.stringify({ retCode: 10001, retMsg: "params error", result: {} }));
  }
  if (url.includes("okx")) {
    return new Response(JSON.stringify({ code: "51001", data: [] }));
  }
  return new Response(JSON.stringify([{ universe: [{ name: "BTC" }] }, [{ funding: "0.0000125" }]]));
}

describe("fetchFundingMatrix — échecs remontés à l'appelant", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("quatre venues injoignables → 0 venue mais 4 échecs (panne réseau, PAS « non listé »)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))));
    const res = await fetchFundingMatrix("BTCUSDT");
    expect(res.venues).toEqual([]);
    expect(res.echecs).toBe(4);
  });

  it("symbole non listé en perp → 0 venue et 0 échec (Binance 400 n'est pas une panne)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => reponsesSymboleInconnu(url)));
    const res = await fetchFundingMatrix("ZZZZUSDT");
    expect(res.venues).toEqual([]);
    expect(res.echecs).toBe(0);
  });

  it("une venue répond, trois tombent → matrice partielle + 3 échecs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("okx")) {
          return new Response(
            JSON.stringify({ data: [{ fundingRate: "0.0001", fundingTime: "0", nextFundingTime: "28800000" }] }),
          );
        }
        throw new Error("network down");
      }),
    );
    const res = await fetchFundingMatrix("BTCUSDT");
    expect(res.venues.map((v) => v.exchange)).toEqual(["okx"]);
    expect(res.echecs).toBe(3);
  });
});

describe("etatMatrice", () => {
  const v: FundingVenue = { exchange: "okx", label: "OKX", ratePct: 0.01, intervalHours: 8, apr: 10.95 };

  it("aucune venue AVEC échecs → venues injoignables (on conserve la matrice précédente)", () => {
    expect(etatMatrice([], 4)).toBe("injoignable");
    expect(etatMatrice([], 1)).toBe("injoignable");
  });

  it("aucune venue SANS échec → symbole non listé en perp", () => {
    expect(etatMatrice([], 0)).toBe("non-liste");
  });

  it("au moins une venue → matrice exploitable, même partielle", () => {
    expect(etatMatrice([v], 3)).toBe("ok");
  });
});
