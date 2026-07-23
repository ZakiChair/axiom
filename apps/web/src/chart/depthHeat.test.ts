/**
 * Tests des fonctions PURES d'accumulation et de grille de la heatmap de liquidité du
 * carnet (BOOK) : échantillonnage d'une colonne depuis un `OrderBook`, FIFO borné des
 * colonnes, construction de la grille temps × prix sur la plage visible, et intensité
 * log-normalisée (même contrat que `intensiteLog` de liquidationHeat.ts).
 */
import { describe, expect, it } from "vitest";
import type { OrderBook } from "../data/depth";
import {
  ajouterColonne,
  echantillonnerColonne,
  grilleDepuisColonnes,
  intensiteLogDepth,
  MAX_COLONNES,
  type ColonneDepth,
} from "./depthHeat";

/** Construit un OrderBook à partir de paires [prix, qte] pour bids/asks. */
function livre(bids: [number, number][], asks: [number, number][]): OrderBook {
  return { lastUpdateId: 1, bids: new Map(bids), asks: new Map(asks) };
}

/** Colonne minimale pour les tests de FIFO/grille (contenu bid/ask non pertinent ici). */
function col(t: number, pas = 1, bids: ColonneDepth["bids"] = [], asks: ColonneDepth["asks"] = []): ColonneDepth {
  return { t, pas, bids, asks };
}

describe("echantillonnerColonne", () => {
  it("agrège bids et asks des deux côtés du mid, avec le pas dérivé du mid", () => {
    // mid ≈ (100 + 101) / 2 = 100.5 → pasArrondi(100.5) = 0.05 (cf. pasArrondi : vise
    // ~0,05 % du prix). Les niveaux sont bruts (pas déjà alignés) ; agregerNiveaux les
    // regroupe par seau de `pas`.
    const b = livre(
      [[100, 2], [99.98, 1]],
      [[101, 3], [101.02, 1]],
    );
    const c = echantillonnerColonne(b, 5000);
    expect(c.t).toBe(5000);
    expect(c.pas).toBeGreaterThan(0);
    expect(c.bids.length).toBeGreaterThan(0);
    expect(c.asks.length).toBeGreaterThan(0);
    // Bids triés du mid vers l'extérieur (décroissant), asks croissant — cf. agregerNiveaux.
    expect(c.bids[0]?.prix).toBeGreaterThanOrEqual(c.bids[c.bids.length - 1]?.prix ?? 0);
    expect(c.asks[0]?.prix).toBeLessThanOrEqual(c.asks[c.asks.length - 1]?.prix ?? Infinity);
    // Aucun niveau ask ne doit se retrouver mélangé côté bids ou inversement.
    for (const n of c.bids) expect(n.prix).toBeLessThan(101);
    for (const n of c.asks) expect(n.prix).toBeGreaterThan(99);
  });

  it("carnet vide (aucun best bid/ask) → mid 0, pas de repli (pasArrondi(0)=1), colonnes vides", () => {
    const b = livre([], []);
    const c = echantillonnerColonne(b, 42);
    expect(c.t).toBe(42);
    expect(c.pas).toBe(1);
    expect(c.bids).toEqual([]);
    expect(c.asks).toEqual([]);
  });
});

describe("ajouterColonne (FIFO borné)", () => {
  it("accumule sans éviction tant que la borne n'est pas dépassée", () => {
    let colonnes: ColonneDepth[] = [];
    colonnes = ajouterColonne(colonnes, col(1000), 3);
    colonnes = ajouterColonne(colonnes, col(2000), 3);
    expect(colonnes.map((c) => c.t)).toEqual([1000, 2000]);
  });

  it("évince les plus anciennes au-delà de max, en conservant l'ordre chronologique", () => {
    let colonnes: ColonneDepth[] = [];
    colonnes = ajouterColonne(colonnes, col(1000), 3);
    colonnes = ajouterColonne(colonnes, col(2000), 3);
    colonnes = ajouterColonne(colonnes, col(3000), 3);
    colonnes = ajouterColonne(colonnes, col(4000), 3);
    expect(colonnes.map((c) => c.t)).toEqual([2000, 3000, 4000]);
  });

  it("utilise MAX_COLONNES par défaut si `max` est omis", () => {
    const colonnes = ajouterColonne([], col(1));
    expect(colonnes.length).toBe(1);
    expect(MAX_COLONNES).toBe(1800);
  });
});

describe("grilleDepuisColonnes", () => {
  it("exclut les colonnes hors de la plage temporelle [deMs, aMs)", () => {
    const colonnes = [
      col(1000, 1, [{ prix: 100, qte: 5 }], []),
      col(2000, 1, [{ prix: 100, qte: 9 }], []),
      col(3000, 1, [{ prix: 100, qte: 7 }], []),
    ];
    const g = grilleDepuisColonnes(colonnes, 1500, 2500, 99, 101, 2);
    // Seule la colonne t=2000 est dans [1500, 2500) → qtyMax = 9 (pas 5 ni 7).
    expect(g.qtyMax).toBe(9);
  });

  it("cumule bids et asks dans la bonne cellule prix × colonne", () => {
    const colonnes = [
      col(0, 1, [{ prix: 100, qte: 4 }], [{ prix: 101, qte: 2 }]),
    ];
    // Plage prix [99, 102], 3 lignes → pas de ligne = 1 : ligne pour [99,100), [100,101), [101,102).
    const g = grilleDepuisColonnes(colonnes, 0, 1000, 99, 102, 3);
    expect(g.nCols).toBe(1);
    expect(g.qtyMax).toBe(4); // max cellule = bid 4 (> ask 2)
    // Toutes les valeurs de cellules sont soit 0, 4 ou 2.
    const vals = new Set(g.cellules);
    for (const v of vals) expect([0, 2, 4]).toContain(v);
  });

  it("cumule deux niveaux (bid + ask) dans la même ligne de la grille", () => {
    // bid prix 100.3 et ask prix 100.7 tombent tous deux dans la ligne [100, 101).
    const colonnes = [
      col(0, 1, [{ prix: 100.3, qte: 5 }], [{ prix: 100.7, qte: 3 }]),
    ];
    // Plage prix [99, 102], 3 lignes → pas = 1 : ligne [100, 101) contient les deux niveaux.
    const g = grilleDepuisColonnes(colonnes, 0, 1000, 99, 102, 3);
    expect(g.nCols).toBe(1);
    // La cellule de la ligne [100, 101) doit contenir la somme : 5 + 3 = 8.
    expect(g.qtyMax).toBe(8);
    // Vérifier que la deuxième cellule (colonne 0, ligne 1) contient bien 8.
    expect(g.cellules[1]).toBe(8);
  });

  it("grille vide (aucune colonne dans la plage) → qtyMax 0", () => {
    const colonnes = [col(0, 1, [{ prix: 100, qte: 4 }], [])];
    const g = grilleDepuisColonnes(colonnes, 5000, 6000, 99, 101, 2);
    expect(g.qtyMax).toBe(0);
    expect(g.cellules.every((v) => v === 0)).toBe(true);
  });

  it("aucune colonne du tout → qtyMax 0, grille vide", () => {
    const g = grilleDepuisColonnes([], 0, 1000, 99, 101, 2);
    expect(g.qtyMax).toBe(0);
    expect(g.cellules.length).toBe(0);
  });
});

describe("intensiteLogDepth", () => {
  it("renvoie 0 si qtyMax <= 0", () => {
    expect(intensiteLogDepth(5, 0)).toBe(0);
    expect(intensiteLogDepth(5, -1)).toBe(0);
  });

  it("renvoie 0 pour qty=0", () => {
    expect(intensiteLogDepth(0, 100)).toBe(0);
  });

  it("renvoie 1 pour qty=qtyMax", () => {
    expect(intensiteLogDepth(100, 100)).toBe(1);
  });

  it("est monotone croissante en qty", () => {
    const a = intensiteLogDepth(10, 1000);
    const b = intensiteLogDepth(100, 1000);
    const c = intensiteLogDepth(500, 1000);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("suit une échelle log (log1p), pas linéaire", () => {
    // Si c'était linéaire, intensiteLogDepth(500, 1000) serait 0.5. En log1p, elle est
    // significativement au-dessus (les petites valeurs sont relevées).
    const t = intensiteLogDepth(500, 1000);
    expect(t).toBeGreaterThan(0.5);
  });
});
