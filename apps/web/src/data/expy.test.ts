/**
 * Tests de la logique PURE du journal d'expectancy (data/expy.ts). Chaque valeur
 * attendue est calculée À LA MAIN et justifiée en commentaire (pas d'oracle circulaire).
 *
 * LE piège central : le signe du R pour un short. Un short GAGNANT est un short dont le
 * prix BAISSE (sortie < entree) et il doit donner un R POSITIF. Fixtures des deux
 * directions obligatoires ; la taille se simplifie (le risque la porte déjà).
 */
import { describe, expect, it } from "vitest";
import {
  BUCKETS_R,
  equityR,
  histogrammeR,
  repartition,
  rMultiple,
  statsExpy,
  type TradeJournal,
} from "./expy";

/** Construit un trade en ne précisant que les champs utiles au test (défauts neutres). */
function trade(p: Partial<TradeJournal>): TradeJournal {
  return {
    id: p.id ?? "t",
    symbol: p.symbol ?? "BTCUSDT",
    direction: p.direction ?? "long",
    entree: p.entree ?? 100,
    stopInitial: p.stopInitial ?? 90,
    taille: p.taille ?? 1,
    // « in » pour préserver un null EXPLICITE (?? le remplacerait par le défaut).
    sortie: "sortie" in p ? (p.sortie ?? null) : null,
    ouvertTs: p.ouvertTs ?? 1_000,
    fermeTs: "fermeTs" in p ? (p.fermeTs ?? null) : 2_000,
    note: p.note,
    tags: p.tags ?? [],
  };
}

/** Trade long fermé de R connu : entree=100, stop=90 (risque=10/unité), taille=1 → R = (sortie−100)/10. */
function longR(r: number, extra: Partial<TradeJournal> = {}): TradeJournal {
  return trade({ direction: "long", entree: 100, stopInitial: 90, taille: 1, sortie: 100 + r * 10, ...extra });
}

describe("rMultiple", () => {
  it("long gagnant : signe positif, taille=2", () => {
    // entree=100, stop=95 → risque=|100−95|×2=10 ; sortie=110 → R=(110−100)×2×(+1)/10 = 20/10 = 2
    const t = trade({ direction: "long", entree: 100, stopInitial: 95, taille: 2, sortie: 110 });
    expect(rMultiple(t)).toBeCloseTo(2, 10);
  });

  it("short gagnant : prix qui BAISSE → R positif (LE piège), taille=3", () => {
    // entree=100, stop=105 → risque=|100−105|×3=15 ; sortie=90 (baisse = gain)
    // R = (entree−sortie)×taille/risque = (100−90)×3/15 = 30/15 = 2 (positif). La taille se simplifie.
    const t = trade({ direction: "short", entree: 100, stopInitial: 105, taille: 3, sortie: 90 });
    expect(rMultiple(t)).toBeCloseTo(2, 10);
  });

  it("short perdant : prix qui MONTE → R négatif", () => {
    // entree=100, stop=105 (risque=5/unité), sortie=105 → R = (100−105)/5 = −1
    const t = trade({ direction: "short", entree: 100, stopInitial: 105, taille: 1, sortie: 105 });
    expect(rMultiple(t)).toBeCloseTo(-1, 10);
  });

  it("risque 0 (stop = entrée) → null (jamais Infinity/NaN)", () => {
    const t = trade({ entree: 100, stopInitial: 100, sortie: 120 });
    expect(rMultiple(t)).toBeNull();
  });

  it("trade ouvert (sortie null) → null", () => {
    expect(rMultiple(trade({ sortie: null }))).toBeNull();
  });

  it("trade sans fermeTs → null", () => {
    expect(rMultiple(trade({ sortie: 120, fermeTs: null }))).toBeNull();
  });
});

describe("statsExpy", () => {
  it("fixture main-calculée : gains [2,3,1], pertes [−1,−2]", () => {
    // 5 fermés + 1 ouvert (exclu). ΣR = 2+3+1−1−2 = 3 ; expectancy = 3/5 = 0.6
    // gagnants (R>0) = 3 → winRate = 3/5 = 0.6 ; ΣR+ = 6, ΣR− = −3 → PF = 6/3 = 2
    // moyGain = 6/3 = 2 ; moyPerte = −3/2 = −1.5 (signée) ; meilleurR = 3 ; pireR = −2
    const trades = [longR(2), longR(3), longR(1), longR(-1), longR(-2), trade({ sortie: null })];
    const s = statsExpy(trades);
    expect(s.n).toBe(5);
    expect(s.expectancy).toBeCloseTo(0.6, 10);
    expect(s.winRate).toBeCloseTo(0.6, 10);
    expect(s.profitFactor).toBeCloseTo(2, 10);
    expect(s.moyGain).toBeCloseTo(2, 10);
    expect(s.moyPerte).toBeCloseTo(-1.5, 10);
    expect(s.meilleurR).toBeCloseTo(3, 10);
    expect(s.pireR).toBeCloseTo(-2, 10);
  });

  it("aucun perdant → profitFactor null et moyPerte null", () => {
    const s = statsExpy([longR(2), longR(3)]);
    expect(s.profitFactor).toBeNull();
    expect(s.moyPerte).toBeNull();
    expect(s.moyGain).toBeCloseTo(2.5, 10);
    expect(s.pireR).toBeCloseTo(2, 10); // pireR = min de TOUS les R (ici 2)
  });

  it("breakeven R=0 : ni gagnant ni perdant, mais compté dans n et l'expectancy", () => {
    // R = [2, 0, −2] → n=3 ; expectancy = 0 ; gagnants = 1 → winRate = 1/3
    // ΣR+ = 2, ΣR− = −2 → PF = 1 ; moyGain = 2 ; moyPerte = −2 (le 0 exclu des deux moyennes)
    const s = statsExpy([longR(2), longR(0), longR(-2)]);
    expect(s.n).toBe(3);
    expect(s.expectancy).toBeCloseTo(0, 10);
    expect(s.winRate).toBeCloseTo(1 / 3, 10);
    expect(s.profitFactor).toBeCloseTo(1, 10);
    expect(s.moyGain).toBeCloseTo(2, 10);
    expect(s.moyPerte).toBeCloseTo(-2, 10);
  });

  it("aucun fermé → tout null, n=0", () => {
    const s = statsExpy([trade({ sortie: null }), trade({ sortie: null })]);
    expect(s).toEqual({
      n: 0,
      expectancy: null,
      winRate: null,
      profitFactor: null,
      moyGain: null,
      moyPerte: null,
      meilleurR: null,
      pireR: null,
    });
  });
});

describe("equityR", () => {
  it("fermés triés par fermeTs asc, R cumulé ; ouverts exclus", () => {
    // A R=2 fermeTs=300, B R=−1 fermeTs=100, C R=3 fermeTs=200, D ouvert (exclu)
    // tri asc : B(100,−1), C(200,−1+3=2), A(300,2+2=4)
    const eq = equityR([
      longR(2, { fermeTs: 300 }),
      longR(-1, { fermeTs: 100 }),
      longR(3, { fermeTs: 200 }),
      trade({ sortie: null, fermeTs: null }),
    ]);
    expect(eq).toEqual([
      { ts: 100, cumR: -1 },
      { ts: 200, cumR: 2 },
      { ts: 300, cumR: 4 },
    ]);
  });

  it("aucun fermé → tableau vide", () => {
    expect(equityR([trade({ sortie: null })])).toEqual([]);
  });
});

describe("histogrammeR / BUCKETS_R", () => {
  it("BUCKETS_R est la grille attendue", () => {
    expect(BUCKETS_R).toEqual([-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 5]);
  });

  it("11 buckets bornés + 2 extrêmes ouverts, tous présents même vides", () => {
    const h = histogrammeR([]);
    expect(h.map((b) => b.label)).toEqual([
      "< −3",
      "[−3, −2)",
      "[−2, −1)",
      "[−1, −0.5)",
      "[−0.5, 0)",
      "[0, 0.5)",
      "[0.5, 1)",
      "[1, 2)",
      "[2, 3)",
      "[3, 5)",
      "> 5",
    ]);
    expect(h.every((b) => b.n === 0)).toBe(true);
  });

  it("bornes : R=−3 dans [−3,−2), R=0 dans [0,0.5), R=5 dans [3,5) ; extrêmes ouverts", () => {
    // R : −4 (<−3), −3 ([−3,−2)), −0.5 ([−0.5,0)), 0 ([0,0.5)), 2 ([2,3)), 5 ([3,5)), 6 (>5)
    const h = histogrammeR([
      longR(-4),
      longR(-3),
      longR(-0.5),
      longR(0),
      longR(2),
      longR(5),
      longR(6),
    ]);
    const n = (label: string) => h.find((b) => b.label === label)?.n;
    expect(n("< −3")).toBe(1); // −4
    expect(n("[−3, −2)")).toBe(1); // −3 (borne basse incluse)
    expect(n("[−0.5, 0)")).toBe(1); // −0.5 (borne basse incluse)
    expect(n("[0, 0.5)")).toBe(1); // 0
    expect(n("[2, 3)")).toBe(1); // 2
    expect(n("[3, 5)")).toBe(1); // 5 (borne haute rattrapée par le dernier intervalle)
    expect(n("> 5")).toBe(1); // 6
  });
});

describe("repartition", () => {
  it("par tag : multi-tags comptés dans chaque tag, tri sommeR desc", () => {
    // t1 tags[A,B] R=2, t2 tags[A] R=−1, t3 tags[B] R=3
    // A : n=2, sommeR = 2−1 = 1 ; B : n=2, sommeR = 2+3 = 5 → tri desc : B, A
    const r = repartition(
      [longR(2, { tags: ["A", "B"] }), longR(-1, { tags: ["A"] }), longR(3, { tags: ["B"] })],
      "tag"
    );
    expect(r).toEqual([
      { cle: "B", n: 2, sommeR: 5 },
      { cle: "A", n: 2, sommeR: 1 },
    ]);
  });

  it("par symbol : agrégat par symbole, ouverts exclus", () => {
    // X : R=2 + R=3 = 5 (n=2) ; Y : R=−1 (n=1) ; ouvert exclu
    const r = repartition(
      [
        longR(2, { symbol: "X" }),
        longR(-1, { symbol: "Y" }),
        longR(3, { symbol: "X" }),
        trade({ symbol: "Z", sortie: null }),
      ],
      "symbol"
    );
    expect(r).toEqual([
      { cle: "X", n: 2, sommeR: 5 },
      { cle: "Y", n: 1, sommeR: -1 },
    ]);
  });
});
