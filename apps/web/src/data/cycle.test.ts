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

  it("ne laisse pas l'ATH pré-halving suivant contaminer le sommet d'un cycle passé", () => {
    // H3 plat à 8 000 avec un pic à 73 000 au jour 1445 (= mars 2024, cycle suivant) :
    // le pic est HORS cycle 3 (borné 1439) — son top reste celui des données internes.
    const pts = serieSynthetique(HALVINGS[2]!, 0, 2000, (j) => (j === 1445 ? 73_000 : 8_000 + j));
    const c3 = cycle(decouperCycles(pts), 3);
    expect(c3).toBeDefined();
    expect(Math.max(...c3!.points.map((p) => p.indice))).toBeCloseTo((8_000 + 1439) / 8_000, 6);
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
