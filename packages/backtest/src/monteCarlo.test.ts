/**
 * @axiom/backtest — monteCarlo.test.ts
 *
 * Tests déterministes du rééchantillonnage Monte-Carlo des PnL de trades.
 * Toute la logique testée s'appuie sur un RNG INJECTÉ (mulberry32 seedable) : jamais
 * de Math.random, donc chaque assertion est reproductible.
 *
 * Convention maxDrawdown : fraction du CAPITAL INITIAL (et non du pic), mesurée sur le
 * chemin d'equity (capital + PnL cumulés). Elle diverge volontairement du drawdownPct
 * de l'engine (qui, lui, est rapporté au pic) — décision du contrôleur, cf. rapport.
 */
import { describe, expect, it } from "vitest";
import { monteCarloTrades, mulberry32 } from "./monteCarlo";

describe("mulberry32", () => {
  it("est déterministe : même seed → même séquence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produit des valeurs dans [0, 1)", () => {
    const r = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("des seeds différents donnent des séquences différentes", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toEqual(b());
  });
});

describe("monteCarloTrades — seuil de validité", () => {
  it("renvoie null si moins de 10 trades (9 → null)", () => {
    const pnls = Array(9).fill(10);
    expect(monteCarloTrades(pnls, 100, mulberry32(42), 1000)).toBeNull();
  });

  it("renvoie un résultat non-null dès 10 trades", () => {
    const pnls = Array(10).fill(10);
    expect(monteCarloTrades(pnls, 100, mulberry32(42), 1000)).not.toBeNull();
  });
});

describe("monteCarloTrades — clamp de nChemins (RNG compteur)", () => {
  // On compte les tirages rng : exactement 1 tirage par trade rééchantillonné,
  // donc nChemins effectif × pnls.length tirages au total.
  it("borne nChemins à 2000 par le haut (5000 → 2000)", () => {
    const pnls = Array(10).fill(1);
    let calls = 0;
    const base = mulberry32(42);
    const rng = () => {
      calls++;
      return base();
    };
    monteCarloTrades(pnls, 5000, rng, 1000);
    expect(calls).toBe(2000 * pnls.length);
  });

  it("borne nChemins à 1 par le bas (0 → 1)", () => {
    const pnls = Array(10).fill(1);
    let calls = 0;
    const base = mulberry32(42);
    const rng = () => {
      calls++;
      return base();
    };
    monteCarloTrades(pnls, 0, rng, 1000);
    expect(calls).toBe(1 * pnls.length);
  });
});

describe("monteCarloTrades — déterminisme", () => {
  it("même seed → résultat identique", () => {
    // Fixture mixte (gagnants + perdants) : le tirage compte réellement.
    const pnls = [50, -30, 20, -10, 40, -25, 15, -5, 35, -20, 10, -15];
    const r1 = monteCarloTrades(pnls, 500, mulberry32(42), 1000);
    const r2 = monteCarloTrades(pnls, 500, mulberry32(42), 1000);
    expect(r1).toEqual(r2);
  });

  it("snapshot de valeurs à seed 42 (fige la convention de percentile)", () => {
    const pnls = [50, -30, 20, -10, 40, -25, 15, -5, 35, -20, 10, -15];
    const r = monteCarloTrades(pnls, 500, mulberry32(42), 1000)!;
    expect(r.equityFinale.p50).toBe(1065);
    expect(r.equityFinale.p5).toBe(930);
    expect(r.maxDrawdown.p95).toBe(0.125);
    expect(r.probRuine).toBe(0);
    expect(r.cheminsPercentiles.p50[0]).toBe(1010);
  });
});

describe("monteCarloTrades — PnL tous identiques (cône plat)", () => {
  // Tous les PnL égaux ⇒ tout rééchantillonnage redonne la même suite ⇒ tous les
  // chemins sont identiques ⇒ p5 = p50 = p95 à chaque pas (cône dégénéré en ligne).
  // On choisit une valeur NÉGATIVE pour exercer l'arithmétique du drawdown et de la ruine.
  const pnls = Array(10).fill(-200); // cap=1000, 10 pertes de 200 → final = -1000
  const cap = 1000;
  const res = monteCarloTrades(pnls, 200, mulberry32(7), cap)!;

  it("cône plat : p5 = p50 = p95 à chaque pas", () => {
    for (let i = 0; i < pnls.length; i++) {
      expect(res.cheminsPercentiles.p5[i]).toBe(res.cheminsPercentiles.p50[i]);
      expect(res.cheminsPercentiles.p50[i]).toBe(res.cheminsPercentiles.p95[i]);
    }
    expect(res.equityFinale.p5).toBe(res.equityFinale.p95);
  });

  it("equity finale = capital + somme des PnL", () => {
    expect(res.equityFinale.p50).toBe(-1000); // 1000 + 10 × (-200)
  });

  it("maxDrawdown = 2.0 (peut dépasser 1.0 sous la convention fraction-du-capital)", () => {
    // Pic initialisé au capital (1000) ; creux final = -1000 ; dd = (1000 - (-1000))/1000 = 2.0
    expect(res.maxDrawdown.p50).toBeCloseTo(2.0, 10);
    expect(res.maxDrawdown.p95).toBeCloseTo(2.0, 10);
  });

  it("probRuine = 1 (tous les chemins finissent < 0)", () => {
    expect(res.probRuine).toBe(1);
  });
});

describe("monteCarloTrades — PnL tous positifs", () => {
  it("probRuine = 0 (aucun chemin ne finit < 0)", () => {
    const pnls = Array(15).fill(50);
    const res = monteCarloTrades(pnls, 300, mulberry32(9), 1000)!;
    expect(res.probRuine).toBe(0);
  });

  it("maxDrawdown = 0 (equity monotone croissante)", () => {
    const pnls = Array(15).fill(50);
    const res = monteCarloTrades(pnls, 300, mulberry32(9), 1000)!;
    expect(res.maxDrawdown.p50).toBe(0);
    expect(res.maxDrawdown.p95).toBe(0);
  });
});

describe("monteCarloTrades — mélange gagnants/perdants", () => {
  it("p5 < p50 < p95 sur l'equity finale", () => {
    // Fixture à forte dispersion : gros gagnants et gros perdants, donc les tirages
    // extrêmes s'écartent nettement de la médiane.
    const pnls = [200, -180, 150, -160, 220, -140, 170, -200, 190, -150, 210, -170];
    const res = monteCarloTrades(pnls, 1000, mulberry32(42), 1000)!;
    expect(res.equityFinale.p5).toBeLessThan(res.equityFinale.p50);
    expect(res.equityFinale.p50).toBeLessThan(res.equityFinale.p95);
    expect(res.cheminsPercentiles.p5[pnls.length - 1]!).toBeLessThan(
      res.cheminsPercentiles.p95[pnls.length - 1]!,
    );
  });
});

describe("monteCarloTrades — forme du résultat", () => {
  it("les chemins de percentiles ont la longueur = nb de trades", () => {
    const pnls = Array(12).fill(0).map((_, i) => (i % 2 === 0 ? 30 : -20));
    const res = monteCarloTrades(pnls, 100, mulberry32(42), 1000)!;
    expect(res.cheminsPercentiles.p5).toHaveLength(pnls.length);
    expect(res.cheminsPercentiles.p50).toHaveLength(pnls.length);
    expect(res.cheminsPercentiles.p95).toHaveLength(pnls.length);
  });
});
