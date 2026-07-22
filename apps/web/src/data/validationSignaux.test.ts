/**
 * Tests de l'event study (data/validationSignaux.ts) — fixtures déterministes,
 * valeurs attendues justifiées en commentaire.
 */
import { describe, expect, it } from "vitest";
import type { PointSerie } from "../lib/referentiel";
import {
  etudeEvenements,
  evenementsDivergenceRsi,
  evenementsFundingExtreme,
  finaliserEtude,
  fusionnerEtudes,
  indexEntree,
} from "./validationSignaux";

// ─────────────────────────── Funding : hystérésis ───────────────────────────

describe("evenementsFundingExtreme — un épisode extrême = UN événement", () => {
  // 60 points alternés ±0.0001 (fenêtre stable), puis :
  //  i=60 : 0.002  → z = +20 → ÉVÉNEMENT baissier (crowded long), désarmé ;
  //  i=61 : 0.002  → toujours ≥ seuil mais désarmé → rien ;
  //  i=62 : 0.0001 → |z| < 2 → réarmé ;
  //  i=63 : −0.002 → z très négatif → ÉVÉNEMENT haussier.
  const hist: PointSerie[] = [];
  for (let i = 0; i < 30; i++) hist.push({ t: hist.length * 1000, v: 0.0001 }, { t: (hist.length + 1) * 1000, v: -0.0001 });
  for (const v of [0.002, 0.002, 0.0001, -0.002]) hist.push({ t: hist.length * 1000, v });

  it("émet un événement au franchissement, pas un par point au-dessus du seuil", () => {
    const evs = evenementsFundingExtreme(hist);
    expect(evs).toHaveLength(2);
    expect(evs[0]).toEqual({ t: 60_000, direction: "baissier" });
    expect(evs[1]).toEqual({ t: 63_000, direction: "haussier" });
  });

  it("historique trop court (fenêtre incomplète) : aucun événement", () => {
    expect(evenementsFundingExtreme(hist.slice(0, 50))).toEqual([]);
  });
});

// ─────────────────────────── Divergence : détection incrémentale dédupliquée ───────────────────────────

// Deux pivots hauts de prix : 110 (idx 10) puis 112 (idx 20) — même fixture que signaux.test.
const CLOSES_HH = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 105, 106,
  107, 108, 109, 112, 111, 110, 109, 108, 107, 106,
];

function rsiAvec(r10: number, r20: number): number[] {
  const rsi = new Array<number>(27).fill(50);
  rsi[10] = r10;
  rsi[20] = r20;
  return rsi;
}

describe("evenementsDivergenceRsi", () => {
  const DUREE = 4;
  const times = CLOSES_HH.map((_, i) => i * DUREE);

  it("détecte à la CONFIRMATION du pivot (k bougies après) et dédoublonne les barres suivantes", () => {
    const evs = evenementsDivergenceRsi(CLOSES_HH, rsiAvec(70, 62), times, DUREE);
    // Pivot final idx 20 confirmé au préfixe de longueur 24 (voisins 21-23 requis) :
    // événement daté de la clôture de la barre 23 (t = 23×4 + 4 = 96), une seule fois
    // malgré 3 barres supplémentaires où la divergence reste visible.
    expect(evs).toEqual([{ t: 96, direction: "baissier" }]);
  });

  it("RSI qui confirme le prix : aucun événement", () => {
    expect(evenementsDivergenceRsi(CLOSES_HH, rsiAvec(62, 70), times, DUREE)).toEqual([]);
  });
});

// ─────────────────────────── indexEntree ───────────────────────────

describe("indexEntree — dernière barre CLÔTURÉE à l'instant t", () => {
  const times = [0, 4, 8, 12];

  it("t sur une frontière : la barre qui clôt exactement à t", () => {
    // À t=8, la barre [4,8) vient de clore → index 1 (pas la barre [8,12) en cours).
    expect(indexEntree(times, 8, 4)).toBe(1);
  });

  it("t en milieu de barre : la dernière barre close avant t", () => {
    expect(indexEntree(times, 9, 4)).toBe(1);
  });

  it("t avant toute clôture : −1", () => {
    expect(indexEntree(times, 3, 4)).toBe(-1);
  });
});

// ─────────────────────────── Étude d'événements ───────────────────────────

describe("etudeEvenements — rendements signés vs drift signé", () => {
  // Série montante +10 %/barre : drift inconditionnel à horizon 1 = +10 %.
  const closes = [100, 110, 121, 133.1];
  const times = [0, 1, 2, 3];
  const DUREE = 1;

  it("haussier suit le drift (réussite), baissier le subit (échec) — la référence suit le signe", () => {
    const sommes = etudeEvenements(
      [
        { t: 1, direction: "haussier" }, // entrée close[0]=100 → +10 % signé +10 (réussite)
        { t: 2, direction: "baissier" }, // entrée close[1]=110 → +10 % signé −10 (échec)
      ],
      times,
      closes,
      1,
      DUREE,
    );
    expect(sommes.n).toBe(2);
    expect(sommes.reussites).toBe(1);
    expect(sommes.sommePct).toBeCloseTo(0, 6); // +10 − 10
    expect(sommes.sommeBaselinePct).toBeCloseTo(0, 6); // +10 (drift) − 10 (drift signé)
  });

  it("événement sans horizon mesurable (trop tardif) : écarté", () => {
    const sommes = etudeEvenements([{ t: 4, direction: "haussier" }], times, closes, 1, DUREE);
    expect(sommes.n).toBe(0);
  });
});

describe("fusionnerEtudes / finaliserEtude", () => {
  it("poole les sommes puis dérive taux et moyennes", () => {
    const stats = finaliserEtude(
      fusionnerEtudes([
        { n: 3, reussites: 2, sommePct: 9, sommeBaselinePct: 3 },
        { n: 1, reussites: 1, sommePct: 5, sommeBaselinePct: 1 },
      ]),
    );
    expect(stats).toEqual({ n: 4, tauxReussitePct: 75, moyennePct: 3.5, baselineMoyennePct: 1 });
  });

  it("aucun événement : null (cellule non affichable)", () => {
    expect(finaliserEtude({ n: 0, reussites: 0, sommePct: 0, sommeBaselinePct: 0 })).toBeNull();
  });
});
