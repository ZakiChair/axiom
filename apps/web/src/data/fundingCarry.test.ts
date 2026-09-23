import { describe, expect, it } from "vitest";
import { calculerCarryNet, type EntreeCarry } from "./fundingCarry";

const entree: EntreeCarry = {
  symbol: "BTCUSDT", base: "BTC", quote: "USDT", reglement: "USDT", venue: "binance", type: "linear",
  quantite: 1, spotEntree: 100, perpEntree: 101, basisSortie: 0.5, spotSortie: 110,
  frais: { spotEntree: 0.001, perpEntree: 0.0005, spotSortie: 0.001, perpSortie: 0.0005 },
  tauxFunding: 0.0001, notionnelReglement: 100, cadenceHeures: 8,
  slippageSortieSpotBps: 0, slippageSortiePerpBps: 0,
  entreeTs: Date.UTC(2026, 0, 1), prochainReglementTs: Date.UTC(2026, 0, 1, 8), horizonJours: 1, executionNonIncluse: 0.04, financement: 0.02,
  provenance: "hypothese",
};
describe("carry net", () => {
  it("décompose quatre frais, funding et basis finale non nulle", () => {
    const r = calculerCarryNet(entree);
    expect(r.statut).toBe("ok");
    if (r.statut !== "ok") return;
    expect(r.prix).toBeCloseTo(0.5, 10);
    expect(r.frais).toBeCloseTo(0.31575, 10);
    expect(r.funding).toBeCloseTo(0.03, 10);
    expect(r.net).toBeCloseTo(0.15425, 10);
    expect(r.fundingNul).toBeCloseTo(0.12425, 10);
    expect(r.fundingInverse).toBeCloseTo(0.09425, 10);
    expect(calculerCarryNet({ ...entree, basisSortie: 2 }).statut).toBe("ok");
  });
  it("refuse frais absents, cadence inconnue et identité non linéaire", () => {
    expect(calculerCarryNet({ ...entree, frais: { ...entree.frais, perpSortie: NaN } }).statut).toBe("indisponible");
    expect(calculerCarryNet({ ...entree, cadenceHeures: 0 }).statut).toBe("indisponible");
    expect(calculerCarryNet({ ...entree, type: "inverse" }).statut).toBe("indisponible");
  });
  it("déduit les deux slippages de sortie hypothétiques sans double compter les VWAP d'entrée", () => {
    const r = calculerCarryNet({ ...entree, slippageSortieSpotBps: 10, slippageSortiePerpBps: 10 });
    expect(r.statut).toBe("ok");
    if (r.statut === "ok") {
      expect(r.slippageSortie).toBeCloseTo(0.2205, 8);
      expect(r.prix).toBeCloseTo(0.2795, 8);
      expect(r.spotSortie).toBeCloseTo(109.89, 8);
      expect(r.perpSortie).toBeCloseTo(110.6105, 8);
    }
  });
});
