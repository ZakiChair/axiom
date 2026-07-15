import { describe, expect, it } from "vitest";
import { annualiserBasis, computeQuarterlyBasisPoints, parseCoinMContrats } from "./binanceDapi";

/** 182,5 jours ≈ demi-année → facteur d'annualisation 2. */
const DEMI_AN_MS = 182.5 * 24 * 60 * 60 * 1000;

describe("annualiserBasis", () => {
  it("annualise un contango de +10 % sur une demi-année en +20 %/an", () => {
    const now = 0;
    const basis = annualiserBasis(110, 100, now, now + DEMI_AN_MS);
    expect(basis).toBeCloseTo(0.2, 6);
  });

  it("renvoie une valeur négative en backwardation (future < spot)", () => {
    const now = 0;
    const basis = annualiserBasis(95, 100, now, now + DEMI_AN_MS);
    expect(basis).toBeCloseTo(-0.1, 6); // -5 % sur demi-année → -10 %/an
  });

  it("renvoie NaN si l'échéance est passée (temps restant ≤ 0)", () => {
    expect(Number.isNaN(annualiserBasis(110, 100, 1000, 500))).toBe(true);
    expect(Number.isNaN(annualiserBasis(110, 100, 1000, 1000))).toBe(true);
  });

  it("renvoie NaN pour un spot nul/négatif ou des prix invalides", () => {
    expect(Number.isNaN(annualiserBasis(110, 0, 0, DEMI_AN_MS))).toBe(true);
    expect(Number.isNaN(annualiserBasis(110, -5, 0, DEMI_AN_MS))).toBe(true);
    expect(Number.isNaN(annualiserBasis(NaN, 100, 0, DEMI_AN_MS))).toBe(true);
  });
});

describe("computeQuarterlyBasisPoints", () => {
  const delivery = DEMI_AN_MS; // échéance à t = demi-année

  it("joint future×index sur les timestamps communs et annualise en % p.a.", () => {
    // À t=0, échéance dans une demi-année : contango +10 % → +20 %/an → value = 20.
    const future = new Map([[0, 110], [3_600_000, 105]]);
    const index = new Map([[0, 100], [3_600_000, 100]]);
    const pts = computeQuarterlyBasisPoints(future, index, delivery);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ time: 0, value: expect.closeTo(20, 6) });
    expect(pts[1]?.value).toBeGreaterThan(0); // toujours contango
  });

  it("écarte les timestamps sans contrepartie d'index et les basis non finis", () => {
    const future = new Map([[0, 110], [999, 110]]); // 999 sans index
    const index = new Map([[0, 0]]); // spot 0 à t=0 → basis NaN écarté
    expect(computeQuarterlyBasisPoints(future, index, delivery)).toEqual([]);
  });

  it("trie par temps croissant", () => {
    const future = new Map([[3_600_000, 105], [0, 110]]);
    const index = new Map([[0, 100], [3_600_000, 100]]);
    const pts = computeQuarterlyBasisPoints(future, index, delivery);
    expect(pts.map((p) => p.time)).toEqual([0, 3_600_000]);
  });
});

describe("parseCoinMContrats", () => {
  const info = {
    symbols: [
      { symbol: "BTCUSD_PERP", pair: "BTCUSD", contractType: "PERPETUAL", deliveryDate: 4133404800000, contractStatus: "TRADING" },
      { symbol: "BTCUSD_260925", pair: "BTCUSD", contractType: "CURRENT_QUARTER", deliveryDate: 1790323200000, contractStatus: "TRADING" },
      { symbol: "BTCUSD_261225", pair: "BTCUSD", contractType: "NEXT_QUARTER", deliveryDate: 1798185600000, contractStatus: "TRADING" },
      { symbol: "ETHUSD_260925", pair: "ETHUSD", contractType: "CURRENT_QUARTER", deliveryDate: 1790323200000, contractStatus: "TRADING" },
      { symbol: "BTCUSD_250101", pair: "BTCUSD", contractType: "CURRENT_QUARTER", deliveryDate: 1735689600000, contractStatus: "PENDING_TRADING" },
    ],
  };

  it("ne retient que les contrats trimestriels TRADING de la paire visée", () => {
    const contrats = parseCoinMContrats(info, "BTCUSD");
    expect(contrats.map((c) => c.symbol)).toEqual(["BTCUSD_260925", "BTCUSD_261225"]);
  });

  it("écarte le perpétuel et les autres paires", () => {
    const eth = parseCoinMContrats(info, "ETHUSD");
    expect(eth).toEqual([{ symbol: "ETHUSD_260925", deliveryDate: 1790323200000 }]);
  });

  it("gère une réponse sans symboles", () => {
    expect(parseCoinMContrats({}, "BTCUSD")).toEqual([]);
  });
});
