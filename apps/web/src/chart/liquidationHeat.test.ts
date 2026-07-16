/**
 * Tests des fonctions PURES de la grille 2D de liquidations (bougie × bucket de prix).
 * Couvre : agrégation de deux liqs d'une même bougie/bucket en une cellule, séparation
 * long/short, intensité log-normalisée (croissante, 0→0, max→1), profil latéral par prix
 * sommé sur toutes les bougies, et les cas null (aucune bougie visible / aucune cellule).
 */
import { describe, it, expect, vi } from "vitest";

// liquidationHeat importe ./liquidationMarkers, qui appelle registerOverlay + importe
// ./drawing (klinecharts) et ../store/theme et s'abonne à des flux à l'import : on stub le
// tout pour importer les fonctions PURES en environnement Node (même stubs que
// liquidationMarkers.test.ts).
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("./drawing", () => ({ getActiveChart: () => null }));
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));
vi.mock("../data/liquidations", () => ({ subscribeLiquidations: () => () => {} }));
vi.mock("../data/coinalyze", () => ({ fetchLiquidationHistory: async () => [] }));
vi.mock("../data/daemon", () => ({
  liquidationsGet: async () => null,
  liquidationsPush: async () => false,
}));

import type { Candle } from "@axiom/types";
import type { LiqEvent } from "./liquidationMarkers";
import { couleurViridis } from "./liquidationMarkers";
import {
  cellSousCurseur,
  construireGrille,
  dimensionsGrilleVisible,
  intensiteLog,
  desequilibre,
  profilParPrix,
  cumulsAutourSpot,
  estFondClair,
  parseCssColor,
  couleurRampe,
  filtrerNiveauxDenses,
  dechevaucher,
  type LiqGrid,
} from "./liquidationHeat";

function candle(partial: Partial<Candle> & Pick<Candle, "time" | "close">): Candle {
  return { open: 0, high: 0, low: 0, volume: 0, ...partial };
}

function ev(partial: Partial<LiqEvent> & Pick<LiqEvent, "time" | "side" | "price" | "usd">): LiqEvent {
  return { qty: 1, venue: "test", ...partial };
}

describe("construireGrille", () => {
  it("agrège deux liqs de la même bougie/bucket en une cellule", () => {
    // 2 events dans la bougie 0 (time 0), même prix → 1 cellule, count 2, longUsd sommé.
    const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
    const events = [
      ev({ time: 1000, side: "long", price: 100, usd: 500 }),
      ev({ time: 1500, side: "long", price: 100, usd: 300 }),
    ];
    const grid = construireGrille(events, candles, 0, 2);
    expect(grid).not.toBeNull();
    expect(grid?.cells.size).toBe(1);
    const cell = [...(grid?.cells.values() ?? [])][0];
    expect(cell?.count).toBe(2);
    expect(cell?.longUsd).toBe(800);
    expect(cell?.shortUsd).toBe(0);
    expect(grid?.maxUsd).toBe(800);
  });

  it("sépare long et short dans la cellule", () => {
    const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
    const events = [
      ev({ time: 1000, side: "long", price: 100, usd: 500 }),
      ev({ time: 1500, side: "short", price: 100, usd: 200 }),
    ];
    const grid = construireGrille(events, candles, 0, 2);
    const cell = [...(grid?.cells.values() ?? [])][0];
    expect(grid?.cells.size).toBe(1);
    expect(cell?.count).toBe(2);
    expect(cell?.longUsd).toBe(500);
    expect(cell?.shortUsd).toBe(200);
    expect(grid?.maxUsd).toBe(700);
  });

  it("écarte les événements hors de la plage [from, to)", () => {
    // Bougies 0..2 ; on ne visualise que [1, 2) → seule la bougie 1 (time 60000) compte.
    const candles = [
      candle({ time: 0, close: 100 }),
      candle({ time: 60000, close: 100 }),
      candle({ time: 120000, close: 100 }),
    ];
    const events = [
      ev({ time: 1000, side: "long", price: 100, usd: 500 }), // bougie 0 → écarté
      ev({ time: 61000, side: "long", price: 100, usd: 300 }), // bougie 1 → gardé
      ev({ time: 121000, side: "long", price: 100, usd: 999 }), // bougie 2 → hors plage
    ];
    const grid = construireGrille(events, candles, 1, 2);
    expect(grid?.cells.size).toBe(1);
    const cell = [...(grid?.cells.values() ?? [])][0];
    expect(cell?.candleTime).toBe(60000);
    expect(cell?.longUsd).toBe(300);
  });

  it("renvoie null si aucune bougie visible ou aucune cellule", () => {
    const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
    // Plage vide → null.
    expect(construireGrille([], candles, 1, 1)).toBeNull();
    // Aucun événement → 0 cellule → null.
    expect(construireGrille([], candles, 0, 2)).toBeNull();
  });

  it("facteur de taille (granularité) multiplie la taille de bucket", () => {
    // close 100 → tailleBucket = 0,1. Deux prix (100,00 et 100,15) tombent dans des buckets
    // DISTINCTS à 0,1 (facteur 1) mais le MÊME à 0,2 (facteur 2 → regroupement plus grossier).
    const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
    const events = [
      ev({ time: 1000, side: "long", price: 100.0, usd: 100 }),
      ev({ time: 1500, side: "long", price: 100.15, usd: 100 }),
    ];
    const base = construireGrille(events, candles, 0, 2); // facteur par défaut = 1
    expect(base?.taille).toBeCloseTo(0.1, 9);
    expect(base?.cells.size).toBe(2);

    const grossier = construireGrille(events, candles, 0, 2, 2);
    expect(grossier?.taille).toBeCloseTo(0.2, 9);
    expect(grossier?.cells.size).toBe(1); // les deux prix fusionnent dans un bucket 0,2

    const fin = construireGrille(events, candles, 0, 2, 0.5);
    expect(fin?.taille).toBeCloseTo(0.05, 9);
    expect(fin?.cells.size).toBe(2); // buckets toujours distincts (encore plus fins)
  });
});

describe("dimensionsGrilleVisible", () => {
  /** Grille factice : une cellule par bucketIdx demandé (le temps/USD n'importe pas ici). */
  function grille(bucketIdxs: number[]): LiqGrid {
    const cells = new Map();
    for (const idx of bucketIdxs) {
      cells.set(`0:${idx}`, { candleTime: 0, bucketIdx: idx, longUsd: 1, shortUsd: 0, count: 1 });
    }
    return { cells, taille: 1, maxUsd: 1 };
  }

  it("renvoie colonnes = to − from et les bornes min/max des buckets présents", () => {
    expect(dimensionsGrilleVisible(grille([9, 5, 7]), 2, 5)).toEqual({
      colonnes: 3,
      bucketMin: 5,
      bucketMax: 9,
    });
  });

  it("bucket unique : bornes confondues", () => {
    expect(dimensionsGrilleVisible(grille([3]), 0, 1)).toEqual({
      colonnes: 1,
      bucketMin: 3,
      bucketMax: 3,
    });
  });

  it("null si plage vide ou grille sans cellule", () => {
    expect(dimensionsGrilleVisible(grille([1]), 3, 3)).toBeNull(); // to − from < 1
    expect(dimensionsGrilleVisible(grille([]), 0, 2)).toBeNull(); // aucune cellule
  });
});

describe("intensiteLog", () => {
  it("0→0, max→1, croissante", () => {
    expect(intensiteLog(0, 100)).toBe(0);
    expect(intensiteLog(100, 100)).toBe(1);
    expect(intensiteLog(10, 100)).toBeGreaterThan(10 / 100); // la log RELÈVE les petits niveaux
  });

  it("clampe hors [0,1] et renvoie 0 si maxUsd <= 0", () => {
    expect(intensiteLog(200, 100)).toBe(1); // usd > max → clampé à 1
    expect(intensiteLog(50, 0)).toBe(0); // max invalide → 0
    expect(intensiteLog(50, -10)).toBe(0);
  });
});

describe("desequilibre", () => {
  it("+1 = 100 % shorts, -1 = 100 % longs, 0 à l'équilibre", () => {
    expect(desequilibre(0, 100)).toBe(1);
    expect(desequilibre(100, 0)).toBe(-1);
    expect(desequilibre(50, 50)).toBe(0);
  });

  it("proportionnel à la part dominante (∈ [-1, +1])", () => {
    expect(desequilibre(25, 75)).toBe(0.5); // shorts dominants aux 3/4
    expect(desequilibre(75, 25)).toBe(-0.5); // longs dominants aux 3/4
    expect(desequilibre(90, 10)).toBeCloseTo(-0.8, 10);
  });

  it("total nul ou invalide → 0 (cellule neutre)", () => {
    expect(desequilibre(0, 0)).toBe(0);
    expect(desequilibre(NaN, 100)).toBe(0);
  });
});

describe("cellSousCurseur", () => {
  // close 100 → taille de bucket 0,1 ; prix 100 → bucketIdx 1000. Deux liqs (long + short)
  // dans la bougie 0 (time 0), aucune dans la bougie 1 (time 60000).
  const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
  const events = [
    ev({ time: 1000, side: "long", price: 100, usd: 500 }),
    ev({ time: 1500, side: "short", price: 100, usd: 200 }),
  ];
  const grid = construireGrille(events, candles, 0, 2)!;

  it("retrouve la cellule pour un timestamp dans la bougie et une valeur dans le bucket", () => {
    const cell = cellSousCurseur(grid, candles, 30000, 100);
    expect(cell).not.toBeNull();
    expect(cell?.candleTime).toBe(0);
    expect(cell?.longUsd).toBe(500);
    expect(cell?.shortUsd).toBe(200);
    expect(cell?.count).toBe(2);
  });

  it("renvoie null hors grille (bougie ou bucket sans liquidation)", () => {
    // Bougie 1 (time 60000) : aucune liquidation → pas de cellule.
    expect(cellSousCurseur(grid, candles, 90000, 100)).toBeNull();
    // Valeur dans un bucket vide (prix éloigné) → pas de cellule.
    expect(cellSousCurseur(grid, candles, 30000, 200)).toBeNull();
  });

  it("renvoie null si timestamp/value indéfini ou timestamp hors des bougies", () => {
    expect(cellSousCurseur(grid, candles, undefined, 100)).toBeNull();
    expect(cellSousCurseur(grid, candles, 30000, undefined)).toBeNull();
    expect(cellSousCurseur(grid, candles, -5, 100)).toBeNull(); // avant la 1re bougie
  });
});

describe("profilParPrix", () => {
  it("somme les cellules d'un même bucket sur toutes les bougies", () => {
    // Même prix (donc même bucketIdx) mais 2 bougies distinctes → 2 cellules, 1 bucket.
    const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
    const events = [
      ev({ time: 1000, side: "long", price: 100, usd: 500 }), // bougie 0
      ev({ time: 61000, side: "short", price: 100, usd: 200 }), // bougie 1
    ];
    const grid = construireGrille(events, candles, 0, 2);
    expect(grid?.cells.size).toBe(2);
    const profil = profilParPrix(grid!);
    expect(profil.size).toBe(1);
    const [entree] = [...profil.values()];
    expect(entree?.longUsd).toBe(500);
    expect(entree?.shortUsd).toBe(200);
  });
});

describe("cumulsAutourSpot", () => {
  it("répartit buckets réels (par prix centre) et niveaux estimés (par price) de part et d'autre du spot", () => {
    // taille 10, spot 100 : bucket 12 (centre 125) au-dessus, bucket 5 (centre 55) en-dessous ;
    // niveau 130 au-dessus, niveau 80 en-dessous, niveau exactement à 100 → en-dessous (<=).
    const profil = new Map([
      [12, { longUsd: 300, shortUsd: 100 }],
      [5, { longUsd: 50, shortUsd: 150 }],
    ]);
    const niveaux = [
      { price: 130, poidsUsd: 1000 },
      { price: 80, poidsUsd: 700 },
      { price: 100, poidsUsd: 5 },
    ];
    expect(cumulsAutourSpot(profil, 10, niveaux, 100)).toEqual({
      reelAuDessus: 400,
      reelEnDessous: 200,
      estAuDessus: 1000,
      estEnDessous: 705,
    });
  });

  it("spot exactement sur un centre de bucket → le bucket compte en-dessous (<=)", () => {
    // Bucket 10 : centre (10 + 0.5) × 10 = 105 = spot → en-dessous.
    const profil = new Map([[10, { longUsd: 100, shortUsd: 0 }]]);
    expect(cumulsAutourSpot(profil, 10, [], 105)).toEqual({
      reelAuDessus: 0,
      reelEnDessous: 100,
      estAuDessus: 0,
      estEnDessous: 0,
    });
  });

  it("profil et niveaux vides → zéros", () => {
    expect(cumulsAutourSpot(new Map(), 10, [], 100)).toEqual({
      reelAuDessus: 0,
      reelEnDessous: 0,
      estAuDessus: 0,
      estEnDessous: 0,
    });
  });

  it("ignore les niveaux estimés au poids non fini (même garde que le tracé)", () => {
    const niveaux = [
      { price: 130, poidsUsd: Number.NaN },
      { price: 130, poidsUsd: 1000 },
    ];
    expect(cumulsAutourSpot(new Map(), 10, niveaux, 100).estAuDessus).toBe(1000);
  });
});

describe("parseCssColor", () => {
  it("parse #rrggbb et #rgb en tuple RVB", () => {
    expect(parseCssColor("#ef4444")).toEqual([239, 68, 68]);
    expect(parseCssColor("#fff")).toEqual([255, 255, 255]);
    expect(parseCssColor("#0a0a0a")).toEqual([10, 10, 10]);
  });

  it("parse rgb()/rgba() (espaces et alpha tolérés)", () => {
    expect(parseCssColor("rgb(16, 185, 129)")).toEqual([16, 185, 129]);
    expect(parseCssColor("rgba(239,68,68,0.5)")).toEqual([239, 68, 68]);
  });

  it("chaîne non reconnue → null (var() non résolu, hex invalide, vide)", () => {
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("bidon")).toBeNull();
    expect(parseCssColor("#12")).toBeNull();
    expect(parseCssColor("var(--up)")).toBeNull();
  });
});

describe("estFondClair", () => {
  it("détecte les fonds clairs vs sombres (#hex 6 et 3 chiffres)", () => {
    expect(estFondClair("#fff5fb")).toBe(true); // thème Cute (rose quasi blanc)
    expect(estFondClair("#fff")).toBe(true);
    expect(estFondClair("#0a0a0a")).toBe(false); // thème Dark
    expect(estFondClair("#000")).toBe(false);
    expect(estFondClair("#070b1f")).toBe(false); // thème Midnight (bleu nuit)
  });

  it("parse la notation rgb()/rgba()", () => {
    expect(estFondClair("rgb(255, 245, 251)")).toBe(true);
    expect(estFondClair("rgba(10, 10, 10, 1)")).toBe(false);
  });

  it("chaîne absente/invalide → false (sombre par défaut, le cas majoritaire)", () => {
    expect(estFondClair("")).toBe(false);
    expect(estFondClair("bidon")).toBe(false);
    expect(estFondClair("#12")).toBe(false);
  });
});

describe("couleurRampe", () => {
  it("fond sombre : rampe viridis directe (jaune = max)", () => {
    expect(couleurRampe(0, false)).toEqual(couleurViridis(0));
    expect(couleurRampe(0.3, false)).toEqual(couleurViridis(0.3));
    expect(couleurRampe(1, false)).toEqual(couleurViridis(1));
  });

  it("fond clair : rampe inversée (violet foncé = max, contraste rétabli)", () => {
    expect(couleurRampe(1, true)).toEqual(couleurViridis(0)); // max → violet foncé
    expect(couleurRampe(0, true)).toEqual(couleurViridis(1)); // min → jaune pâle
    expect(couleurRampe(0.25, true)).toEqual(couleurViridis(0.75));
  });
});

describe("filtrerNiveauxDenses", () => {
  it("ne garde que les buckets ≥ seuil × max, triés par poids décroissant", () => {
    const b = [{ poids: 100 }, { poids: 20 }, { poids: 14 }, { poids: 5 }];
    // max = 100, seuil 0.15 → borne 15 : 14 et 5 exclus.
    expect(filtrerNiveauxDenses(b, 0.15, 30).map((x) => x.poids)).toEqual([100, 20]);
  });

  it("conserve le poids EXACTEMENT au seuil (>=)", () => {
    const b = [{ poids: 100 }, { poids: 15 }];
    expect(filtrerNiveauxDenses(b, 0.15, 30).map((x) => x.poids)).toEqual([100, 15]);
  });

  it("plafonne aux maxN plus lourds", () => {
    const b = Array.from({ length: 40 }, (_, i) => ({ poids: 100 - i }));
    const r = filtrerNiveauxDenses(b, 0, 30);
    expect(r.length).toBe(30);
    expect(r[0]?.poids).toBe(100);
    expect(r[29]?.poids).toBe(71);
  });

  it("liste vide → vide", () => {
    expect(filtrerNiveauxDenses([], 0.15, 30)).toEqual([]);
  });
});

describe("dechevaucher", () => {
  it("garde le plus lourd et écarte les voisins trop proches", () => {
    const items = [
      { y: 100, poids: 10 },
      { y: 105, poids: 5 }, // trop proche de y=100 (Δ5 < 15) → écarté
      { y: 200, poids: 8 },
    ];
    expect(dechevaucher(items, 15)).toEqual([
      { y: 100, poids: 10 },
      { y: 200, poids: 8 },
    ]);
  });

  it("conserve les items suffisamment espacés (ordre poids décroissant)", () => {
    const items = [
      { y: 0, poids: 1 },
      { y: 20, poids: 2 },
      { y: 40, poids: 3 },
    ];
    expect(dechevaucher(items, 15).map((x) => x.y)).toEqual([40, 20, 0]);
  });

  it("compare à TOUS les retenus, pas seulement au précédent", () => {
    const items = [
      { y: 0, poids: 10 },
      { y: 30, poids: 9 },
      { y: 10, poids: 8 }, // Δ à y=0 vaut 10 < 15 → écarté même si Δ à y=30 = 20
    ];
    expect(dechevaucher(items, 15).map((x) => x.y)).toEqual([0, 30]);
  });

  it("liste vide → vide", () => {
    expect(dechevaucher([], 15)).toEqual([]);
  });
});
