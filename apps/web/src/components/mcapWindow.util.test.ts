import { describe, expect, it } from "vitest";
import {
  MARGES,
  domaineValeurs,
  fenetrer,
  indexDepuisX,
  projX,
  projY,
  ticksTemps,
  ticksValeurs,
} from "./mcapWindow.util";

describe("domaineValeurs — extrêmes de la fenêtre, jamais forcés à 0", () => {
  it("ignore les trous et n'inclut PAS 0 de force", () => {
    // Un niveau élevé (2,2 T$ à 2,3 T$) forcé à contenir 0 s'écraserait contre le
    // haut du cadre : c'est la divergence assumée du patron NETLIQ.
    const d = domaineValeurs([[2.2e12, null, 2.3e12]], 0);
    expect(d.min).toBe(2.2e12);
    expect(d.max).toBe(2.3e12);
  });

  it("couvre TOUTES les séries passées", () => {
    const d = domaineValeurs([[10, 20], [5, 40]], 0);
    expect(d).toEqual({ min: 5, max: 40 });
  });

  it("applique la marge demandée de part et d'autre", () => {
    const d = domaineValeurs([[0, 100]], 0.05);
    expect(d.min).toBeCloseTo(-5, 6);
    expect(d.max).toBeCloseTo(105, 6);
  });

  it("élargit un domaine dégénéré (toutes les valeurs égales)", () => {
    const d = domaineValeurs([[42, 42]], 0);
    expect(d.max).toBeGreaterThan(d.min);
  });

  it("rend un domaine par défaut exploitable si tout est absent", () => {
    const d = domaineValeurs([[null, null]], 0);
    expect(Number.isFinite(d.min)).toBe(true);
    expect(d.max).toBeGreaterThan(d.min);
  });
});

describe("projX / indexDepuisX — la réciprocité qui aligne le réticule", () => {
  const largeur = 400;
  const n = 10;

  it("place le premier point sur la marge gauche et le dernier sur la marge droite", () => {
    expect(projX(0, n, largeur)).toBeCloseTo(MARGES.g, 6);
    expect(projX(n - 1, n, largeur)).toBeCloseTo(largeur - MARGES.d, 6);
  });

  it("retrouve exactement l'index de chaque point depuis son abscisse", () => {
    // Sans cette réciprocité, l'infobulle affiche la valeur d'un jour voisin de celui
    // que le trait du curseur désigne (leçon HEATMAP : même géométrie des deux côtés).
    for (let i = 0; i < n; i += 1) {
      expect(indexDepuisX(projX(i, n, largeur), n, largeur)).toBe(i);
    }
  });

  it("clampe hors cadre au lieu de sortir du tableau", () => {
    expect(indexDepuisX(-500, n, largeur)).toBe(0);
    expect(indexDepuisX(9_999, n, largeur)).toBe(n - 1);
  });

  it("dégénère proprement sur un point unique", () => {
    expect(projX(0, 1, largeur)).toBeCloseTo(MARGES.g, 6);
    expect(indexDepuisX(200, 1, largeur)).toBe(0);
  });
});

describe("projY", () => {
  it("place le maximum en haut et le minimum en bas du cadre", () => {
    const hauteur = 200;
    expect(projY(100, 0, 100, hauteur)).toBeCloseTo(MARGES.h, 6);
    expect(projY(0, 0, 100, hauteur)).toBeCloseTo(hauteur - MARGES.b, 6);
  });

  it("centre la valeur sur un domaine dégénéré", () => {
    const hauteur = 200;
    const y = projY(5, 5, 5, hauteur);
    expect(y).toBeGreaterThan(MARGES.h);
    expect(y).toBeLessThan(hauteur - MARGES.b);
  });
});

describe("ticksValeurs — bornes rondes, quelle que soit l'échelle", () => {
  it("rend des multiples ronds sur une échelle de pourcentages", () => {
    const t = ticksValeurs(0, 60, 4);
    expect(t.length).toBeGreaterThan(1);
    for (const v of t) expect(Number.isFinite(v)).toBe(true);
    expect(t.every((v) => v >= 0 && v <= 60)).toBe(true);
  });

  it("fonctionne aussi sur des milliers de milliards (USD)", () => {
    const t = ticksValeurs(2.2e12, 2.6e12, 4);
    expect(t.length).toBeGreaterThan(1);
    const pas = (t[1] ?? 0) - (t[0] ?? 0);
    expect(pas).toBeGreaterThan(0);
    for (let i = 2; i < t.length; i += 1) {
      expect((t[i] ?? 0) - (t[i - 1] ?? 0)).toBeCloseTo(pas, 3);
    }
  });

  it("rend une liste vide sur des bornes invalides", () => {
    expect(ticksValeurs(10, 10, 4)).toEqual([]);
    expect(ticksValeurs(Number.NaN, 10, 4)).toEqual([]);
  });
});

describe("ticksTemps", () => {
  const grille = Array.from({ length: 365 }, (_, i) => Date.parse("2025-08-01T00:00:00Z") + i * 86_400_000);

  it("espace les étiquettes selon la largeur disponible", () => {
    const etroit = ticksTemps(grille, 300);
    const large = ticksTemps(grille, 1200);
    expect(large.length).toBeGreaterThan(etroit.length);
    expect(etroit.length).toBeGreaterThan(0);
  });

  it("rend des index valides et des libellés non vides", () => {
    for (const t of ticksTemps(grille, 800)) {
      expect(t.i).toBeGreaterThanOrEqual(0);
      expect(t.i).toBeLessThan(grille.length);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });

  it("ne rend rien sur une grille vide", () => {
    expect(ticksTemps([], 800)).toEqual([]);
  });
});

describe("fenetrer", () => {
  const serie = Array.from({ length: 100 }, (_, i) => i);

  it("garde les N derniers jours", () => {
    expect(fenetrer(serie, 30)).toHaveLength(30);
    expect(fenetrer(serie, 30)[0]).toBe(70);
  });

  it("rend la série entière pour « Tout » (null)", () => {
    expect(fenetrer(serie, null)).toHaveLength(100);
  });

  it("ne dépasse pas la longueur disponible", () => {
    expect(fenetrer(serie, 5_000)).toHaveLength(100);
  });
});
