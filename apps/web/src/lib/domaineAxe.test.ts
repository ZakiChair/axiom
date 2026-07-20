// apps/web/src/lib/domaineAxe.test.ts
/** Tests des maths pures de domaine d'axe (zoom, pan, clamp, conversions). */
import { describe, expect, it } from "vitest";
import {
  clampDomaine,
  deplacerDomaine,
  domainePourPreset,
  indicesVisibles,
  pixelVersValeur,
  valeurVersPixel,
  zoomerDomaine,
  type Domaine,
} from "./domaineAxe";

const JOUR_MS = 86_400_000;
const bornes: Domaine = { min: 0, max: 1000 };

describe("clampDomaine", () => {
  it("recadre un domaine qui déborde sans changer sa largeur", () => {
    expect(clampDomaine({ min: -100, max: 200 }, bornes)).toEqual({ min: 0, max: 300 });
    expect(clampDomaine({ min: 900, max: 1200 }, bornes)).toEqual({ min: 700, max: 1000 });
  });
  it("un domaine plus large que les bornes → les bornes", () => {
    expect(clampDomaine({ min: -500, max: 2000 }, bornes)).toEqual(bornes);
  });
});

describe("zoomerDomaine", () => {
  it("le pivot garde sa position relative après zoom", () => {
    const d: Domaine = { min: 0, max: 1000 };
    const z = zoomerDomaine(d, 2, 250, bornes); // zoom ×2 autour de 250 (à 25 %)
    expect(z.max - z.min).toBeCloseTo(500);
    expect((250 - z.min) / (z.max - z.min)).toBeCloseTo(0.25);
  });
  it("respecte la largeur minimale (1 % des bornes)", () => {
    const z = zoomerDomaine({ min: 400, max: 420 }, 1e9, 410, bornes);
    expect(z.max - z.min).toBeCloseTo(10); // 1 % de 1000
  });
  it("zoom arrière clampé aux bornes", () => {
    expect(zoomerDomaine({ min: 100, max: 900 }, 0.1, 500, bornes)).toEqual(bornes);
  });
});

describe("deplacerDomaine", () => {
  it("translate sans changer la largeur", () => {
    expect(deplacerDomaine({ min: 100, max: 300 }, 50, bornes)).toEqual({ min: 150, max: 350 });
  });
  it("s'arrête aux bornes", () => {
    expect(deplacerDomaine({ min: 100, max: 300 }, -500, bornes)).toEqual({ min: 0, max: 200 });
    expect(deplacerDomaine({ min: 700, max: 900 }, 500, bornes)).toEqual({ min: 800, max: 1000 });
  });
});

describe("conversions pixel↔valeur", () => {
  const d: Domaine = { min: 100, max: 300 };
  it("aller-retour stable", () => {
    const v = pixelVersValeur(d, 250, 500);
    expect(v).toBeCloseTo(200);
    expect(valeurVersPixel(d, v, 500)).toBeCloseTo(250);
  });
});

describe("indicesVisibles", () => {
  const pts = [0, 100, 200, 300, 400, 500].map((t) => ({ t }));
  it("inclut un point au-delà de chaque bord (continuité des lignes)", () => {
    expect(indicesVisibles(pts, (p) => p.t, { min: 150, max: 350 })).toEqual({ debut: 1, fin: 4 });
  });
  it("domaine couvrant tout → toute la série", () => {
    expect(indicesVisibles(pts, (p) => p.t, { min: -10, max: 600 })).toEqual({ debut: 0, fin: 5 });
  });
  it("série vide → {0, -1}", () => {
    expect(indicesVisibles([], (p: { t: number }) => p.t, { min: 0, max: 1 })).toEqual({ debut: 0, fin: -1 });
  });
});

describe("domainePourPreset", () => {
  const b: Domaine = { min: 0, max: 400 * JOUR_MS };
  it("N jours = fenêtre ancrée sur max", () => {
    expect(domainePourPreset(b, 30)).toEqual({ min: 400 * JOUR_MS - 30 * JOUR_MS, max: 400 * JOUR_MS });
  });
  it("null = tout", () => {
    expect(domainePourPreset(b, null)).toEqual(b);
  });
  it("préréglage plus large que les données → les bornes", () => {
    expect(domainePourPreset({ min: 0, max: 10 * JOUR_MS }, 30)).toEqual({ min: 0, max: 10 * JOUR_MS });
  });
});
