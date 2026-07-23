/**
 * Tests de la logique PURE de la distribution empirique des rendements (data/distVar.ts).
 * Chaque valeur attendue est calculée À LA MAIN et justifiée en commentaire (pas d'oracle
 * circulaire). Le verrou central est la fixture « rendements constants r » : elle prouve
 * que l'agrégation h-bougies (sommes glissantes) vaut EXACTEMENT h·r. Une seconde fixture
 * dispersée verrouille le CÂBLAGE niveau→champ (p1←q0.01 … p99←q0.99) et la co-dérivation
 * prix/% que la fixture constante ne peut pas distinguer (tous les quantiles y sont égaux).
 */
import { describe, expect, it } from "vitest";
import {
  cvarInf,
  distVar,
  HORIZONS,
  logRendements1,
  quantile,
  sommesGlissantes,
} from "./distVar";

describe("quantile (interpolation linéaire type 7)", () => {
  it("tombe exactement sur les bornes d'interpolation", () => {
    // n=5 : [10,20,30,40,50], position = q·(n−1) = q·4.
    const v = [10, 20, 30, 40, 50];
    expect(quantile(v, 0)).toBe(10); // pos 0 → v[0]
    expect(quantile(v, 0.25)).toBe(20); // pos 1 → v[1] (exact, pas d'interp)
    expect(quantile(v, 0.5)).toBe(30); // pos 2 → v[2] (médiane)
    expect(quantile(v, 0.75)).toBe(40); // pos 3 → v[3]
    expect(quantile(v, 1)).toBe(50); // pos 4 → v[4]
    expect(quantile(v, 0.05)).toBeCloseTo(12, 10); // pos 0.2 → 10 + 0.2·(20−10) = 12
  });

  it("interpole à travers une discontinuité (distribution bimodale)", () => {
    // Deux amas séparés par un trou : [1,2,3, 50,51,52] (n=6), pos = q·5.
    const v = [1, 2, 3, 50, 51, 52];
    // p50 : pos = 2.5 → interp entre v[2]=3 et v[3]=50 dans le TROU → 3 + 0.5·47 = 26.5
    expect(quantile(v, 0.5)).toBeCloseTo(26.5, 10);
    // q=0.4 : pos = 2.0 → exactement v[2] = 3 (bord haut de l'amas bas)
    expect(quantile(v, 0.4)).toBeCloseTo(3, 10);
    // q=0.6 : pos = 3.0 → exactement v[3] = 50 (bord bas de l'amas haut)
    expect(quantile(v, 0.6)).toBeCloseTo(50, 10);
    // q=0.05 : pos = 0.25 → 1 + 0.25·(2−1) = 1.25
    expect(quantile(v, 0.05)).toBeCloseTo(1.25, 10);
  });

  it("écarte les valeurs non finies et gère les cas dégénérés", () => {
    expect(quantile([], 0.5)).toBeUndefined();
    expect(quantile([NaN, Infinity], 0.5)).toBeUndefined();
    expect(quantile([42], 0.9)).toBe(42); // singleton
    // NaN écarté : quantile de [10,20,30] (le NaN disparu), pos 0.5·2 = 1 → 20
    expect(quantile([10, NaN, 20, 30], 0.5)).toBeCloseTo(20, 10);
  });
});

describe("logRendements1", () => {
  it("calcule ln(closes[i+1]/closes[i]), longueur n−1", () => {
    // [100,110,121] → r = [ln(1.1), ln(1.1)] = [0.09531018, 0.09531018]
    const r = logRendements1([100, 110, 121]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.09531018, 8);
    expect(r[1]).toBeCloseTo(0.09531018, 8);
  });
});

describe("sommesGlissantes (fenêtres chevauchantes)", () => {
  it("somme h valeurs consécutives, une par position", () => {
    // [1,2,3,4], h=2 → [1+2, 2+3, 3+4] = [3,5,7] (n−h+1 = 3 échantillons)
    expect(sommesGlissantes([1, 2, 3, 4], 2)).toEqual([3, 5, 7]);
    // h=1 → la série elle-même
    expect(sommesGlissantes([1, 2, 3, 4], 1)).toEqual([1, 2, 3, 4]);
    // h=4 → une seule somme totale = 10
    expect(sommesGlissantes([1, 2, 3, 4], 4)).toEqual([10]);
    // h > n → aucune fenêtre complète
    expect(sommesGlissantes([1, 2, 3], 4)).toEqual([]);
  });
});

describe("cvarInf (moyenne de la queue inférieure ≤ quantile q)", () => {
  it("moyenne les valeurs ≤ p5, et diffère du quantile p1", () => {
    // v = [−10,−9,…,9,10] (n=21), pos = q·20.
    const v = Array.from({ length: 21 }, (_, i) => i - 10);
    // p5 : pos = 1.0 → exactement v[1] = −9. Valeurs ≤ −9 : {−10, −9} → moyenne −9.5
    expect(cvarInf(v, 0.05)).toBeCloseTo(-9.5, 10);
    // p1 : pos = 0.2 → −10 + 0.2·1 = −9.8 → la CVaR (−9.5) DIFFÈRE du p1 (−9.8)
    expect(quantile(v, 0.01)).toBeCloseTo(-9.8, 10);
    expect(cvarInf(v, 0.05)).not.toBeCloseTo(-9.8, 3);
  });
});

describe("distVar", () => {
  it("renvoie null si moins de 300 closes finis", () => {
    expect(distVar(Array.from({ length: 299 }, (_, i) => 100 + i))).toBeNull();
    // 305 valeurs mais 6 non finies → 299 finies → null (les non-finis sont écartés en amont)
    const mixte = Array.from({ length: 305 }, (_, i) => (i < 6 ? NaN : 100 + i));
    expect(distVar(mixte)).toBeNull();
  });

  it("HORIZONS = [1, 5, 20]", () => {
    expect(HORIZONS).toEqual([1, 5, 20]);
  });

  it("rendements constants r ⇒ quantiles h = h·r EXACTEMENT (verrou d'agrégation)", () => {
    // closes[i] = base·exp(i·c) ⇒ chaque log-rendement = c exactement.
    const c = 0.002;
    const base = 100;
    const n = 350;
    const closes = Array.from({ length: n }, (_, i) => base * Math.exp(i * c));
    const dernierClose = base * Math.exp((n - 1) * c);
    const res = distVar(closes);
    expect(res).not.toBeNull();
    expect(res!.map((r) => r.h)).toEqual([1, 5, 20]);

    for (const niv of res!) {
      const h = niv.h;
      // n−1 = 349 rendements ; sommes glissantes h → 349 − h + 1 échantillons
      expect(niv.nEchantillons).toBe(n - 1 - h + 1);
      const attenduRend = h * c; // toutes les sommes valent h·c → tous les quantiles = h·c
      const prix = dernierClose * Math.exp(h * c);
      const pct = (Math.exp(h * c) - 1) * 100;
      for (const q of ["p1", "p5", "p50", "p95", "p99"] as const) {
        expect(niv.niveaux[q]).toBeCloseTo(prix, 6);
        expect(niv.pct[q]).toBeCloseTo(pct, 8);
      }
      // CVaR95 = moyenne de la queue ≤ p5 = h·c (toutes égales) → mêmes prix/%
      expect(niv.cvar95Niveau).toBeCloseTo(prix, 6);
      expect(niv.cvar95Pct).toBeCloseTo(pct, 8);
      void attenduRend;
    }
  });

  it("série dispersée : câblage niveau→champ + co-dérivation prix/% + CVaR ≤ p5", () => {
    // Série déterministe MAIS dispersée : rendement r_i = 0.03·sin(i) (sin d'entiers en
    // radians → beaucoup de valeurs distinctes ⇒ quantiles strictement séparés). Closes =
    // produit cumulé. Un motif périodique donnerait trop peu de valeurs distinctes (p95=p99).
    const base = 1000;
    const closes: number[] = [base];
    for (let i = 1; i < 340; i++) {
      const r = 0.03 * Math.sin(i);
      closes.push(closes[i - 1]! * Math.exp(r));
    }
    const dernierClose = closes[closes.length - 1]!;
    const res = distVar(closes);
    expect(res).not.toBeNull();

    for (const niv of res!) {
      // Ordre strict : un échange de niveaux casse cette chaîne.
      expect(niv.niveaux.p1).toBeLessThan(niv.niveaux.p5);
      expect(niv.niveaux.p5).toBeLessThan(niv.niveaux.p50);
      expect(niv.niveaux.p50).toBeLessThan(niv.niveaux.p95);
      expect(niv.niveaux.p95).toBeLessThan(niv.niveaux.p99);
      // Co-dérivation prix/% : prix ≈ dernierClose·(1 + pct/100) pour chaque niveau.
      for (const q of ["p1", "p5", "p50", "p95", "p99"] as const) {
        expect(niv.niveaux[q]).toBeCloseTo(dernierClose * (1 + niv.pct[q] / 100), 6);
      }
      // CVaR95 (moyenne de la queue ≤ p5) ≤ p5, en prix ET en %.
      expect(niv.cvar95Niveau).toBeLessThanOrEqual(niv.niveaux.p5 + 1e-9);
      expect(niv.cvar95Pct).toBeLessThanOrEqual(niv.pct.p5 + 1e-9);
    }
  });

  it("p50 ≈ médiane des rendements pour h=1", () => {
    // Série dispersée : le p50 (h=1) doit valoir la médiane des log-rendements 1-bougie.
    const motif = [0.03, -0.02, 0.01, -0.04, 0.0];
    const base = 500;
    const closes: number[] = [base];
    for (let i = 1; i < 320; i++) {
      const r = motif[(i - 1) % motif.length]!;
      closes.push(closes[i - 1]! * Math.exp(r));
    }
    const dernierClose = closes[closes.length - 1]!;
    const rend = logRendements1(closes);
    const medianeRend = quantile(rend, 0.5)!;
    const res = distVar(closes)!;
    const h1 = res.find((r) => r.h === 1)!;
    expect(h1.niveaux.p50).toBeCloseTo(dernierClose * Math.exp(medianeRend), 6);
  });

  it("horizons personnalisés respectés", () => {
    const closes = Array.from({ length: 310 }, (_, i) => 100 * Math.exp(i * 0.001));
    const res = distVar(closes, [2, 10])!;
    expect(res.map((r) => r.h)).toEqual([2, 10]);
  });
});
