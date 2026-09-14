import { describe, expect, it } from "vitest";
import {
  decouperCycles,
  statsCycle,
  mayerMultiple,
  HALVINGS,
  type PointCycle,
} from "./cycle";
import type { PointMetrique } from "./onchain/coinmetrics";

/** Un jour en millisecondes (les points Coin Metrics sont datés à 00:00 UTC). */
const JOUR = 86_400_000;

/**
 * Construit une série quotidienne synthétique à partir d'un halving : un point par jour
 * de `jourDebut` à `jourFin` inclus, dont le prix est donné par `prix(jour)`.
 */
function serieSynthetique(
  halvingMs: number,
  jourDebut: number,
  jourFin: number,
  prix: (jour: number) => number,
): PointMetrique[] {
  const points: PointMetrique[] = [];
  for (let j = jourDebut; j <= jourFin; j += 1) {
    points.push({ time: halvingMs + j * JOUR, value: prix(j) });
  }
  return points;
}

/** Récupère la série d'un cycle par son index de halving (1..4). */
function cycle(series: ReturnType<typeof decouperCycles>, index: number) {
  return series.find((s) => s.halvingIndex === index);
}

describe("HALVINGS", () => {
  it("expose les 4 dates de halving en UTC dans l'ordre chronologique", () => {
    expect(HALVINGS).toHaveLength(4);
    expect(HALVINGS[0]).toBe(Date.UTC(2012, 10, 28));
    expect(HALVINGS[1]).toBe(Date.UTC(2016, 6, 9));
    expect(HALVINGS[2]).toBe(Date.UTC(2020, 4, 11));
    expect(HALVINGS[3]).toBe(Date.UTC(2024, 3, 20));
  });
});

describe("decouperCycles", () => {
  it("pose l'indice 1 au jour 0 (halving) — base = prix au jour du halving", () => {
    // Cycle courant (H4) : prix linéaire 60 000 + 10×jour, base 60 000 au jour 0.
    const pts = serieSynthetique(HALVINGS[3]!, 0, 300, (j) => 60_000 + 10 * j);
    const c4 = cycle(decouperCycles(pts), 4);
    expect(c4).toBeDefined();
    expect(c4!.points[0]).toEqual({ jour: 0, indice: 1 });
    // Indice au jour 100 = (60 000 + 1000) / 60 000.
    const j100 = c4!.points.find((p) => p.jour === 100);
    expect(j100?.indice).toBeCloseTo(61_000 / 60_000, 6);
  });

  it("tronque un cycle passé à la veille du halving suivant (H3 : 1440 j → jour max 1439)", () => {
    // H3 (2020-05-11) → H4 (2024-04-20) = 1440 jours : avec 2000 jours de données, la
    // série s'arrête au jour 1439 — les points du cycle suivant n'y entrent jamais.
    const pts = serieSynthetique(HALVINGS[2]!, 0, 2000, (j) => 8000 + j);
    const c3 = cycle(decouperCycles(pts), 3);
    expect(c3).toBeDefined();
    const jours = c3!.points.map((p) => p.jour);
    expect(Math.max(...jours)).toBe(1439);
    expect(jours.every((j) => j >= 0 && j <= 1439)).toBe(true);
  });

  it("borne le cycle 3 au jour 1439 (un pic post-halving 2024 n'y entre pas)", () => {
    // H3 plat à 8 000 avec un pic à 73 000 au jour 1445 (après le halving du 2024-04-20) :
    // le pic est HORS cycle 3 (borné 1439) — son maximum reste celui des données internes.
    const pts = serieSynthetique(HALVINGS[2]!, 0, 2000, (j) => (j === 1445 ? 73_000 : 8_000 + j));
    const c3 = cycle(decouperCycles(pts), 3);
    expect(c3).toBeDefined();
    expect(Math.max(...c3!.points.map((p) => p.indice))).toBeCloseTo((8_000 + 1439) / 8_000, 6);
  });

  it("marque clos les cycles suivis d'un halving (H1..H3) et ouvert le cycle courant (H4)", () => {
    const pts = serieSynthetique(HALVINGS[0]!, 0, Math.round((HALVINGS[3]! - HALVINGS[0]!) / JOUR) + 10, () => 100);
    const series = decouperCycles(pts);
    expect(series.map((s) => [s.halvingIndex, s.clos])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, false],
    ]);
  });

  it("laisse le cycle courant se terminer à la dernière donnée (< 1500 j)", () => {
    const pts = serieSynthetique(HALVINGS[3]!, 0, 300, () => 50_000);
    const c4 = cycle(decouperCycles(pts), 4);
    expect(c4).toBeDefined();
    expect(Math.max(...c4!.points.map((p) => p.jour))).toBe(300);
  });

  it("utilise le premier point de jour ≥ 0 comme base quand le jour 0 exact manque", () => {
    // Données démarrant au jour 5 : base = prix au jour 5, indice(5) = 1.
    const pts = serieSynthetique(HALVINGS[3]!, 5, 100, (j) => 40_000 + 100 * j);
    const c4 = cycle(decouperCycles(pts), 4);
    expect(c4).toBeDefined();
    expect(c4!.points[0]?.jour).toBe(5);
    expect(c4!.points[0]?.indice).toBe(1);
  });

  it("ignore un halving sans donnée exploitable (aucune série produite)", () => {
    // Uniquement des points AVANT le premier halving → aucun cycle.
    const pts = serieSynthetique(HALVINGS[0]! - 400 * JOUR, 0, 100, () => 10);
    expect(decouperCycles(pts)).toHaveLength(0);
  });

  it("est NaN-safe : ignore les prix non finis et une base ≤ 0", () => {
    const pts: PointMetrique[] = [
      { time: HALVINGS[3]!, value: 0 }, // base 0 → cycle inexploitable
      { time: HALVINGS[3]! + JOUR, value: 100 },
    ];
    // Base au jour 0 = 0 → série ignorée (division impossible).
    expect(cycle(decouperCycles(pts), 4)).toBeUndefined();
  });
});

describe("statsCycle", () => {
  const serie: PointCycle[] = [
    { jour: 0, indice: 1 },
    { jour: 100, indice: 3 }, // sommet
    { jour: 200, indice: 1.5 }, // dernier point (courant)
  ];

  it("calcule top (indice/jour), état courant et drawdown depuis le top", () => {
    const s = statsCycle(serie);
    expect(s.topIndice).toBe(3);
    expect(s.topJour).toBe(100);
    expect(s.indiceCourant).toBe(1.5);
    expect(s.jourCourant).toBe(200);
    // (1.5 / 3 − 1) × 100 = −50 %.
    expect(s.drawdownDepuisTopPct).toBeCloseTo(-50, 6);
  });

  it("renvoie un drawdown nul quand le dernier point EST le sommet", () => {
    const s = statsCycle([
      { jour: 0, indice: 1 },
      { jour: 50, indice: 2 },
    ]);
    expect(s.topJour).toBe(50);
    expect(s.drawdownDepuisTopPct).toBe(0);
  });

  it("est NaN-safe sur une série vide", () => {
    const s = statsCycle([]);
    expect(Number.isNaN(s.topIndice)).toBe(true);
    expect(Number.isNaN(s.indiceCourant)).toBe(true);
  });
});

describe("statsCycle — cycle clos : sommet = plus haut précédant le repli maximal", () => {
  /** Interpolation linéaire de l'indice entre ancres `[jour, indice]` (un point par jour). */
  function formeCycle(ancres: readonly (readonly [number, number])[]): PointCycle[] {
    const points: PointCycle[] = [];
    for (let k = 0; k < ancres.length - 1; k += 1) {
      const [j0, v0] = ancres[k]!;
      const [j1, v1] = ancres[k + 1]!;
      for (let j = j0; j < j1; j += 1) points.push({ jour: j, indice: v0 + ((v1 - v0) * (j - j0)) / (j1 - j0) });
    }
    const [jf, vf] = ancres[ancres.length - 1]!;
    points.push({ jour: jf, indice: vf });
    return points;
  }

  // Forme du cycle 2020 : pic ×7,86 (j 546), creux ×1,83 (j 912), remontée ×8,51 (j 1402), fin ×7,42 (j 1439).
  const cycle2020 = formeCycle([
    [0, 1],
    [546, 7.86],
    [912, 1.83],
    [1402, 8.51],
    [1439, 7.42],
  ]);

  it("retient le pic avant le creux baissier, pas l'ATH pré-halving suivant", () => {
    const s = statsCycle(cycle2020, true);
    expect(s.topJour).toBe(546);
    expect(s.topIndice).toBeCloseTo(7.86, 10);
    // Dernier point au-dessus du sommet retenu : repli POSITIF (7,42 / 7,86 − 1).
    expect(s.drawdownDepuisTopPct).toBeCloseTo((7.42 / 7.86 - 1) * 100, 6);
    expect(s.jourCourant).toBe(1439);
  });

  it("cycle courant (clos = false, défaut) : sommet = maximum courant", () => {
    expect(statsCycle(cycle2020).topJour).toBe(1402);
    expect(statsCycle(cycle2020, false).topIndice).toBeCloseTo(8.51, 10);
  });

  it("série monotone croissante : sommet au dernier point (égalité des replis nuls → le plus récent)", () => {
    const s = statsCycle(formeCycle([[0, 1], [300, 4]]), true);
    expect(s.topJour).toBe(300);
    expect(s.topIndice).toBe(4);
    expect(s.drawdownDepuisTopPct).toBe(0);
  });

  it("égalité de replis maximaux : garde le pic du repli le plus récent", () => {
    const s = statsCycle(
      [
        { jour: 0, indice: 1 },
        { jour: 10, indice: 4 },
        { jour: 20, indice: 2 }, // repli −50 % depuis ×4
        { jour: 30, indice: 6 },
        { jour: 40, indice: 3 }, // repli −50 % depuis ×6 (même profondeur, plus récent)
      ],
      true,
    );
    expect(s.topJour).toBe(30);
    expect(s.topIndice).toBe(6);
  });

  it("ignore les indices non finis et reste NaN-safe sur une série vide", () => {
    const s = statsCycle(
      [
        { jour: 0, indice: Number.NaN },
        { jour: 1, indice: 1 },
        { jour: 2, indice: 3 },
        { jour: 3, indice: Number.NaN },
        { jour: 4, indice: 1.5 },
      ],
      true,
    );
    expect(s.topJour).toBe(2);
    expect(Number.isNaN(statsCycle([], true).topIndice)).toBe(true);
    expect(Number.isNaN(statsCycle([], true).topJour)).toBe(true);
  });

  it("PriceUSD réaliste : le Cycle 2020 culmine le 2021-11-08 et non le 2024-03-13", () => {
    // Interpolation log-linéaire quotidienne entre prix réels Coin Metrics (00:00 UTC).
    const ancres: [number, number][] = [
      [Date.UTC(2020, 4, 11), 8_600],
      [Date.UTC(2021, 10, 8), 67_541.76],
      [Date.UTC(2022, 10, 9), 15_758],
      [Date.UTC(2024, 2, 13), 73_081.58],
      [Date.UTC(2024, 3, 20), 64_000],
      [Date.UTC(2024, 4, 20), 67_000],
    ];
    const pts: PointMetrique[] = [];
    for (let k = 0; k < ancres.length - 1; k += 1) {
      const [t0, p0] = ancres[k]!;
      const [t1, p1] = ancres[k + 1]!;
      const n = Math.round((t1 - t0) / JOUR);
      for (let i = 0; i < n; i += 1) {
        pts.push({ time: t0 + i * JOUR, value: Math.exp(Math.log(p0) + ((Math.log(p1) - Math.log(p0)) * i) / n) });
      }
    }
    const c3 = cycle(decouperCycles(pts), 3)!;
    expect(c3.clos).toBe(true);
    const dateSommet = (clos: boolean) =>
      new Date(c3.halvingMs + statsCycle(c3.points, clos).topJour * JOUR).toISOString().slice(0, 10);
    expect(dateSommet(c3.clos)).toBe("2021-11-08");
    expect(statsCycle(c3.points, c3.clos).topJour).toBe(546);
    expect(statsCycle(c3.points, c3.clos).topIndice).toBeCloseTo(67_541.76 / 8_600, 6);
    // Sans la règle des cycles clos, l'ATH pré-halving 2024 (jour 1402) serait retenu.
    expect(dateSommet(false)).toBe("2024-03-13");
  });
});

describe("mayerMultiple", () => {
  it("renvoie null en dessous de 200 points", () => {
    const pts = serieSynthetique(HALVINGS[3]!, 0, 198, () => 100); // 199 points
    expect(pts).toHaveLength(199);
    expect(mayerMultiple(pts)).toBeNull();
  });

  it("calcule dernier prix / MM200 à partir de 200 points", () => {
    // 200 points constants à 100 → MM200 = 100, dernier = 100 → Mayer = 1.
    const plat = serieSynthetique(HALVINGS[3]!, 0, 199, () => 100);
    expect(plat).toHaveLength(200);
    expect(mayerMultiple(plat)).toBeCloseTo(1, 6);
  });

  it("n'utilise que les 200 derniers points pour la moyenne", () => {
    // 250 points : les 50 premiers à 1 (ignorés), les 200 derniers à 200 → Mayer = 1.
    const pts = serieSynthetique(HALVINGS[3]!, 0, 249, (j) => (j < 50 ? 1 : 200));
    expect(pts).toHaveLength(250);
    expect(mayerMultiple(pts)).toBeCloseTo(1, 6);
  });

  it("est NaN-safe : ignore un dernier prix non fini", () => {
    const pts = serieSynthetique(HALVINGS[3]!, 0, 199, () => 100);
    pts[pts.length - 1] = { time: pts[pts.length - 1]!.time, value: Number.NaN };
    expect(mayerMultiple(pts)).toBeNull();
  });
});
