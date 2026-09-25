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
  // Couche LIQHL : liquidationHeat importe data/hyperliquidLiq, qui tire ces deux helpers.
  hlLiqLevelsGet: async () => null,
  daemonSupporteHl: () => false,
  // Heatmap HL : data/hyperliquidHeat (module paresseux importé par le contrôleur).
  hlLiqHeatGet: async () => null,
  kvPut: async () => null,
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
  couleurRampeArrets,
  rampePourTheme,
  teinteEstPourTheme,
  alphaFadeIn,
  attenuationFootprint,
  filtrerNiveauxDenses,
  libelleLegendeEst,
  filtrerNiveauxHl,
  clusteriserNiveauxHl,
  partitionnerClustersHl,
  libelleBordHl,
  cumulsHl,
  libelleLegendeHl,
  raisonCotationHl,
  yLibreSousObstacles,
  bandeRepereHl,
  yRepereBasHl,
  filtrerHorsBandes,
  maxUsdBuckets,
  pasBougieMs,
  construireGrilleHl,
  compterTrous,
  libelleLegendeHlHeat,
  dechevaucher,
  bullesDepuisGrille,
  liqFlashStore,
  flasherNiveau,
  type ClusterHlPlace,
  type HorsEcranHl,
  type LiqGrid,
} from "./liquidationHeat";
// Formateurs RÉELS (purs, sans DOM) : les libellés attendus sont construits avec eux plutôt
// que recopiés à la main — le test suit la convention de format du dépôt.
import { formatPrice, formatUsd } from "../lib/format";

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

  it("renseigne dernierTime = max des time des événements de la cellule", () => {
    // 3 events même bougie/bucket, temps désordonnés → dernierTime = le plus grand (fade-in).
    const candles = [candle({ time: 0, close: 100 }), candle({ time: 60000, close: 100 })];
    const events = [
      ev({ time: 1000, side: "long", price: 100, usd: 500 }),
      ev({ time: 1500, side: "long", price: 100, usd: 300 }),
      ev({ time: 1200, side: "short", price: 100, usd: 100 }),
    ];
    const cell = [...(construireGrille(events, candles, 0, 2)?.cells.values() ?? [])][0];
    expect(cell?.dernierTime).toBe(1500);
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

  it("bornes visibles : INTERSECTE la plage des buckets présents avec [bucketMin, bucketMax]", () => {
    // Présents 5..9 ; seule la bande visible est allouée dans le petit canvas.
    expect(dimensionsGrilleVisible(grille([9, 5, 7]), 0, 2, { bucketMin: 6, bucketMax: 20 })).toEqual({
      colonnes: 2,
      bucketMin: 6,
      bucketMax: 9,
    });
    expect(dimensionsGrilleVisible(grille([9, 5, 7]), 0, 2, { bucketMin: 0, bucketMax: 8 })).toEqual({
      colonnes: 2,
      bucketMin: 5,
      bucketMax: 8,
    });
    // Bornes incluses : une bande d'un seul bucket reste une intersection non vide.
    expect(dimensionsGrilleVisible(grille([9, 5, 7]), 0, 2, { bucketMin: 9, bucketMax: 9 })).toEqual({
      colonnes: 2,
      bucketMin: 9,
      bucketMax: 9,
    });
  });

  it("bornes visibles : une aberration lointaine ne dimensionne plus le canvas", () => {
    // BTC ~110 k (bucket 100 $) + un niveau à 27 M$ (bucket 270 000) : sans bornes, 268 901
    // lignes ; avec les bornes de l'écran, seule la bande visible compte.
    const d = dimensionsGrilleVisible(grille([1_100, 1_101, 270_000]), 0, 1, { bucketMin: 1_000, bucketMax: 1_200 });
    expect(d).toEqual({ colonnes: 1, bucketMin: 1_100, bucketMax: 1_200 });
  });

  it("bornes visibles : intersection VIDE → null (repli rects, rien à peindre à l'écran)", () => {
    expect(dimensionsGrilleVisible(grille([5, 9]), 0, 2, { bucketMin: 10, bucketMax: 20 })).toBeNull();
    expect(dimensionsGrilleVisible(grille([5, 9]), 0, 2, { bucketMin: 0, bucketMax: 4 })).toBeNull();
  });
});

describe("maxUsdBuckets — normalisation sur les buckets VISIBLES", () => {
  /** Grille : [bucketIdx, bougie, total] → une cellule (total réparti long/short 50/50). */
  function grille(cellules: Array<[number, number, number]>): LiqGrid {
    const cells = new Map();
    let maxUsd = 0;
    for (const [idx, t, total] of cellules) {
      cells.set(`${t}:${idx}`, { candleTime: t, bucketIdx: idx, longUsd: total / 2, shortUsd: total / 2, count: 1 });
      maxUsd = Math.max(maxUsd, total);
    }
    return { cells, taille: 1, maxUsd };
  }

  it("max des totaux (long + short) des CELLULES dont le bucket ∈ [min, max] (bornes incluses)", () => {
    const g = grille([
      [10, 0, 100],
      [12, 0, 300],
      [12, 60, 250], // même bucket, autre bougie : max par CELLULE, pas somme par bucket
      [20, 0, 9_000], // hors bande visible : n'écrase plus l'échelle
    ]);
    expect(maxUsdBuckets(g, 10, 12)).toBe(300);
    expect(maxUsdBuckets(g, 12, 12)).toBe(300);
    expect(maxUsdBuckets(g, 10, 10)).toBe(100);
    expect(maxUsdBuckets(g, 10, 20)).toBe(9_000);
  });

  it("aucune cellule dans la bande (ou grille vide) → 0", () => {
    expect(maxUsdBuckets(grille([[10, 0, 100]]), 11, 19)).toBe(0);
    expect(maxUsdBuckets(grille([]), 0, 100)).toBe(0);
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

describe("couleurRampeArrets", () => {
  const R: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 0],
    [10, 20, 30],
    [100, 200, 255],
  ];
  it("interpole linéairement entre arrêts (extrêmes + arrêt du milieu)", () => {
    expect(couleurRampeArrets(0, R)).toEqual([0, 0, 0]);
    expect(couleurRampeArrets(1, R)).toEqual([100, 200, 255]);
    expect(couleurRampeArrets(0.5, R)).toEqual([10, 20, 30]); // arrêt central pile
    expect(couleurRampeArrets(0.25, R)).toEqual([5, 10, 15]); // mi-chemin arrêt 0 → 1
  });
  it("clampe t hors [0,1]", () => {
    expect(couleurRampeArrets(-1, R)).toEqual([0, 0, 0]);
    expect(couleurRampeArrets(2, R)).toEqual([100, 200, 255]);
  });
  it("sur les arrêts VIRIDIS, équivaut à couleurViridis", () => {
    const V = rampePourTheme("dark", false); // = VIRIDIS
    for (const t of [0, 0.3, 0.5, 0.75, 1]) {
      expect(couleurRampeArrets(t, V)).toEqual(couleurViridis(t));
    }
  });
});

describe("rampePourTheme", () => {
  it("dark et aurora → viridis direct (jaune = max)", () => {
    for (const th of ["dark", "aurora"]) {
      expect(couleurRampeArrets(0, rampePourTheme(th, false))).toEqual(couleurViridis(0));
      expect(couleurRampeArrets(1, rampePourTheme(th, false))).toEqual(couleurViridis(1));
    }
  });
  it("cute et tout thème à fond clair → viridis inversé", () => {
    expect(couleurRampeArrets(1, rampePourTheme("cute", false))).toEqual(couleurViridis(0)); // max → violet
    expect(couleurRampeArrets(0, rampePourTheme("cute", false))).toEqual(couleurViridis(1)); // min → jaune
    // thème inconnu à fond clair : même repli inversé.
    expect(couleurRampeArrets(1, rampePourTheme("inconnu", true))).toEqual(couleurViridis(0));
  });
  it("thème inconnu à fond sombre → viridis direct (repli)", () => {
    expect(couleurRampeArrets(1, rampePourTheme("inconnu", false))).toEqual(couleurViridis(1));
  });
  it("bloomberg → brun sombre (distinct du fond) vers ambre saturé", () => {
    const r = rampePourTheme("bloomberg", false);
    expect(couleurRampeArrets(0, r)).toEqual([36, 28, 14]); // arrêt 0 éclairci (distinct du noir pur)
    expect(couleurRampeArrets(1, r)).toEqual([255, 196, 0]); // ambre saturé
  });
  it("matrix → vert sombre (distinct du fond) vers vert néon", () => {
    const r = rampePourTheme("matrix", false);
    expect(couleurRampeArrets(0, r)).toEqual([14, 36, 20]); // arrêt 0 éclairci (distinct du noir pur)
    expect(couleurRampeArrets(1, r)).toEqual([91, 255, 143]);
  });
});

describe("teinteEstPourTheme — la teinte EST contraste avec la rampe du thème", () => {
  it("bloomberg (rampe ambre) : teinte froide, PAS l'orange", () => {
    expect(teinteEstPourTheme("bloomberg")).toEqual([96, 165, 250]);
  });
  it("matrix (rampe verte) et défaut (viridis) : orange", () => {
    expect(teinteEstPourTheme("matrix")).toEqual([245, 158, 11]);
    expect(teinteEstPourTheme("dark")).toEqual([245, 158, 11]);
    expect(teinteEstPourTheme("aurora")).toEqual([245, 158, 11]);
  });
});

describe("alphaFadeIn", () => {
  // Signature : (alphaNominal, dernierTime, tsDemarrage, bumpTs, now).
  it("cellule fraîche à age local 0 → flash plein (alpha ≈ 1)", () => {
    // dernierTime 1000 > tsDemarrage 500 et dans la fenêtre du bump ; now = bumpTs → age 0.
    expect(alphaFadeIn(0.2, 1000, 500, 1000, 1000)).toBeCloseTo(1, 9);
  });
  it("fondu linéaire sur l'horloge LOCALE (now − bumpTs) puis retour au nominal à DUREE_FADE (400 ms)", () => {
    expect(alphaFadeIn(0.2, 1000, 500, 1000, 1200)).toBeCloseTo(0.6, 9); // age local 200 → 0.2 + 0.8×0.5
    expect(alphaFadeIn(0.2, 1000, 500, 1000, 1400)).toBe(0.2); // age local 400 → nominal (borne exclue)
    expect(alphaFadeIn(0.2, 1000, 500, 1000, 2000)).toBe(0.2); // bien après → nominal
  });
  it("tolère la latence WS : événement en retard de 2 s (< fenêtre 5 s) flashe quand même", () => {
    // dernierTime 8000 mais bumpTs 10000 (2 s de latence) : l'âge EXCHANGE (2 s) dépasserait
    // DUREE_FADE — le bug corrigé — mais l'animation suit bumpTs → flash plein à now = bumpTs.
    expect(alphaFadeIn(0.2, 8000, 500, 10000, 10000)).toBeCloseTo(1, 9);
    // Le fondu retombe sur l'horloge locale, indépendamment de l'âge exchange.
    expect(alphaFadeIn(0.2, 8000, 500, 10000, 10200)).toBeCloseTo(0.6, 9);
  });
  it("hors fenêtre de fraîcheur (latence > 5 s) → aucun boost", () => {
    // dernierTime 4000 <= bumpTs 10000 − 5000 : trop vieux pour être « du » bump → nominal.
    expect(alphaFadeIn(0.2, 4000, 500, 10000, 10000)).toBe(0.2);
  });
  it("événement antérieur au démarrage (seed) → aucun boost", () => {
    expect(alphaFadeIn(0.2, 400, 500, 450, 450)).toBe(0.2); // dernierTime <= tsDemarrage
  });
  it("cellule sans dernierTime → nominal", () => {
    expect(alphaFadeIn(0.2, undefined, 500, 1000, 1000)).toBe(0.2);
  });
});

describe("attenuationFootprint", () => {
  it("divise l'alpha par 2 quand le footprint est actif", () => {
    expect(attenuationFootprint(0.4, true)).toBeCloseTo(0.2, 6);
    expect(attenuationFootprint(0.4, false)).toBe(0.4);
  });
  it("renvoie l'alpha intact quand le footprint est inactif (identité)", () => {
    expect(attenuationFootprint(0.15, false)).toBe(0.15);
    expect(attenuationFootprint(0.55, false)).toBe(0.55);
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

describe("liqFlashStore / flasherNiveau (lien feed→chart)", () => {
  it("pose le prix et l'échéance à Date.now() + 1500 ms", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      flasherNiveau(123.45);
      expect(liqFlashStore.getState()).toMatchObject({ price: 123.45, jusqua: 11_500 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("expire après 1,5 s (Date.now() ≥ jusqua) et un nouveau clic re-pose le flash", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      flasherNiveau(100);
      // Juste avant l'échéance : le flash est encore actif (même prédicat que le rendu).
      vi.setSystemTime(11_499);
      expect(Date.now() < liqFlashStore.getState().jusqua).toBe(true);
      // À l'échéance : expiré (le rendu ne dessine plus rien).
      vi.setSystemTime(11_500);
      expect(Date.now() < liqFlashStore.getState().jusqua).toBe(false);
      // Nouveau clic : le prix et l'échéance sont remplacés.
      flasherNiveau(200);
      expect(liqFlashStore.getState()).toMatchObject({ price: 200, jusqua: 13_000 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("libelleLegendeEst — la couche EST active n'est jamais muette", () => {
  it("niveaux présents → libellé nominal (garde-fou « approximation »)", () => {
    expect(libelleLegendeEst("BTCUSDT", true, 12)).toBe(
      "Niveaux ESTIMÉS (modèle levier — approximation)",
    );
  });

  it("OI vide → raison EXPLICITE avec le symbole du chart", () => {
    // Bug LIQEST muet : hors perp Binance (Coinbase/Kraken/MEXC), la source d'OI ne
    // renvoyait rien → couche ON mais indistinguable d'une couche OFF.
    expect(libelleLegendeEst("BTC-USD", false, 0)).toBe("Niveaux ESTIMÉS — OI indisponible (BTC-USD)");
  });

  it("OI présent mais aucun niveau actif → « tous consommés »", () => {
    expect(libelleLegendeEst("BTCUSDT", true, 0)).toBe("Niveaux ESTIMÉS — tous consommés");
  });
});

// ─────────────── Niveaux de liquidation RÉELS Hyperliquid (couche LIQHL) ───────────────

/** Niveau HL minimal pour les fonctions de rendu (px + side + montant). */
function nhl(px: number, side: "long" | "short", valueUsd: number) {
  return { px, side, valueUsd };
}

describe("filtrerNiveauxHl — filtre de VALIDITÉ seulement (plus de fenêtre autour du prix)", () => {
  it("garde TOUS les niveaux valides, quelle que soit leur distance au prix", () => {
    // Mesure du 25/09/2026 : la fenêtre ±40 % écartait 55 % du notionnel BTC (ex. un short
    // de 238 M$ à +57 %). Le hors-écran est désormais RÉSUMÉ en bord, pas jeté.
    const out = filtrerNiveauxHl([
      nhl(36_000, "long", 500_000),
      nhl(132_743, "short", 238_000_000), // +57 % d'un prix à ~84 500
      nhl(84_001, "short", 500_000),
    ]);
    expect(out.map((n) => n.px)).toEqual([36_000, 132_743, 84_001]);
  });

  it("un niveau à 27 M$ (aberration de marge croisée, ~320× le prix) est CONSERVÉ", () => {
    // Plus d'écrasement d'échelle : la normalisation se fait sur les clusters VISIBLES.
    const out = filtrerNiveauxHl([nhl(27_000_000, "short", 50_000), nhl(59_000, "long", 1e6)]);
    expect(out.map((n) => n.px)).toEqual([27_000_000, 59_000]);
  });

  it("plus de plancher de notionnel : un niveau de 9 999 $ est gardé", () => {
    expect(filtrerNiveauxHl([nhl(59_000, "long", 9_999)]).map((n) => n.valueUsd)).toEqual([9_999]);
  });

  it("écarte px ≤ 0 ou non fini, et valueUsd ≤ 0 ou non fini", () => {
    const out = filtrerNiveauxHl([
      nhl(0, "long", 1e6),
      nhl(-5, "long", 1e6),
      nhl(Number.NaN, "long", 1e6),
      nhl(Number.POSITIVE_INFINITY, "short", 1e6),
      nhl(59_000, "long", 0),
      nhl(59_000, "long", -1),
      nhl(59_000, "long", Number.NaN),
      nhl(59_000, "short", Number.POSITIVE_INFINITY),
      nhl(61_000, "short", 2e6), // seul valide
    ]);
    expect(out.map((n) => n.px)).toEqual([61_000]);
  });

  it("préserve le type d'entrée (champs supplémentaires conservés, mêmes objets)", () => {
    const riche = { px: 59_000, side: "long" as const, valueUsd: 1e6, addr: "0xabc" };
    const out = filtrerNiveauxHl([riche]);
    expect(out[0]).toBe(riche);
    expect(out[0]?.addr).toBe("0xabc");
  });
});

describe("clusteriserNiveauxHl — regroupement par buckets de 0,25 % du prix", () => {
  it("regroupe deux niveaux du même bucket : total, prix moyen PONDÉRÉ, compte", () => {
    // Bucket = 0,25 % de 60 000 = 150 $. 59 000 et 59 100 tombent dans le même bucket
    // (idx 393 : 58 950–59 100 … 59 100 ouvre le suivant) → on choisit 59 000 / 59 050.
    const clusters = clusteriserNiveauxHl([nhl(59_000, "long", 1_000_000), nhl(59_050, "long", 3_000_000)], 60_000);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.totalUsd).toBe(4_000_000);
    expect(clusters[0]?.n).toBe(2);
    expect(clusters[0]?.side).toBe("long");
    // Moyenne pondérée : (59000×1 + 59050×3) / 4 = 59 037.5
    expect(clusters[0]?.pxMoyenPondere).toBeCloseTo(59_037.5, 6);
  });

  it("sépare deux buckets distincts", () => {
    const clusters = clusteriserNiveauxHl([nhl(59_000, "long", 1e6), nhl(61_000, "short", 2e6)], 60_000);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.side).sort()).toEqual(["long", "short"]);
  });

  it("le side d'un cluster mixte est le DOMINANT en USD", () => {
    const clusters = clusteriserNiveauxHl([nhl(59_000, "long", 1e6), nhl(59_050, "short", 5e6)], 60_000);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.side).toBe("short");
    expect(clusters[0]?.totalUsd).toBe(6e6);
  });

  it("porte le split longUsd / shortUsd du cluster (le side reste le dominant)", () => {
    const [mixte] = clusteriserNiveauxHl(
      [nhl(59_000, "long", 1e6), nhl(59_050, "short", 5e6), nhl(59_020, "long", 2e6)],
      60_000,
    );
    expect(mixte?.longUsd).toBe(3e6);
    expect(mixte?.shortUsd).toBe(5e6);
    expect(mixte?.totalUsd).toBe(8e6);
    expect(mixte?.side).toBe("short");
    // Cluster pur : l'autre côté vaut 0.
    const [pur] = clusteriserNiveauxHl([nhl(61_000, "long", 4e6)], 60_000);
    expect(pur?.longUsd).toBe(4e6);
    expect(pur?.shortUsd).toBe(0);
  });

  it("rend [] sur une entrée vide ou un prix invalide", () => {
    expect(clusteriserNiveauxHl([], 60_000)).toEqual([]);
    expect(clusteriserNiveauxHl([nhl(59_000, "long", 1e6)], 0)).toEqual([]);
  });
});

/** Cluster HL positionné (y écran) pour les tests de partition — side = dominant en USD. */
function chp(y: number, totalUsd: number, longUsd: number, shortUsd: number, n: number, px: number): ClusterHlPlace {
  return { y, totalUsd, longUsd, shortUsd, n, pxMoyenPondere: px, side: longUsd >= shortUsd ? "long" : "short" };
}

describe("partitionnerClustersHl — visibles / hors écran au-dessus / en dessous", () => {
  // Pane : haut = 100, bas = 500 (y absolus du canvas, y croît vers le BAS).
  const haut = 100;
  const bas = 500;

  it("bornes INCLUSES : y = haut et y = bas sont visibles", () => {
    const a = chp(100, 1e6, 0, 1e6, 1, 70_000);
    const b = chp(500, 2e6, 2e6, 0, 1, 50_000);
    const c = chp(300, 3e6, 3e6, 0, 1, 60_000);
    const { visibles, auDessus, enDessous } = partitionnerClustersHl([a, b, c], haut, bas);
    expect(visibles).toEqual([a, b, c]);
    expect(auDessus.nNiveaux).toBe(0);
    expect(enDessous.nNiveaux).toBe(0);
  });

  it("y < haut → au-dessus ; y > bas → en dessous", () => {
    const dessus = chp(99.5, 1e6, 0, 1e6, 2, 90_000);
    const dessous = chp(500.5, 1e6, 1e6, 0, 3, 40_000);
    const vis = chp(250, 1e6, 1e6, 0, 1, 61_000);
    const r = partitionnerClustersHl([dessus, dessous, vis], haut, bas);
    expect(r.visibles).toEqual([vis]);
    expect(r.auDessus.nNiveaux).toBe(2);
    expect(r.enDessous.nNiveaux).toBe(3);
  });

  it("y non fini → ignoré PARTOUT (ni visible, ni compté hors écran)", () => {
    const r = partitionnerClustersHl(
      [
        chp(Number.NaN, 5e6, 5e6, 0, 4, 1),
        chp(Number.POSITIVE_INFINITY, 5e6, 0, 5e6, 4, 2),
        chp(Number.NEGATIVE_INFINITY, 5e6, 0, 5e6, 4, 3),
      ],
      haut,
      bas,
    );
    expect(r.visibles).toEqual([]);
    expect(r.auDessus).toEqual({ nNiveaux: 0, totalUsd: 0, longUsd: 0, shortUsd: 0, plusProchePx: null, plusGros: null });
    expect(r.enDessous).toEqual({ nNiveaux: 0, totalUsd: 0, longUsd: 0, shortUsd: 0, plusProchePx: null, plusGros: null });
  });

  it("agrège par côté : nNiveaux = Σ n, totalUsd, longUsd, shortUsd", () => {
    const r = partitionnerClustersHl(
      [
        chp(50, 4e6, 1e6, 3e6, 3, 95_000),
        chp(10, 6e6, 0, 6e6, 5, 120_000),
        chp(600, 2e6, 2e6, 0, 2, 30_000),
        chp(900, 1e6, 0.25e6, 0.75e6, 7, 10_000),
      ],
      haut,
      bas,
    );
    expect(r.auDessus.nNiveaux).toBe(8);
    expect(r.auDessus.totalUsd).toBe(10e6);
    expect(r.auDessus.longUsd).toBe(1e6);
    expect(r.auDessus.shortUsd).toBe(9e6);
    expect(r.enDessous.nNiveaux).toBe(9);
    expect(r.enDessous.totalUsd).toBe(3e6);
    expect(r.enDessous.longUsd).toBe(2.25e6);
    expect(r.enDessous.shortUsd).toBe(0.75e6);
  });

  it("plusProchePx : au-dessus = plus GRAND y (collé au bord haut), en dessous = plus PETIT y", () => {
    const r = partitionnerClustersHl(
      [
        chp(10, 1e6, 0, 1e6, 1, 120_000), // loin au-dessus
        chp(90, 1e6, 0, 1e6, 1, 95_000), // juste au-dessus du bord → le plus proche
        chp(510, 1e6, 1e6, 0, 1, 45_000), // juste sous le bord → le plus proche
        chp(900, 1e6, 1e6, 0, 1, 10_000), // loin en dessous
      ],
      haut,
      bas,
    );
    expect(r.auDessus.plusProchePx).toBe(95_000);
    expect(r.enDessous.plusProchePx).toBe(45_000);
  });

  it("plusGros : le cluster au plus gros totalUsd de chaque côté", () => {
    const gros = chp(20, 238e6, 0, 238e6, 12, 132_743);
    const r = partitionnerClustersHl(
      [chp(90, 1e6, 0, 1e6, 1, 95_000), gros, chp(60, 5e6, 0, 5e6, 1, 100_000), chp(700, 3e6, 3e6, 0, 1, 20_000)],
      haut,
      bas,
    );
    expect(r.auDessus.plusGros?.totalUsd).toBe(238e6);
    expect(r.auDessus.plusGros?.pxMoyenPondere).toBe(132_743);
    expect(r.enDessous.plusGros?.pxMoyenPondere).toBe(20_000);
  });

  it("entrée vide → aucun visible, agrégats nuls", () => {
    const r = partitionnerClustersHl([], haut, bas);
    expect(r.visibles).toEqual([]);
    expect(r.auDessus.plusGros).toBeNull();
    expect(r.enDessous.plusProchePx).toBeNull();
  });
});

describe("libelleBordHl — repère de bord des niveaux hors écran", () => {
  const plein: HorsEcranHl = {
    nNiveaux: 46,
    totalUsd: 781e6,
    longUsd: 12e6,
    shortUsd: 769e6,
    plusProchePx: 96_000,
    plusGros: { pxMoyenPondere: 132_743, totalUsd: 238e6, longUsd: 0, shortUsd: 238e6, side: "short", n: 3 },
  };

  it("null quand rien n'est hors écran de ce côté", () => {
    expect(libelleBordHl({ ...plein, nNiveaux: 0 }, "haut")).toBeNull();
    expect(libelleBordHl({ ...plein, nNiveaux: 0 }, "bas")).toBeNull();
  });

  it("haut : ▲, nombre de niveaux, total et plus gros cluster « max … @ prix »", () => {
    expect(libelleBordHl(plein, "haut")).toBe(
      `▲ 46 niv. hors écran · ${formatUsd(781e6)} · max ${formatUsd(238e6)} @ ${formatPrice(132_743)}`,
    );
  });

  it("bas : ▼ au lieu de ▲", () => {
    expect(libelleBordHl(plein, "bas")).toBe(
      `▼ 46 niv. hors écran · ${formatUsd(781e6)} · max ${formatUsd(238e6)} @ ${formatPrice(132_743)}`,
    );
  });

  it("sans plusGros : le segment « max … @ … » est omis", () => {
    expect(libelleBordHl({ ...plein, plusGros: null }, "haut")).toBe(`▲ 46 niv. hors écran · ${formatUsd(781e6)}`);
  });
});

describe("cumulsHl — cumuls au-dessus / en dessous du prix sur TOUS les niveaux valides", () => {
  it("px > prix → au-dessus, sinon en dessous (px = prix → en dessous, comme cumulsAutourSpot)", () => {
    const r = cumulsHl(
      [
        nhl(61_000, "short", 3e6),
        nhl(59_000, "long", 2e6),
        nhl(60_000, "long", 1e6), // pile sur le prix → en dessous
      ],
      60_000,
    );
    expect(r).toEqual({ auDessus: 3e6, enDessous: 3e6 });
  });

  it("compte aussi les niveaux LOINTAINS (plus de fenêtre) — 27 M$ inclus", () => {
    const r = cumulsHl([nhl(27_000_000, "short", 50_000), nhl(132_743, "short", 238e6), nhl(30_000, "long", 5e6)], 84_500);
    expect(r).toEqual({ auDessus: 238_050_000, enDessous: 5e6 });
  });

  it("ignore les niveaux invalides (même garde que filtrerNiveauxHl)", () => {
    const r = cumulsHl(
      [
        nhl(0, "long", 1e6),
        nhl(Number.NaN, "long", 1e6),
        nhl(61_000, "short", Number.NaN),
        nhl(61_000, "short", -2),
        nhl(61_000, "short", 7),
      ],
      60_000,
    );
    expect(r).toEqual({ auDessus: 7, enDessous: 0 });
  });

  it("prix invalide → zéros", () => {
    const niveaux = [nhl(61_000, "short", 1e6)];
    expect(cumulsHl(niveaux, 0)).toEqual({ auDessus: 0, enDessous: 0 });
    expect(cumulsHl(niveaux, Number.NaN)).toEqual({ auDessus: 0, enDessous: 0 });
    expect(cumulsHl(niveaux, -1)).toEqual({ auDessus: 0, enDessous: 0 });
  });
});

describe("libelleLegendeHl — la couche LIQHL nomme toujours son état", () => {
  it("état ok → couverture annoncée (adresses · positions) + cumuls ↑/↓", () => {
    expect(libelleLegendeHl("ok", 475, 104, { auDessus: 1.1e9, enDessous: 322e6 })).toBe(
      `LIQ HL RÉELS — 475 adresses · 104 positions · ↑ ${formatUsd(1.1e9)} · ↓ ${formatUsd(322e6)}`,
    );
  });

  it("état ok sans cumuls (null) → segment omis", () => {
    expect(libelleLegendeHl("ok", 250, 12, null)).toBe("LIQ HL RÉELS — 250 adresses · 12 positions");
  });

  it("⚠️ honnêteté : jamais « toutes les liquidations », toujours « N adresses »", () => {
    const l = libelleLegendeHl("ok", 475, 104, { auDessus: 1, enDessous: 1 });
    expect(l).toContain("475 adresses");
    expect(l.toLowerCase()).not.toContain("toutes");
  });

  it("capability absente → « nécessite le daemon » (précédent REPLAY)", () => {
    expect(libelleLegendeHl("sans-daemon", 0, 0, null)).toBe("LIQ HL RÉELS — nécessite le daemon axiomd");
  });

  it("coin non couvert par le leaderboard → « vide » explicite", () => {
    expect(libelleLegendeHl("vide", 0, 0, null)).toBe("LIQ HL RÉELS — aucun niveau pour ce symbole");
  });

  it("échec réseau / réponse illisible → erreur DOUCE", () => {
    expect(libelleLegendeHl("erreur", 0, 0, null)).toBe("LIQ HL RÉELS — source indisponible");
  });

  it("fetch en vol → « chargement… » (et pas « aucun niveau », faux pendant le scan)", () => {
    expect(libelleLegendeHl("chargement", 0, 0, { auDessus: 5, enDessous: 5 })).toBe("LIQ HL RÉELS — chargement…");
  });

  it("cotation hors USD → la RAISON prime sur l'état et les cumuls (couche muette, jamais silencieuse)", () => {
    // Relecture du 25/09/2026 : sur ETHBTC la légende affichait « ↑ $1.34B · ↓ $0.00 » —
    // des niveaux USD comparés à un prix en BTC.
    const raison = "cotation BTC ≠ USD, niveaux masqués";
    expect(libelleLegendeHl("ok", 475, 79, { auDessus: 1.34e9, enDessous: 0 }, raison)).toBe(
      "LIQ HL RÉELS — cotation BTC ≠ USD, niveaux masqués",
    );
    expect(libelleLegendeHl("chargement", 0, 0, null, raison)).toBe("LIQ HL RÉELS — cotation BTC ≠ USD, niveaux masqués");
  });

  it("raison null ou absente → libellé nominal inchangé", () => {
    expect(libelleLegendeHl("ok", 250, 12, null, null)).toBe("LIQ HL RÉELS — 250 adresses · 12 positions");
  });
});

describe("libelleLegendeHl — source « navigateur » (scan direct, Vercel ou local sans daemon)", () => {
  const cumuls = { auDessus: 1.1e9, enDessous: 322e6 };
  const suffixe = ` · ↑ ${formatUsd(1.1e9)} · ↓ ${formatUsd(322e6)}`;

  it("scan en cours : progression « scan N/T adresses », positions partielles et cumuls", () => {
    expect(libelleLegendeHl("ok", 398, 120, cumuls, null, "navigateur", { faites: 400, total: 1500 })).toBe(
      `LIQ HL RÉELS (navigateur) — scan 400/1500 adresses · 120 positions${suffixe}`,
    );
  });

  it("scan fini : « N adresses » RÉPONDUES, comme en mode daemon", () => {
    expect(libelleLegendeHl("ok", 1500, 3100, cumuls, null, "navigateur", null)).toBe(
      `LIQ HL RÉELS (navigateur) — 1500 adresses · 3100 positions${suffixe}`,
    );
  });

  it("chargement : pool d'adresses d'abord, puis scan sans niveau encore pour ce coin", () => {
    expect(libelleLegendeHl("chargement", 0, 0, null, null, "navigateur", null)).toBe(
      "LIQ HL RÉELS (navigateur) — chargement du pool d'adresses…",
    );
    expect(libelleLegendeHl("chargement", 12, 0, null, null, "navigateur", { faites: 20, total: 1500 })).toBe(
      "LIQ HL RÉELS (navigateur) — scan 20/1500 adresses…",
    );
  });

  it("vide, erreur et raison de cotation portent aussi la source", () => {
    expect(libelleLegendeHl("vide", 1500, 0, null, null, "navigateur")).toBe(
      "LIQ HL RÉELS (navigateur) — aucun niveau pour ce symbole",
    );
    expect(libelleLegendeHl("erreur", 0, 0, null, null, "navigateur")).toBe("LIQ HL RÉELS (navigateur) — source indisponible");
    expect(libelleLegendeHl("ok", 1, 1, null, "cotation BTC ≠ USD, niveaux masqués", "navigateur")).toBe(
      "LIQ HL RÉELS (navigateur) — cotation BTC ≠ USD, niveaux masqués",
    );
  });

  it("⚠️ honnêteté : échantillon annoncé, jamais « toutes »", () => {
    const l = libelleLegendeHl("ok", 1500, 3100, cumuls, null, "navigateur", null);
    expect(l).toContain("1500 adresses");
    expect(l.toLowerCase()).not.toContain("toutes");
  });

  it("source daemon explicite → libellés strictement inchangés (progression ignorée)", () => {
    expect(libelleLegendeHl("ok", 250, 12, null, null, "daemon", { faites: 1, total: 2 })).toBe(
      "LIQ HL RÉELS — 250 adresses · 12 positions",
    );
    expect(libelleLegendeHl("chargement", 0, 0, null, null, "daemon", null)).toBe("LIQ HL RÉELS — chargement…");
  });
});

describe("raisonCotationHl — niveaux HL en USD : la couche se tait hors cotation USD", () => {
  it("cotation USD ou stablecoin USD (et perp Hyperliquid) → null : niveaux affichables", () => {
    for (const s of [
      "BTCUSDT",
      "ETHUSDC",
      "BTC-USD",
      "XBT/USD",
      "BTC/USDT",
      "SOLUSD",
      "BTCUSDE",
      "ETHDAI",
      "BTCTUSD",
      "BTCUSDD",
      "btcusdt",
      "BTC-PERP",
      "kPEPE-PERP",
    ]) {
      expect(raisonCotationHl(s), s).toBeNull();
    }
  });

  it("cotation crypto ou fiat NON USD → raison nommant la cotation", () => {
    expect(raisonCotationHl("ETHBTC")).toBe("cotation BTC ≠ USD, niveaux masqués");
    expect(raisonCotationHl("SOLETH")).toBe("cotation ETH ≠ USD, niveaux masqués");
    expect(raisonCotationHl("BTCJPY")).toBe("cotation JPY ≠ USD, niveaux masqués");
    expect(raisonCotationHl("XBT/EUR")).toBe("cotation EUR ≠ USD, niveaux masqués");
    expect(raisonCotationHl("ETH-BTC")).toBe("cotation BTC ≠ USD, niveaux masqués");
    expect(raisonCotationHl("BTCEURC")).toBe("cotation EURC ≠ USD, niveaux masqués");
  });

  it("symbole inextricable (synthétique, cotation inconnue, vide) → null : basePerp renonce déjà au fetch", () => {
    expect(raisonCotationHl("binance:BTCUSDT|/|binance:ETHUSDT")).toBeNull();
    expect(raisonCotationHl("FOOBAR")).toBeNull();
    expect(raisonCotationHl("")).toBeNull();
  });

  it("⚠️ honnêteté : la raison ne parle jamais de « toutes » les liquidations", () => {
    expect(raisonCotationHl("ETHBTC")?.toLowerCase()).not.toContain("toutes");
  });
});

describe("yLibreSousObstacles — le repère haut se pose SOUS les surcouches DOM", () => {
  it("aucun obstacle → yMin", () => {
    expect(yLibreSousObstacles(24, 14, 0, 1000, [])).toBe(24);
  });

  it("bandeau symbole (top+8…44, x 8…700) recouvrant la pilule → posée 2 px sous son bord bas", () => {
    // Mesure Playwright de la relecture : le repère à top+24 disparaissait sous SymbolBanner (z-10).
    expect(yLibreSousObstacles(24, 14, 440, 732, [{ x0: 8, x1: 700, y0: 8, y1: 44 }])).toBe(46);
  });

  it("obstacle sans recouvrement HORIZONTAL → ignoré", () => {
    expect(yLibreSousObstacles(24, 14, 800, 1100, [{ x0: 8, x1: 700, y0: 8, y1: 44 }])).toBe(24);
  });

  it("obstacle au-dessus (écart compris) ou laissant passer la pilule en dessous → ignoré", () => {
    expect(yLibreSousObstacles(24, 14, 0, 500, [{ x0: 0, x1: 500, y0: 0, y1: 22 }])).toBe(24); // 22 + 2 ≤ 24
    expect(yLibreSousObstacles(24, 14, 0, 500, [{ x0: 0, x1: 500, y0: 40, y1: 60 }])).toBe(24); // 24 + 14 + 2 ≤ 40
  });

  it("obstacles EMPILÉS (lignes de légende overlay) → sous le dernier, quel que soit l'ordre d'entrée", () => {
    const lignes = [
      { x0: 900, x1: 1196, y0: 2, y1: 20 },
      { x0: 900, x1: 1196, y0: 22, y1: 40 },
      { x0: 900, x1: 1196, y0: 42, y1: 60 },
    ];
    expect(yLibreSousObstacles(24, 14, 0, 1200, lignes)).toBe(62);
    expect(yLibreSousObstacles(24, 14, 0, 1200, [...lignes].reverse())).toBe(62);
  });

  it("bandeau passé sur 2 lignes (flex-wrap, pane étroit) → sous son vrai bord bas, pas sous une constante", () => {
    expect(yLibreSousObstacles(24, 14, 0, 590, [{ x0: 8, x1: 582, y0: 8, y1: 74 }])).toBe(76);
  });

  it("coordonnée NaN dans un obstacle → ignoré (jamais de y NaN)", () => {
    expect(yLibreSousObstacles(24, 14, 0, 500, [{ x0: Number.NaN, x1: 500, y0: 0, y1: 60 }])).toBe(24);
  });
});

describe("bandeRepereHl + partition — la zone des barres s'arrête aux pilules des repères", () => {
  it("bande = pilule (14 px) ± 2 px d'écart", () => {
    expect(bandeRepereHl(46)).toEqual([44, 62]);
  });

  it("un cluster sous la pilule ▲ (ou sous le bandeau DOM) ou sous la pilule ▼ est RÉSUMÉ, pas peint puis masqué", () => {
    // ▲ posé à 46 (sous le bandeau) ; pile de légendes au sommet 500 → ▼ posé à 500 − 2 − 14 = 484.
    const haut = bandeRepereHl(46)[1]; // 62
    const bas = bandeRepereHl(484)[0]; // 482
    const sousBandeau = chp(30, 1e6, 0, 1e6, 1, 102_000);
    const sousPiluleHaut = chp(50, 5e6, 0, 5e6, 2, 101_000);
    const visible = chp(300, 3e6, 3e6, 0, 1, 60_000);
    const sousPiluleBas = chp(490, 2e6, 2e6, 0, 4, 20_000);
    const r = partitionnerClustersHl([sousBandeau, sousPiluleHaut, visible, sousPiluleBas], haut, bas);
    expect(r.visibles).toEqual([visible]);
    // Comptés dans les repères : ni peints sous une pilule, ni perdus.
    expect(r.auDessus.nNiveaux).toBe(3);
    expect(r.auDessus.totalUsd).toBe(6e6);
    expect(r.enDessous.nNiveaux).toBe(4);
  });
});

describe("yRepereBasHl — le repère ▼ ne remonte jamais sur le repère ▲ (pane court)", () => {
  it("cas normal : ▼ posé à 2 px au-dessus du sommet de la pile de légendes", () => {
    // Sommet de pile 500 → 500 − 2 − 14 = 484, bien sous ▲ (46).
    expect(yRepereBasHl(500, 46)).toBe(484);
  });

  it("pane court : ▼ tomberait au-dessus de ▲ → posé juste sous ▲ (46 + 14 + 2)", () => {
    // Pile haute : sommet 60 → 60 − 16 = 44, soit AU-DESSUS du ▲ posé à 46 (recouvrement).
    expect(yRepereBasHl(60, 46)).toBe(62);
    // Pile encore plus haute (sommet au-dessus du pane) : même plancher.
    expect(yRepereBasHl(-20, 46)).toBe(62);
  });

  it("frontière exacte : les deux formules coïncident (pas de décalage d'un pixel)", () => {
    expect(yRepereBasHl(78, 46)).toBe(62);
    expect(yRepereBasHl(79, 46)).toBe(63);
  });

  it("les deux pilules ne se recouvrent jamais : ▼ commence après la fin de ▲ + écart", () => {
    for (const sommet of [-100, 0, 40, 60, 78, 79, 120, 500]) {
      expect(yRepereBasHl(sommet, 46)).toBeGreaterThanOrEqual(46 + 14 + 2);
    }
  });

  it("bornes INVERSÉES (plancher atteint) : aucun visible, chaque cluster compté UNE seule fois", () => {
    // ▲ à 46 → haut = 62 ; ▼ plafonné à 62 → bas = bandeRepereHl(62)[0] = 60 < haut.
    const haut = bandeRepereHl(46)[1];
    const bas = bandeRepereHl(yRepereBasHl(60, 46))[0];
    expect(haut).toBe(62);
    expect(bas).toBe(60);
    const clusters = [
      chp(10, 1e6, 0, 1e6, 3, 110_000), // hors écran en haut
      chp(61, 2e6, 0, 2e6, 5, 101_000), // DANS l'intervalle inversé ]bas, haut[
      chp(60, 4e6, 4e6, 0, 11, 100_500), // pile sur bas
      chp(62, 3e6, 3e6, 0, 2, 100_000), // pile sur haut
      chp(63, 5e6, 5e6, 0, 7, 99_000),
      chp(300, 8e6, 8e6, 0, 13, 60_000),
    ];
    const r = partitionnerClustersHl(clusters, haut, bas);
    expect(r.visibles).toEqual([]);
    const totalN = clusters.reduce((s, c) => s + c.n, 0);
    const totalUsd = clusters.reduce((s, c) => s + c.totalUsd, 0);
    expect(r.auDessus.nNiveaux + r.enDessous.nNiveaux).toBe(totalN);
    expect(r.auDessus.totalUsd + r.enDessous.totalUsd).toBe(totalUsd);
    // Répartition : y < haut → au-dessus (10, 61, 60) ; sinon en dessous (62, 63, 300).
    expect(r.auDessus.nNiveaux).toBe(3 + 5 + 11);
    expect(r.enDessous.nNiveaux).toBe(2 + 7 + 13);
  });
});

describe("filtrerHorsBandes — aucune étiquette sous une pilule de repère", () => {
  it("sans bande → tout passe, ordre conservé", () => {
    const items = [{ y: 3 }, { y: 1 }, { y: 2 }];
    expect(filtrerHorsBandes(items, [], 7)).toEqual(items);
  });

  it("écarte les items dont [y − d, y + d] recoupe une bande ; un contact de bord passe", () => {
    // Bande [44, 62], demi-hauteur 7 → interdit si y − 7 < 62 et y + 7 > 44, soit y ∈ ]37, 69[.
    const items = [{ y: 30 }, { y: 37 }, { y: 38 }, { y: 51 }, { y: 68 }, { y: 69 }, { y: 100 }];
    expect(filtrerHorsBandes(items, [[44, 62]], 7).map((i) => i.y)).toEqual([30, 37, 69, 100]);
  });

  it("plusieurs bandes (▲ en haut, ▼ en bas) : chacune exclut sa zone", () => {
    const items = [{ y: 50 }, { y: 200 }, { y: 490 }];
    expect(filtrerHorsBandes(items, [[44, 62], [482, 500]], 7).map((i) => i.y)).toEqual([200]);
  });

  it("préserve le type d'entrée (mêmes objets)", () => {
    const riche = { y: 200, poids: 5, px: 60_000 };
    expect(filtrerHorsBandes([riche], [[44, 62]], 7)[0]).toBe(riche);
  });
});

describe("bullesDepuisGrille — sélection des bulles de clusters", () => {
  /** Grille de cellules synthétiques : une cellule par total USD donné (tout en longs). */
  function grilleDe(totaux: number[]): LiqGrid {
    const cells = new Map();
    totaux.forEach((t, i) => {
      cells.set(`${i}:${i}`, { candleTime: i, bucketIdx: i, longUsd: t, shortUsd: 0, count: 1 });
    });
    return { cells, taille: 1, maxUsd: Math.max(0, ...totaux) };
  }

  it("grille vide → []", () => {
    expect(bullesDepuisGrille(grilleDe([]))).toEqual([]);
  });

  it("le quantile filtre les cellules sous le seuil", () => {
    // Totaux 1,2,3,4,5 : q=0,7 → index floor(0,7×5)=3 → seuil 4 → cellules 4 et 5.
    const bulles = bullesDepuisGrille(grilleDe([1, 2, 3, 4, 5]), 0.7);
    expect(bulles.map((b) => b.usd)).toEqual([5, 4]); // ordre décroissant
  });

  it("la plus grosse cellule est toujours retenue, même à q=1", () => {
    const bulles = bullesDepuisGrille(grilleDe([1, 2, 100]), 1);
    expect(bulles).toHaveLength(1);
    expect(bulles[0]?.usd).toBe(100);
  });

  it("rayon : max → rMax, ¼ du max → rMin + (rMax − rMin)/2", () => {
    const bulles = bullesDepuisGrille(grilleDe([100, 25]), 0, 300, 2.5, 14);
    const max = bulles.find((b) => b.usd === 100);
    const quart = bulles.find((b) => b.usd === 25);
    expect(max?.rayon).toBeCloseTo(14);
    expect(quart?.rayon).toBeCloseTo(2.5 + (14 - 2.5) / 2);
  });

  it("side = dominant en USD (égalité → long)", () => {
    // Totaux 100 / 100 / 50 : la grille porte le split long/short de chaque cellule.
    const grille: LiqGrid = {
      cells: new Map([
        ["0:0", { candleTime: 0, bucketIdx: 0, longUsd: 60, shortUsd: 40, count: 1 }],
        ["1:1", { candleTime: 1, bucketIdx: 1, longUsd: 40, shortUsd: 60, count: 1 }],
        ["2:2", { candleTime: 2, bucketIdx: 2, longUsd: 25, shortUsd: 25, count: 1 }],
      ]),
      taille: 1,
      maxUsd: 100,
    };
    const bulles = bullesDepuisGrille(grille, 0);
    const par = (time: number) => bulles.find((b) => b.candleTime === time)?.side;
    expect(par(0)).toBe("long"); // 60L > 40S
    expect(par(1)).toBe("short"); // 40L < 60S
    expect(par(2)).toBe("long"); // égalité → long
  });

  it("plafonne au nombre max de bulles", () => {
    const bulles = bullesDepuisGrille(grilleDe([1, 2, 3, 4, 5, 6, 7]), 0, 3);
    expect(bulles).toHaveLength(3);
    expect(bulles.map((b) => b.usd)).toEqual([7, 6, 5]);
  });
});

// ───────────── Heatmap HL (instantanés daemon) — fonctions pures ─────────────

/** Instantané HL minimal pour les tests de grille. */
function snap(ts: number, niveaux: Array<[number, "long" | "short", number]> = []): import("../data/hyperliquidHeat").InstantaneHlHeat {
  return {
    ts,
    niveaux: niveaux.map(([px, side, usd]) => ({ px, side, usd })),
    longUsd: 0,
    shortUsd: 0,
    nLong: 0,
    nShort: 0,
    oiUsd: null,
    adresses: 474,
    couverture: null,
  };
}

describe("pasBougieMs — pas médian des bougies visibles", () => {
  it("renvoie la médiane des écarts consécutifs (robuste aux trous)", () => {
    const candles = [
      candle({ time: 0, close: 100 }),
      candle({ time: 60_000, close: 100 }),
      candle({ time: 120_000, close: 100 }),
      candle({ time: 600_000, close: 100 }), // trou : médiane reste 60 s
      candle({ time: 660_000, close: 100 }),
    ];
    expect(pasBougieMs(candles, 0, 5)).toBe(60_000);
    // Plage limitée : seuls les écarts de la plage comptent.
    expect(pasBougieMs(candles, 3, 5)).toBe(60_000);
  });

  it("plancher 60 s (bougies plus denses ou plage vide)", () => {
    const ticks = [candle({ time: 0, close: 1 }), candle({ time: 5_000, close: 1 })];
    expect(pasBougieMs(ticks, 0, 2)).toBe(60_000);
    expect(pasBougieMs([], 0, 0)).toBe(60_000);
  });
});

describe("construireGrilleHl — instantané par bougie, report ≤ 2 pas", () => {
  // Bougies 1 min : time 0, 60 000, 120 000. Instantanés à ts = 5 000 puis 115 000.
  const candles = [
    candle({ time: 0, close: 100 }),
    candle({ time: 60_000, close: 100 }),
    candle({ time: 120_000, close: 100 }),
  ];
  const pas = 300_000;

  it("retient le DERNIER instantané ≤ fin de bougie et répartit long/short par bucket", () => {
    const instantanes = [
      snap(5_000, [
        [100, "long", 500],
        [100, "short", 200],
      ]),
      snap(115_000, [[100.05, "long", 900]]), // tailleBucket(100)=0,1 → bucket 1000/1000
    ];
    const grid = construireGrilleHl(instantanes, candles, 0, 3, pas);
    expect(grid).not.toBeNull();
    // Bougie 0 (fin 60 000) → snap 5 000 ; bougie 1 (fin 120 000) → snap 115 000 ;
    // bougie 2 (fin 180 000) → snap 115 000 (encore ≤ fin, et ≥ time − 2 pas).
    const b0 = grid?.cells.get("0:1000");
    const b1 = grid?.cells.get("60000:1000");
    const b2 = grid?.cells.get("120000:1000");
    expect(b0?.longUsd).toBe(500);
    expect(b0?.shortUsd).toBe(200);
    expect(b0?.nLong).toBe(1);
    expect(b0?.nShort).toBe(1);
    expect(b1?.longUsd).toBe(900);
    expect(b1?.dernierTime).toBe(115_000);
    expect(b2?.longUsd).toBe(900);
    expect(grid?.maxUsd).toBe(900);
  });

  it("laisse la colonne VIDE quand le dernier instantané a plus de 2 pas de retard", () => {
    // Instantané à ts = 0 ; bougie à 1 200 000 (time − 2×pas = 600 000 > 0 → trop vieux).
    const lointaines = [
      candle({ time: 1_200_000, close: 100 }),
      candle({ time: 1_260_000, close: 100 }),
    ];
    const grid = construireGrilleHl([snap(0, [[100, "long", 500]])], lointaines, 0, 2, pas);
    expect(grid).toBeNull();
  });

  it("écarte les niveaux inexploitables et respecte les bornes de la plage", () => {
    const instantanes = [snap(5_000, [[100, "long", 500], [Number.NaN, "long", 1], [0, "short", 9]])];
    const grid = construireGrilleHl(instantanes, candles, 0, 3, pas);
    // px NaN / 0 écartés → une seule cellule (long 500).
    expect(grid?.cells.size).toBe(3); // bougies 0, 1 et 2 réutilisent le même instantané (≤ 2 pas)
    expect(grid?.cells.get("0:1000")?.count).toBe(1);
    // Plage [1,3) : la bougie 0 n'est pas remplie.
    const partiel = construireGrilleHl(instantanes, candles, 1, 3, pas);
    expect(partiel?.cells.has("0:1000")).toBe(false);
    expect(partiel?.cells.size).toBe(2);
  });

  it("renvoie null sans instantané ni cellule", () => {
    expect(construireGrilleHl([], candles, 0, 3, pas)).toBeNull();
    expect(construireGrilleHl([snap(0)], candles, 0, 3, pas)).toBeNull();
  });
});

describe("compterTrous — interruptions de collecte dans la fenêtre", () => {
  const pas = 300_000;
  const s = (ts: number) => snap(ts);

  it("compte un trou par écart > 3 pas entre instantanés de la fenêtre", () => {
    const instantanes = [s(0), s(1_000_000), s(1_300_000), s(3_000_000)];
    // 0→1 000 000 (>3 pas) et 1 300 000→3 000 000 (>3 pas) ; 1 000 000→1 300 000 ok.
    expect(compterTrous(instantanes, -100, 3_100_000, pas)).toBe(2);
  });

  it("trou initial seulement si la collecte avait déjà commencé (premierTs < debut)", () => {
    const instantanes = [s(2_000_000)];
    // premierTs connu AVANT la fenêtre + premier instantané > 3 pas après debut → trou.
    expect(compterTrous(instantanes, 1_000_000, 3_000_000, pas, 500_000)).toBe(1);
    // Collecte commencée DANS la fenêtre (premierTs ≥ debut) → pas de trou initial.
    expect(compterTrous(instantanes, 0, 3_000_000, pas, 2_000_000)).toBe(0);
    expect(compterTrous(instantanes, 0, 3_000_000, pas, null)).toBe(0);
  });

  it("ignore les instantanés hors fenêtre", () => {
    const instantanes = [s(0), s(5_000_000)];
    expect(compterTrous(instantanes, 0, 1_000_000, pas)).toBe(0);
  });
});

describe("libelleLegendeHlHeat — légende raison comprise", () => {
  it("annonce la raison pour chaque état non ok", () => {
    expect(libelleLegendeHlHeat("sans-daemon", 0, 0, null, 300_000, 0, false)).toContain("daemon axiomd");
    expect(libelleLegendeHlHeat("erreur", 0, 0, null, 300_000, 0, false)).toContain("source indisponible");
    expect(libelleLegendeHlHeat("inactif", 0, 0, null, 300_000, 0, false)).toContain("reprendre dans LIQ");
    expect(libelleLegendeHlHeat("vide", 0, 0, null, 300_000, 0, true)).toContain("collecte active");
  });

  it("libellé nominal : instantanés, adresses, couverture OI mesurée et pas", () => {
    const l = libelleLegendeHlHeat("ok", 42, 474, 0.23, 300_000, 0, true);
    expect(l).toContain("HL HEATMAP");
    expect(l).toContain("42 instantanés");
    expect(l).toContain("474 adresses");
    expect(l).toContain("23 % OI");
    expect(l).toContain("pas 5 min");
  });

  it("« couverture en mesure » quand l'OI est inconnue, et trous signalés", () => {
    expect(libelleLegendeHlHeat("ok", 5, 474, null, 300_000, 0, true)).toContain("couverture en mesure");
    expect(libelleLegendeHlHeat("ok", 5, 474, 0.2, 300_000, 2, true)).toContain("2 trous = daemon éteint");
  });

  it("LIQHL en mode navigateur : l'historique est réservé au daemon (jamais « source indisponible »)", () => {
    for (const etat of ["sans-daemon", "erreur", "vide", "ok"] as const) {
      const l = libelleLegendeHlHeat(etat, 0, 0, null, 300_000, 0, false, null, "navigateur");
      expect(l).toBe("HL HEATMAP — historique réservé au daemon axiomd (scan navigateur : instantané courant seul)");
    }
    // Source daemon (défaut) : inchangé.
    expect(libelleLegendeHlHeat("erreur", 0, 0, null, 300_000, 0, false, null, "daemon")).toBe(
      "HL HEATMAP — source indisponible",
    );
  });
});
