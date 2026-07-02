/**
 * Tests de la logique PURE de corrélation (data/corr.ts). Chaque valeur attendue est
 * calculée À LA MAIN et justifiée en commentaire (pas d'oracle « circulaire »).
 */
import { describe, expect, it } from "vitest";
import {
  alignerSeries,
  calculerMatrice,
  correlation,
  correlationGlissante,
  fenetrer,
  logRendements,
  pearson,
  spearman,
  type SerieCloture,
} from "./corr";

const JOUR = 86_400_000;
/** Horodatage (ms) du jour calendaire UTC n° `n` (bucket = n). */
const j = (n: number): number => n * JOUR;

describe("logRendements", () => {
  it("calcule ln(cur/prev) par pas, longueur n-1", () => {
    // closes = [100, 110, 121] → r1 = ln(1.1), r2 = ln(1.1) = 0.0953101798...
    const r = logRendements([100, 110, 121]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.09531018, 8);
    expect(r[1]).toBeCloseTo(0.09531018, 8);
  });

  it("produit NaN sur une clôture ≤ 0 (donnée douteuse)", () => {
    const r = logRendements([100, 0, 120]);
    expect(Number.isNaN(r[0])).toBe(true); // ln(0/100) indéfini → NaN
    expect(Number.isNaN(r[1])).toBe(true); // prev = 0 → NaN
  });
});

describe("pearson", () => {
  it("vaut 1 pour une relation affine croissante", () => {
    // ys = 2*xs → corrélation linéaire parfaite = 1
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
  });

  it("vaut -1 pour une relation affine décroissante", () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
  });

  it("retrouve une valeur connue calculée à la main", () => {
    // xs=[1,2,3,4,5], ys=[2,4,5,4,5]. mx=3, my=4.
    // dx=[-2,-1,0,1,2], dy=[-2,0,1,0,1]
    // cov = 4+0+0+0+2 = 6 ; vx = 4+1+0+1+4 = 10 ; vy = 4+0+1+0+1 = 6
    // r = 6 / sqrt(10*6) = 6 / sqrt(60) = 0.7745966692...
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])).toBeCloseTo(0.77459667, 8);
  });

  it("renvoie null si série constante (variance nulle) ou < 2 couples", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull(); // vx = 0
    expect(pearson([1], [2])).toBeNull(); // 1 seul couple
  });

  it("ignore les couples non finis (suppression par paire)", () => {
    // Le couple NaN est retiré ; reste [1,2,3]×[2,4,6] → r = 1
    expect(pearson([1, 2, NaN, 3], [2, 4, 9, 6])).toBeCloseTo(1, 12);
  });
});

describe("spearman", () => {
  it("vaut 1 pour une relation monotone NON linéaire (là où Pearson < 1)", () => {
    // ys = xs^2, strictement croissant → rangs identiques → Spearman = 1
    const xs = [1, 2, 3, 4];
    const ys = [1, 4, 9, 16];
    expect(spearman(xs, ys)).toBeCloseTo(1, 12);
    expect(pearson(xs, ys)).toBeLessThan(1); // Pearson pénalise la courbure
  });

  it("gère les ex-aequo par rangs moyens (valeur connue)", () => {
    // xs=[1,2,2,3] → rangs [1, 2.5, 2.5, 4] ; ys=[1,2,3,4] → rangs [1,2,3,4]
    // pearson(rx, ry) : mrx=mry=2.5
    // dx=[-1.5,0,0,1.5], dy=[-1.5,-0.5,0.5,1.5]
    // cov = 2.25+0+0+2.25 = 4.5 ; vx = 4.5 ; vy = 2.25+0.25+0.25+2.25 = 5
    // r = 4.5 / sqrt(4.5*5) = 4.5 / sqrt(22.5) = 0.9486832981...
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9486833, 7);
  });
});

describe("alignerSeries", () => {
  it("ne garde que les jours calendaires UTC communs, en ordre chronologique", () => {
    const a: SerieCloture[] = [
      { time: j(0), close: 1 },
      { time: j(1), close: 2 },
      { time: j(2), close: 3 },
      { time: j(3), close: 4 },
    ];
    const b: SerieCloture[] = [
      { time: j(1), close: 10 },
      { time: j(3), close: 30 },
      { time: j(5), close: 50 },
    ];
    // jours communs = {1, 3} → a=[2,4], b=[10,30]
    expect(alignerSeries(a, b)).toEqual({ a: [2, 4], b: [10, 30] });
  });

  it("réduit deux bougies du même jour UTC à la dernière clôture rencontrée", () => {
    const a: SerieCloture[] = [
      { time: j(1), close: 2 },
      { time: j(1) + 3600_000, close: 22 }, // même jour 1 (une heure plus tard) → 22 gagne
    ];
    const b: SerieCloture[] = [{ time: j(1), close: 10 }];
    expect(alignerSeries(a, b)).toEqual({ a: [22], b: [10] });
  });
});

describe("fenetrer", () => {
  it("garde les jours dans la fenêtre relative à la dernière bougie", () => {
    const serie: SerieCloture[] = Array.from({ length: 10 }, (_, i) => ({ time: j(i), close: i }));
    // dernier = j(9) ; fenêtre 3 j → seuil = j(6) ; on garde les jours 6,7,8,9 = 4 points
    const f = fenetrer(serie, 3);
    expect(f.map((p) => p.time)).toEqual([j(6), j(7), j(8), j(9)]);
  });

  it("renvoie la série telle quelle si vide", () => {
    expect(fenetrer([], 30)).toEqual([]);
  });
});

describe("correlationGlissante", () => {
  it("produit une valeur par fenêtre complète (longueur n-fenetre+1)", () => {
    // 5 rendements, fenêtre 3 → 3 fenêtres, chacune parfaitement corrélée → [1,1,1]
    const xs = [0.1, 0.2, -0.1, 0.05, -0.2];
    const ys = xs.map((v) => 2 * v); // affine → corrélation 1 sur chaque fenêtre
    const g = correlationGlissante("pearson", xs, ys, 3);
    expect(g).toHaveLength(3);
    for (const v of g) expect(v).toBeCloseTo(1, 12);
  });

  it("renvoie [] si l'historique est plus court que la fenêtre", () => {
    expect(correlationGlissante("pearson", [0.1, 0.2], [0.1, 0.2], 30)).toEqual([]);
  });
});

describe("calculerMatrice", () => {
  it("diagonale = 1, symétrie, et corrélation parfaite entre deux séries co-évoluant", () => {
    // A et B multiplient leur clôture par 1.1 chaque jour → log-rendements identiques → r = 1
    const a: SerieCloture[] = [
      { time: j(0), close: 100 },
      { time: j(1), close: 110 },
      { time: j(2), close: 121 },
      { time: j(3), close: 133.1 },
    ];
    const b: SerieCloture[] = [
      { time: j(0), close: 50 },
      { time: j(1), close: 55 },
      { time: j(2), close: 60.5 },
      { time: j(3), close: 66.55 },
    ];
    const map = new Map<string, SerieCloture[]>([
      ["A", a],
      ["B", b],
    ]);
    const m = calculerMatrice(map, ["A", "B"], "pearson", 180);
    expect(m.cellules[0]?.[0]?.valeur).toBe(1); // diagonale
    expect(m.cellules[1]?.[1]?.valeur).toBe(1);
    expect(m.cellules[0]?.[1]?.valeur).toBeCloseTo(1, 12);
    expect(m.cellules[1]?.[0]?.valeur).toBeCloseTo(1, 12); // symétrique
    expect(m.cellules[0]?.[1]?.points).toBe(3); // 4 clôtures communes → 3 rendements
  });

  it("cellule nulle pour un symbole sans série", () => {
    const map = new Map<string, SerieCloture[]>([["A", [{ time: j(0), close: 1 }]]]);
    const m = calculerMatrice(map, ["A", "B"], "pearson", 180);
    expect(m.cellules[0]?.[1]?.valeur).toBeNull(); // B absent → pas de corrélation
    expect(m.cellules[1]?.[1]?.valeur).toBeNull(); // diagonale B : aucune donnée
  });
});

describe("correlation (aiguillage)", () => {
  it("délègue à pearson ou spearman selon la méthode", () => {
    const xs = [1, 2, 3, 4];
    const ys = [1, 4, 9, 16];
    expect(correlation("pearson", xs, ys)).toBe(pearson(xs, ys));
    expect(correlation("spearman", xs, ys)).toBe(spearman(xs, ys));
  });
});
