/**
 * Tests de la logique PURE de risque du portefeuille (data/portRisque.ts).
 * Chaque valeur attendue est calculée À LA MAIN et justifiée en commentaire (pas d'oracle
 * circulaire). Fixture centrale « 2 actifs » : A long, B short parfaitement corrélé (B = 0,5·A),
 * qui verrouille à la fois le rendement pondéré signé, l'identité Σctr = 1 et la contribution
 * NÉGATIVE d'un hedge. Covariances POPULATION partout ; VaR = −quantile (perte positive).
 */
import { describe, expect, it } from "vitest";
import {
  betasVsRef,
  contributionsRisque,
  equityHistorique,
  quantile,
  risquePortefeuille,
  serieRendementsPortefeuille,
  stressGrid,
  type PoidsPosition,
  type SerieActif,
} from "./portRisque";

// ── Fixture 2 actifs main-calculée ──────────────────────────────────────────
// rA sur t=1..4 ; rB = 0,5·rA (corrélation parfaite). Poids : A +100 (long), B −40 (short).
// Σ|w| = 140 ⇒ w̃_A = 5/7, w̃_B = −2/7. r_p = (5/7)rA + (−2/7)(0,5rA) = (4/7)rA.
const rA = [0.02, -0.01, 0.03, 0.01];
const serieA: SerieActif = {
  symbol: "A",
  rendements: rA.map((r, i) => ({ t: i + 1, r })),
};
const serieB: SerieActif = {
  symbol: "B",
  rendements: rA.map((r, i) => ({ t: i + 1, r: 0.5 * r })),
};
const poids: PoidsPosition[] = [
  { symbol: "A", poids: 100 },
  { symbol: "B", poids: -40 },
];

describe("quantile (interpolation linéaire type 7)", () => {
  it("interpole entre les deux voisins", () => {
    // n=4, q=0,05 ⇒ pos = 0,05·3 = 0,15, entre finis[0] et finis[1].
    const v = [1, 2, 3, 4];
    expect(quantile(v, 0.05)).toBeCloseTo(1 + (2 - 1) * 0.15, 12); // 1,15
  });
  it("tombe sur une borne exacte", () => {
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });
  it("liste vide → undefined", () => {
    expect(quantile([], 0.5)).toBeUndefined();
  });
});

describe("serieRendementsPortefeuille", () => {
  it("calcule r_p = (4/7)·rA sur la fixture signée", () => {
    const rp = serieRendementsPortefeuille([serieA, serieB], poids);
    expect(rp.map((p) => p.t)).toEqual([1, 2, 3, 4]);
    for (let i = 0; i < rA.length; i++) {
      expect(rp[i]!.r).toBeCloseTo((4 / 7) * rA[i]!, 12);
    }
  });
  it("intersecte les dates (série trouée : t manquant dans B exclu)", () => {
    // B privé de t=2 ⇒ dates communes = {1,3,4}, t=2 disparaît du portefeuille.
    const serieBTroue: SerieActif = {
      symbol: "B",
      rendements: [
        { t: 1, r: 0.005 },
        { t: 3, r: 0.015 },
        { t: 4, r: 0.005 },
      ],
    };
    const rp = serieRendementsPortefeuille([serieA, serieBTroue], poids);
    expect(rp.map((p) => p.t)).toEqual([1, 3, 4]);
  });
  it("aucune date commune → []", () => {
    const serieDecalee: SerieActif = { symbol: "B", rendements: [{ t: 99, r: 0.01 }] };
    expect(serieRendementsPortefeuille([serieA, serieDecalee], poids)).toEqual([]);
  });
});

describe("risquePortefeuille (VaR/CVaR, signes)", () => {
  // 40 rendements : rp[i] = (i − 20)·0,001, i=0..39 ⇒ triés de −0,020 à +0,019.
  const rp40 = Array.from({ length: 40 }, (_, i) => ({ r: (i - 20) * 0.001 }));

  it("VaR positive (= perte) et sur les bons quantiles", () => {
    const risk = risquePortefeuille(rp40)!;
    // q0,05 type7 : pos = 0,05·39 = 1,95 ⇒ entre finis[1]=−0,019 et finis[2]=−0,018
    // q = −0,019 + 0,001·0,95 = −0,01805 ⇒ VaR95 = +0,01805 (perte positive).
    expect(risk.var95Pct).toBeCloseTo(0.01805, 10);
    // q0,01 : pos = 0,01·39 = 0,39 ⇒ entre finis[0]=−0,020 et finis[1]=−0,019
    // q = −0,020 + 0,001·0,39 = −0,01961 ⇒ VaR99 = +0,01961.
    expect(risk.var99Pct).toBeCloseTo(0.01961, 10);
    // CVaR95 = −moyenne(r ≤ q0,05=−0,01805) = −moy(−0,020, −0,019) = −(−0,0195) = 0,0195.
    expect(risk.cvar95Pct).toBeCloseTo(0.0195, 10);
    expect(risk.nJours).toBe(40);
  });

  it("null si < 30 rendements, non-null à exactement 30", () => {
    const r29 = Array.from({ length: 29 }, (_, i) => ({ r: i * 0.001 }));
    const r30 = Array.from({ length: 30 }, (_, i) => ({ r: i * 0.001 }));
    expect(risquePortefeuille(r29)).toBeNull();
    expect(risquePortefeuille(r30)).not.toBeNull();
    expect(risquePortefeuille(r30)!.nJours).toBe(30);
  });
});

describe("contributionsRisque (Σ = 1, hedge négatif)", () => {
  it("ctr_A = 1,25 et ctr_B = −0,25 (hedge short corrélé)", () => {
    const ctr = contributionsRisque([serieA, serieB], poids);
    const map = new Map(ctr.map((c) => [c.symbol, c.ctr]));
    // ctr_A = w̃_A·cov(rA,r_p)/var(r_p) = (5/7)·(4/7)/(16/49) = 5/4 = 1,25
    expect(map.get("A")).toBeCloseTo(1.25, 12);
    // ctr_B = w̃_B·cov(rB,r_p)/var(r_p) = (−2/7)·(2/7)/(16/49) = −1/4 = −0,25 (NÉGATIF)
    expect(map.get("B")).toBeCloseTo(-0.25, 12);
    expect(map.get("B")!).toBeLessThan(0);
  });
  it("Σ contributions = 1 (identité assertée)", () => {
    const ctr = contributionsRisque([serieA, serieB], poids);
    const somme = ctr.reduce((s, c) => s + c.ctr, 0);
    expect(somme).toBeCloseTo(1, 12);
  });
  it("var(r_p) = 0 → []", () => {
    // Deux séries constantes ⇒ r_p constant ⇒ variance nulle.
    const cA: SerieActif = { symbol: "A", rendements: [1, 2, 3].map((t) => ({ t, r: 0.01 })) };
    const cB: SerieActif = { symbol: "B", rendements: [1, 2, 3].map((t) => ({ t, r: 0.01 })) };
    expect(contributionsRisque([cA, cB], poids)).toEqual([]);
  });
});

describe("betasVsRef", () => {
  // Réf de 30 points variés (variance > 0) ; actif = 2·réf ⇒ beta = 2 exact.
  const refR = Array.from({ length: 30 }, (_, i) => ((i % 5) - 2) * 0.01);
  const ref: SerieActif = { symbol: "REF", rendements: refR.map((r, i) => ({ t: i + 1, r })) };
  const double: SerieActif = { symbol: "DBL", rendements: refR.map((r, i) => ({ t: i + 1, r: 2 * r })) };

  it("beta = 2 sur fixture r = 2·rRef (≥ 30 communes)", () => {
    const betas = betasVsRef([double], ref);
    expect(betas[0]!.beta).toBeCloseTo(2, 12);
  });
  it("null si < 30 dates communes", () => {
    const court: SerieActif = { symbol: "C", rendements: refR.slice(0, 10).map((r, i) => ({ t: i + 1, r })) };
    // Seulement 10 dates communes avec ref ⇒ null.
    const betas = betasVsRef([court], ref);
    expect(betas[0]!.beta).toBeNull();
  });
  it("null si var(ref) = 0", () => {
    const refPlat: SerieActif = {
      symbol: "REF",
      rendements: Array.from({ length: 30 }, (_, i) => ({ t: i + 1, r: 0.01 })),
    };
    const betas = betasVsRef([double], refPlat);
    expect(betas[0]!.beta).toBeNull();
  });
});

describe("stressGrid", () => {
  it("impact et couvertUsd exacts (beta null exclu)", () => {
    const p: PoidsPosition[] = [
      { symbol: "A", poids: 100 },
      { symbol: "B", poids: -40 },
      { symbol: "C", poids: 50 },
    ];
    const betas = new Map<string, number | null>([
      ["A", 1.5],
      ["B", 0.5],
      ["C", null], // exclu du stress
    ]);
    const grid = stressGrid(p, betas);
    expect(grid.map((g) => g.chocPct)).toEqual([-20, -10, 10, 20]); // défauts
    const g20 = grid.find((g) => g.chocPct === -20)!;
    // impact = 100·1,5·(−0,20) + (−40)·0,5·(−0,20) = −30 + 4 = −26
    expect(g20.impactUsd).toBeCloseTo(-26, 12);
    // couvertUsd = |100| + |−40| = 140 (C exclu car beta null)
    expect(g20.couvertUsd).toBeCloseTo(140, 12);
    const gp10 = grid.find((g) => g.chocPct === 10)!;
    // impact = 100·1,5·0,10 + (−40)·0,5·0,10 = 15 − 2 = 13
    expect(gp10.impactUsd).toBeCloseTo(13, 12);
  });
  it("respecte les chocs personnalisés", () => {
    const grid = stressGrid([{ symbol: "A", poids: 100 }], new Map([["A", 1]]), [-5, 5]);
    expect(grid.map((g) => g.chocPct)).toEqual([-5, 5]);
    expect(grid[0]!.impactUsd).toBeCloseTo(-5, 12); // 100·1·(−0,05)
  });
});

describe("equityHistorique (PnL cumulé rétro-projeté)", () => {
  const prix = new Map<string, { t: number; close: number }[]>([
    ["A", [{ t: 1, close: 100 }, { t: 2, close: 110 }, { t: 3, close: 105 }]],
    ["B", [{ t: 1, close: 50 }, { t: 2, close: 45 }, { t: 3, close: 55 }]],
  ]);
  const tailles = new Map<string, { taille: number; entree: number; signe: 1 | -1 }>([
    ["A", { taille: 2, entree: 100, signe: 1 }], // long
    ["B", { taille: 1, entree: 50, signe: -1 }], // short
  ]);

  it("courbe PnL long + short exacte", () => {
    const eq = equityHistorique(prix, tailles);
    expect(eq.map((e) => e.t)).toEqual([1, 2, 3]);
    // t1 : 1·2·(100−100) + (−1)·1·(50−50) = 0
    expect(eq[0]!.equity).toBeCloseTo(0, 12);
    // t2 : 1·2·(110−100) + (−1)·1·(45−50) = 20 + 5 = 25
    expect(eq[1]!.equity).toBeCloseTo(25, 12);
    // t3 : 1·2·(105−100) + (−1)·1·(55−50) = 10 − 5 = 5
    expect(eq[2]!.equity).toBeCloseTo(5, 12);
  });

  it("intersecte les dates (t manquant dans un symbole exclu)", () => {
    const prixTroue = new Map<string, { t: number; close: number }[]>([
      ["A", [{ t: 1, close: 100 }, { t: 2, close: 110 }, { t: 3, close: 105 }]],
      ["B", [{ t: 1, close: 50 }, { t: 3, close: 55 }]], // pas de t=2
    ]);
    const eq = equityHistorique(prixTroue, tailles);
    expect(eq.map((e) => e.t)).toEqual([1, 3]);
  });
});
