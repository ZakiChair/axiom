import { describe, expect, it } from "vitest";
import { construireCarteExpositions } from "./carteExpositions";
import { construireGraphiqueExpositions } from "./graphiqueExpositions";

const E1 = Date.UTC(2026, 9, 2, 8);
const E2 = Date.UTC(2026, 9, 9, 8);
const point = (strike: number, gex = 1, dex = 2) => ({ strike, gex, dex });

describe("construireGraphiqueExpositions", () => {
  it("consolide les mêmes strikes entre échéances, trie et conserve les sommes signées", () => {
    const carte = construireCarteExpositions([
      { expiryMs: E2, points: [point(120, -3, 20), point(100, 4, 10)] },
      { expiryMs: E1, points: [point(100, 6, -30), point(70, 1, 5), point(130, 2, 1)] },
    ], 100);
    const graphique = construireGraphiqueExpositions(carte, 100, "tous");
    expect(graphique.points).toEqual([point(70, 1, 5), point(100, 10, -20), point(120, -3, 20), point(130, 2, 1)]);
    expect(graphique.nbStrikesTotal).toBe(4);
    expect(graphique.nbStrikesAffiches).toBe(4);
    expect(carte.total.nbStrikes).toBe(5); // Couples (échéance, strike), distincts des barres.
    expect(graphique.netVisible).toEqual({ gex: 10, dex: 6 });
    expect(graphique.netTotal).toEqual({ gex: carte.total.gex, dex: carte.total.dex });
    expect(graphique.echeances.reduce((s, e) => s + e.gex!, 0)).toBe(10);
    expect(graphique.echeances.reduce((s, e) => s + e.dex!, 0)).toBe(6);
  });

  it("le cadrage proche inclut exactement ±30 % et ne change ni totaux ni échéances", () => {
    const carte = construireCarteExpositions([{ expiryMs: E1,
      points: [point(69.999, 10, 20), point(70, 1, 2), point(130, -2, 3), point(130.001, 4, 5)],
    }], 100);
    const proche = construireGraphiqueExpositions(carte, 100, "proche");
    const tous = construireGraphiqueExpositions(carte, 100, "tous");
    expect(proche.domainePrix).toEqual({ min: 70, max: 130 });
    expect(proche.points).toEqual([point(70, 1, 2), point(130, -2, 3)]);
    expect(proche.nbStrikesAffiches).toBe(2);
    expect(proche.nbStrikesTotal).toBe(4);
    expect(proche.netVisible).toEqual({ gex: -1, dex: 5 });
    expect(proche.netTotal).toEqual({ gex: 13, dex: 30 });
    expect(proche.netTotal).toEqual(tous.netTotal);
    expect(proche.echeances).toEqual(tous.echeances);
  });

  it("le domaine tous contient le spot et tous les strikes sur une vraie échelle de prix", () => {
    const carte = construireCarteExpositions([{ expiryMs: E1, points: [point(80), point(90)] }], 100);
    expect(construireGraphiqueExpositions(carte, 200, "tous").domainePrix).toEqual({ min: 80, max: 200 });
    expect(construireGraphiqueExpositions(carte, 50, "tous").domainePrix).toEqual({ min: 50, max: 90 });
  });

  it("une compensation calculée reste zéro ; une colonne sans calcul reste absente", () => {
    const carte = construireCarteExpositions([
      { expiryMs: E1, points: [point(100, 7, 20)] },
      { expiryMs: E2, points: [point(100, -7, -20)] },
      { expiryMs: E2 + 1, points: [] },
    ], 100);
    const graphique = construireGraphiqueExpositions(carte, 100, "tous");
    expect(graphique.points).toEqual([point(100, 0, 0)]);
    expect(graphique.netVisible).toEqual({ gex: 0, dex: 0 });
    expect(graphique.echeances[2]).toEqual({ expiryMs: E2 + 1, gex: null, dex: null, nbStrikes: 0 });
  });

  it("une carte sans calcul garde les dates connues, sans domaine ou faux zéros", () => {
    const carte = construireCarteExpositions([{ expiryMs: E1, points: [] }], 100);
    const graphique = construireGraphiqueExpositions(carte, 100, "proche");
    expect(graphique.points).toEqual([]);
    expect(graphique.domainePrix).toBeNull();
    expect(graphique.netVisible).toEqual({ gex: null, dex: null });
    expect(graphique.netTotal).toEqual({ gex: null, dex: null });
    expect(graphique.nbStrikesTotal).toBe(0);
    expect(graphique.echeances).toEqual(carte.colonnes);
  });

  it("un seul prix élargit seulement le domaine de 1 %, sans inventer de strike", () => {
    const carte = construireCarteExpositions([{ expiryMs: E1, points: [point(100)] }], 100);
    const graphique = construireGraphiqueExpositions(carte, 100, "tous");
    expect(graphique.domainePrix).toEqual({ min: 99, max: 101 });
    expect(graphique.points).toEqual([point(100)]);
  });

  it("les prix extrêmes et les minuscules expositions ne sont jamais filtrés par taille", () => {
    const carte = construireCarteExpositions([{ expiryMs: E1, points: [point(1e-200, 1e-20, -1e-20), point(1e200)] }], 100);
    const graphique = construireGraphiqueExpositions(carte, 100, "tous");
    expect(graphique.domainePrix).toEqual({ min: 1e-200, max: 1e200 });
    expect(graphique.points).toEqual([point(1e-200, 1e-20, -1e-20), point(1e200)]);
  });

  it("spot invalide : proche indisponible, tous conserve uniquement les vrais prix", () => {
    const carte = construireCarteExpositions([{ expiryMs: E1, points: [point(80), point(120)] }], 100);
    const proche = construireGraphiqueExpositions(carte, NaN, "proche");
    expect(proche.domainePrix).toBeNull();
    expect(proche.points).toEqual([]);
    expect(proche.netVisible).toEqual({ gex: null, dex: null });
    expect(proche.netTotal).toEqual({ gex: 2, dex: 4 });
    expect(proche.nbStrikesTotal).toBe(2);
    expect(construireGraphiqueExpositions(carte, NaN, "tous").domainePrix).toEqual({ min: 80, max: 120 });
  });

  it("garde le domaine fini au prix maximal et refuse un zoom dont les bornes débordent", () => {
    const carte = construireCarteExpositions([{ expiryMs: E1, points: [point(Number.MAX_VALUE)] }], 100);
    const tous = construireGraphiqueExpositions(carte, NaN, "tous");
    expect(tous.domainePrix?.min).toBeGreaterThan(0);
    expect(tous.domainePrix?.min).toBeLessThan(Number.MAX_VALUE);
    expect(tous.domainePrix?.max).toBe(Number.MAX_VALUE);
    const proche = construireGraphiqueExpositions(carte, Number.MAX_VALUE, "proche");
    expect(proche.domainePrix).toBeNull();
    expect(proche.points).toEqual([]);
  });

  it("ne mute pas la carte et une fenêtre sans strike rend un net visible absent", () => {
    const carte = construireCarteExpositions([{ expiryMs: E1, points: [point(200)] }], 100);
    const avant = JSON.stringify(carte);
    for (const c of carte.cellules) { c.strikes.forEach(Object.freeze); Object.freeze(c.strikes); Object.freeze(c); }
    carte.colonnes.forEach(Object.freeze);
    const proche = construireGraphiqueExpositions(carte, 100, "proche");
    expect(proche.netVisible).toEqual({ gex: null, dex: null });
    expect(proche.netTotal).toEqual({ gex: 1, dex: 2 });
    expect(proche.domainePrix).toEqual({ min: 70, max: 130 });
    const tous = construireGraphiqueExpositions(carte, 100, "tous");
    tous.points[0]!.gex = 999;
    tous.echeances[0]!.gex = 999;
    tous.netTotal.gex = 999;
    expect(JSON.stringify(carte)).toBe(avant);
  });
});
