import { describe, expect, it } from "vitest";
import { percentile, realizedVolSeries, volCone, zScore } from "./volCone";

/** Accès indexé gardé explicitement (noUncheckedIndexedAccess actif sur apps/web). */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} absent`);
  return v;
}

/**
 * Série de closes synthétique (déterministe) : oscillation à deux fréquences + dérive
 * légère → rendements variés (RV non constante d'une fenêtre à l'autre), nécessaire pour
 * que les percentiles du cône ne soient pas tous égaux. Prix toujours positif et fini
 * (vérifié : min ≈ 100.23, max ≈ 111.37 sur n=200 — cf. calcul de vérification manuel).
 */
function serieSynthetique(n: number): number[] {
  const closes: number[] = [];
  let prix = 100;
  for (let i = 0; i < n; i++) {
    const rendement = 0.01 * Math.sin(i * 0.37) + 0.002 * Math.cos(i * 1.7) + 0.0003;
    prix *= 1 + rendement;
    closes.push(prix);
  }
  return closes;
}

describe("percentile — interpolation linéaire sur tableau trié ascendant", () => {
  it("percentile([1,2,3,4], 50) = 2.5 (rang=1.5 → entre index 1 (=2) et 2 (=3))", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 10);
  });

  it("percentile([1,2,3,4], 25) = 1.75 (rang=0.75 → entre index 0 (=1) et 1 (=2))", () => {
    expect(percentile([1, 2, 3, 4], 25)).toBeCloseTo(1.75, 10);
  });

  it("percentile aux bornes 0 et 100 = min et max", () => {
    expect(percentile([1, 2, 3, 4], 0)).toBeCloseTo(1, 10);
    expect(percentile([1, 2, 3, 4], 100)).toBeCloseTo(4, 10);
  });

  it("médiane d'un nombre impair d'éléments = élément central exact", () => {
    // n=3, p=50 → rang=(0.5)*2=1 (entier) → valeur exacte à l'index 1 = 20.
    expect(percentile([10, 20, 30], 50)).toBeCloseTo(20, 10);
  });

  it("tableau vide → NaN", () => {
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
});

describe("realizedVolSeries — RV annualisée en série complète (null tant que fenêtre incomplète)", () => {
  it("null pour les positions précédant la première fenêtre pleine", () => {
    // Closes: [100, 110, 104.5, 115, 120], window=3 → 1re valeur définie à l'index 3
    // (il faut 3 log-rendements, donc logReturns[1..3], donc closes[0..3]).
    const closes = [100, 110, 104.5, 115, 120];
    const out = realizedVolSeries(closes, 3, 365);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
    expect(out[3]).not.toBeNull();
    expect(out[4]).not.toBeNull();
  });

  it("recoupement avec le golden RV de Task 7 (packages/indicators/src/volatility/rv.test.ts) — mêmes closes, même dernière valeur", () => {
    // Closes: [100, 110, 104.5, 115] (IDENTIQUE au golden de rv.test.ts, length=3, periodesParAn=365).
    // logReturns = [undefined, ln(110/100), ln(104.5/110), ln(115/104.5)]
    //            = [undefined, 0.09531017980432493, -0.05129329438755058, 0.09574505695838434]
    // À i=3 : window = les 3 log-rendements ci-dessus.
    // sum = 0.1397619423751587
    // sumSq = 0.020882148355424936
    // variance_pop = (sumSq - sum²/3) / 3 = 0.004790338281088625
    // stdev_pop = sqrt(variance_pop) = 0.06921226972935236
    // rv = stdev_pop * sqrt(365) * 100 = 132.22985565284975 %
    // (valeurs recalculées indépendamment via node -e, cf. task-8-report.md)
    const closes = [100, 110, 104.5, 115];
    const out = realizedVolSeries(closes, 3, 365);
    expect(out[3]).toBeCloseTo(132.23, 1); // même tolérance que le golden de Task 7
  });

  it("l'annualisation réagit à periodesParAn (365 vs 252) selon le ratio √(365/252)", () => {
    const closes = [100, 110, 104.5, 115];
    const rv365 = realizedVolSeries(closes, 3, 365)[3];
    const rv252 = realizedVolSeries(closes, 3, 252)[3];
    expect(rv365).not.toBeNull();
    expect(rv252).not.toBeNull();
    if (typeof rv365 === "number" && typeof rv252 === "number") {
      expect(rv365 / rv252).toBeCloseTo(Math.sqrt(365 / 252), 6);
    }
  });

  it("la sortie a toujours la même longueur que closes", () => {
    expect(realizedVolSeries([100, 101, 99, 102, 103, 104], 2, 365)).toHaveLength(6);
  });
});

describe("volCone — percentiles par horizon sur une série construite (200 closes)", () => {
  const closes = serieSynthetique(200);
  const rows = volCone(closes); // défauts : horizons [7,14,30,60,90], periodsPerYear 365

  it("expose une ligne par horizon par défaut, dans l'ordre", () => {
    expect(rows.map((r) => r.horizon)).toEqual([7, 14, 30, 60, 90]);
  });

  it("chaque ligne respecte p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95", () => {
    for (const row of rows) {
      expect(row.p5).toBeLessThanOrEqual(row.p25);
      expect(row.p25).toBeLessThanOrEqual(row.p50);
      expect(row.p50).toBeLessThanOrEqual(row.p75);
      expect(row.p75).toBeLessThanOrEqual(row.p95);
    }
  });

  it("current de chaque ligne égale la dernière valeur de realizedVolSeries pour cet horizon", () => {
    for (const row of rows) {
      const serie = realizedVolSeries(closes, row.horizon, 365);
      const derniere = at(serie, serie.length - 1);
      if (derniere === null) {
        expect(row.current).toBeNull();
      } else {
        expect(row.current).toBeCloseTo(derniere, 10);
      }
    }
  });

  it("propage periodsPerYear et des horizons personnalisés", () => {
    const rowsPerso = volCone(closes, [10, 20], 252);
    expect(rowsPerso.map((r) => r.horizon)).toEqual([10, 20]);
    const attendu = realizedVolSeries(closes, 10, 252);
    const derniere = at(attendu, attendu.length - 1);
    expect(rowsPerso[0]?.current).toBe(derniere);
  });

  it("current est null si closes est trop court pour l'horizon", () => {
    const rowsCourt = volCone([100, 101, 102], [7], 365);
    expect(rowsCourt[0]?.current).toBeNull();
  });
});

describe("zScore — écart-type population, null si stdev=0 ou n<2", () => {
  it("zScore([10,10,10], 12) = null (stdev population = 0, distribution constante)", () => {
    expect(zScore([10, 10, 10], 12)).toBeNull();
  });

  it("zScore([8,12], 12) — main-calc : mean=10, variance_pop=((8-10)²+(12-10)²)/2=4, stdev=2, z=(12-10)/2=1", () => {
    expect(zScore([8, 12], 12)).toBeCloseTo(1, 10);
  });

  it("null si moins de 2 valeurs (dispersion non définie)", () => {
    expect(zScore([], 10)).toBeNull();
    expect(zScore([5], 10)).toBeNull();
  });
});
