import { describe, expect, it } from "vitest";
import { squarify, type Rect, type Tuile } from "./treemap";

/** Conteneur de référence des tests (400×300 = 120 000 px²). */
const CONTENEUR: Rect = { x: 0, y: 0, w: 400, h: 300 };

/** Aire d'une tuile. */
function aire<T>(t: Tuile<T>): number {
  return t.rect.w * t.rect.h;
}

/** Accès indexé gardé (noUncheckedIndexedAccess actif). */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`élément ${i} absent`);
  return v;
}

describe("squarify — aires proportionnelles", () => {
  it("un seul item remplit exactement le conteneur", () => {
    const tuiles = squarify([{ v: 42 }], (d) => d.v, CONTENEUR);
    expect(tuiles).toHaveLength(1);
    const r = at(tuiles, 0).rect;
    expect(r.x).toBeCloseTo(CONTENEUR.x, 6);
    expect(r.y).toBeCloseTo(CONTENEUR.y, 6);
    expect(r.w).toBeCloseTo(CONTENEUR.w, 6);
    expect(r.h).toBeCloseTo(CONTENEUR.h, 6);
  });

  it("la somme des aires égale l'aire du conteneur", () => {
    const items = [{ v: 10 }, { v: 5 }, { v: 3 }, { v: 2 }, { v: 1 }];
    const tuiles = squarify(items, (d) => d.v, CONTENEUR);
    const totalAire = tuiles.reduce((s, t) => s + aire(t), 0);
    expect(totalAire).toBeCloseTo(CONTENEUR.w * CONTENEUR.h, 4);
  });

  it("l'aire de chaque tuile est proportionnelle à son poids", () => {
    const items = [{ v: 8 }, { v: 4 }, { v: 2 }, { v: 1 }];
    const tuiles = squarify(items, (d) => d.v, CONTENEUR);
    const total = items.reduce((s, d) => s + d.v, 0);
    const aireTotale = CONTENEUR.w * CONTENEUR.h;
    for (const t of tuiles) {
      const attendu = (t.item.v / total) * aireTotale;
      expect(aire(t)).toBeCloseTo(attendu, 3);
    }
  });

  it("un poids double donne une aire double", () => {
    const tuiles = squarify([{ v: 2 }, { v: 1 }], (d) => d.v, CONTENEUR);
    const parV = new Map(tuiles.map((t) => [t.item.v, aire(t)]));
    expect(at([parV.get(2) ?? 0], 0)).toBeCloseTo((parV.get(1) ?? 0) * 2, 3);
  });
});

describe("squarify — bornes & robustesse", () => {
  it("aucune tuile ne déborde du conteneur", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ v: (i % 7) + 1 }));
    const tuiles = squarify(items, (d) => d.v, CONTENEUR);
    const eps = 1e-6;
    for (const t of tuiles) {
      expect(t.rect.x).toBeGreaterThanOrEqual(CONTENEUR.x - eps);
      expect(t.rect.y).toBeGreaterThanOrEqual(CONTENEUR.y - eps);
      expect(t.rect.x + t.rect.w).toBeLessThanOrEqual(CONTENEUR.x + CONTENEUR.w + eps);
      expect(t.rect.y + t.rect.h).toBeLessThanOrEqual(CONTENEUR.y + CONTENEUR.h + eps);
      expect(t.rect.w).toBeGreaterThan(0);
      expect(t.rect.h).toBeGreaterThan(0);
    }
  });

  it("respecte l'offset du conteneur (x/y non nuls)", () => {
    const decale: Rect = { x: 100, y: 50, w: 200, h: 200 };
    const tuiles = squarify([{ v: 3 }, { v: 1 }], (d) => d.v, decale);
    const totalAire = tuiles.reduce((s, t) => s + aire(t), 0);
    expect(totalAire).toBeCloseTo(decale.w * decale.h, 3);
    for (const t of tuiles) {
      expect(t.rect.x).toBeGreaterThanOrEqual(decale.x - 1e-6);
      expect(t.rect.y).toBeGreaterThanOrEqual(decale.y - 1e-6);
    }
  });

  it("ignore les poids nuls, négatifs ou non finis", () => {
    const items = [{ v: 5 }, { v: 0 }, { v: -3 }, { v: NaN }, { v: 5 }];
    const tuiles = squarify(items, (d) => d.v, CONTENEUR);
    expect(tuiles).toHaveLength(2); // seuls les deux v=5 survivent
    const totalAire = tuiles.reduce((s, t) => s + aire(t), 0);
    expect(totalAire).toBeCloseTo(CONTENEUR.w * CONTENEUR.h, 3);
  });

  it("conteneur d'aire nulle → aucune tuile", () => {
    expect(squarify([{ v: 1 }], (d) => d.v, { x: 0, y: 0, w: 0, h: 100 })).toEqual([]);
    expect(squarify([{ v: 1 }], (d) => d.v, { x: 0, y: 0, w: 100, h: -5 })).toEqual([]);
  });

  it("liste vide → aucune tuile", () => {
    expect(squarify([], (d: { v: number }) => d.v, CONTENEUR)).toEqual([]);
  });

  it("ne mute pas le tableau d'entrée", () => {
    const items = [{ v: 1 }, { v: 9 }, { v: 3 }];
    const copie = items.map((d) => ({ ...d }));
    squarify(items, (d) => d.v, CONTENEUR);
    expect(items).toEqual(copie);
  });
});

describe("squarify — déterminisme & tuiles carrées", () => {
  it("est déterministe (deux appels identiques → même résultat)", () => {
    const items = [{ v: 7 }, { v: 3 }, { v: 5 }, { v: 2 }, { v: 8 }];
    const a = squarify(items, (d) => d.v, CONTENEUR);
    const b = squarify(items, (d) => d.v, CONTENEUR);
    expect(a).toEqual(b);
  });

  it("garde des rapports d'aspect raisonnables (< 8) sur 25 items égaux", () => {
    const items = Array.from({ length: 25 }, () => ({ v: 1 }));
    const tuiles = squarify(items, (d) => d.v, { x: 0, y: 0, w: 500, h: 500 });
    // Un slice-and-dice naïf donnerait des rapports ~25 ; le squarified reste modéré.
    for (const t of tuiles) {
      const ratio = Math.max(t.rect.w / t.rect.h, t.rect.h / t.rect.w);
      expect(ratio).toBeLessThan(8);
    }
  });
});
