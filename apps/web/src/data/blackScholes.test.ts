import { describe, expect, it } from "vitest";
import { bsGreeks, normCdf, normPdf } from "./blackScholes";

describe("normPdf", () => {
  it("vaut 1/√(2π) au sommet (x=0)", () => {
    expect(normPdf(0)).toBeCloseTo(0.3989422804, 9);
  });

  it("est symétrique et décroît (φ(1)=φ(−1))", () => {
    expect(normPdf(1)).toBeCloseTo(0.2419707245, 9);
    expect(normPdf(-1)).toBeCloseTo(normPdf(1), 12);
    expect(normPdf(2)).toBeLessThan(normPdf(1));
  });
});

describe("normCdf", () => {
  it("N(0) = 0,5 (à la précision de l'approximation, ~7,5·10⁻⁸)", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 8);
  });

  it("N(1,96) ≈ 0,975 et N(−1,96) ≈ 0,025 (repères connus)", () => {
    expect(normCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 4);
  });

  it("N(1) ≈ 0,8413 (valeur de table)", () => {
    expect(normCdf(1)).toBeCloseTo(0.8413447, 5);
  });

  it("respecte la symétrie N(−x) = 1 − N(x)", () => {
    for (const x of [0.3, 1.1, 2.5, 3.2]) {
      expect(normCdf(-x)).toBeCloseTo(1 - normCdf(x), 7);
    }
  });

  it("tend vers 0 et 1 dans les queues", () => {
    expect(normCdf(-6)).toBeLessThan(1e-6);
    expect(normCdf(6)).toBeGreaterThan(1 - 1e-6);
  });

  it("renvoie NaN pour un x non fini", () => {
    expect(Number.isNaN(normCdf(Number.NaN))).toBe(true);
    expect(Number.isNaN(normCdf(Number.POSITIVE_INFINITY))).toBe(true);
  });
});

describe("bsGreeks", () => {
  it("à la monnaie (S=K) : delta_call légèrement > 0,5 et gamma ~maximal, positif", () => {
    // S=K=100, T=0,25 an, σ=0,5, r=0.
    // d1 = (0 + 0,125·0,25)/(0,5·0,5) = 0,03125/0,25 = 0,125.
    const g = bsGreeks(100, 100, 0.25, 0.5, 0);
    expect(g.d1).toBeCloseTo(0.125, 9);
    expect(g.d2).toBeCloseTo(0.125 - 0.25, 9);
    expect(g.deltaCall).toBeCloseTo(0.5497382, 5);
    expect(g.deltaCall).toBeGreaterThan(0.5); // au-dessus de 0,5 (terme de dérive)
    expect(g.gamma).toBeGreaterThan(0);
    // gamma = φ(0,125)/(100·0,5·0,5) = 0,395839/25.
    expect(g.gamma).toBeCloseTo(0.01583357, 6);
  });

  it("parité delta : delta_put = delta_call − 1 exactement", () => {
    const g = bsGreeks(105, 100, 0.5, 0.6, 0.02);
    expect(g.deltaPut).toBeCloseTo(g.deltaCall - 1, 12);
    expect(g.deltaPut).toBeLessThan(0); // put delta négatif
  });

  it("gamma est identique pour calls et puts (une seule valeur renvoyée, positive)", () => {
    const g = bsGreeks(100, 120, 0.3, 0.7);
    expect(g.gamma).toBeGreaterThan(0);
  });

  it("call très ITM → delta_call → 1 ; put associé → 0", () => {
    // S bien au-dessus de K, faible σ, T court.
    const g = bsGreeks(200, 100, 0.1, 0.3);
    expect(g.deltaCall).toBeGreaterThan(0.999);
    expect(g.deltaPut).toBeGreaterThan(-0.001); // ≈ 0
    expect(g.deltaPut).toBeLessThanOrEqual(0);
  });

  it("call très OTM → delta_call → 0 ; put associé → −1", () => {
    const g = bsGreeks(50, 100, 0.1, 0.3);
    expect(g.deltaCall).toBeLessThan(0.001);
    expect(g.deltaPut).toBeLessThan(-0.999);
  });

  it("le taux sans risque r décale d1 vers le haut", () => {
    const sans = bsGreeks(100, 100, 1, 0.4, 0);
    const avec = bsGreeks(100, 100, 1, 0.4, 0.05);
    expect(avec.d1).toBeGreaterThan(sans.d1);
    expect(avec.deltaCall).toBeGreaterThan(sans.deltaCall);
  });

  it("renvoie des greeks NaN pour des inputs invalides (dégradation gracieuse)", () => {
    for (const g of [
      bsGreeks(0, 100, 0.25, 0.5), // S ≤ 0
      bsGreeks(100, 0, 0.25, 0.5), // K ≤ 0
      bsGreeks(100, 100, 0, 0.5), // T ≤ 0 (échéance passée)
      bsGreeks(100, 100, -1, 0.5), // T < 0
      bsGreeks(100, 100, 0.25, 0), // σ ≤ 0
      bsGreeks(100, 100, 0.25, Number.NaN), // σ non fini
    ]) {
      expect(Number.isNaN(g.deltaCall)).toBe(true);
      expect(Number.isNaN(g.gamma)).toBe(true);
    }
  });
});
