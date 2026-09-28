import { describe, expect, it } from "vitest";
import { computeCryptoGexDex, type CryptoOptionInput, type GexDexPoint } from "./gexDex";
import {
  construireCarteExpositions,
  construireSourcesCrypto,
  profilExpositionsCrypto,
} from "./carteExpositions";

const NOW = Date.UTC(2026, 8, 28, 12);
const E1 = NOW + 30 * 86_400_000;
const E2 = NOW + 90 * 86_400_000;

function option(partiel: Partial<CryptoOptionInput> = {}): CryptoOptionInput {
  return {
    strike: 100, type: "call", openInterest: 10, markIv: 50, interestRate: 0,
    expiryMs: E1, underlying: 105, indexPrice: 100, ...partiel,
  };
}

function point(strike: number, gex = 1, dex = -2): GexDexPoint {
  return { strike, gex, dex };
}

describe("construireCarteExpositions", () => {
  it("classe les frontières et les extrêmes dans exactement une des huit bandes exhaustives", () => {
    const strikes = [1e-200, 69.999, 70, 84.999, 85, 94.999, 95, 99.999, 100, 104.999, 105, 114.999, 115, 129.999, 130, 1e200];
    const carte = construireCarteExpositions([{ expiryMs: E1, points: strikes.map((k) => point(k)) }], 100);
    expect(carte.bandes.map((b) => [b.minPct, b.maxPct])).toEqual([
      [30, null], [15, 30], [5, 15], [0, 5], [-5, 0], [-15, -5], [-30, -15], [-100, -30],
    ]);
    expect(carte.cellules.map((c) => c.strikes.map((p) => p.strike))).toEqual([
      [130, 1e200], [115, 129.999], [105, 114.999], [100, 104.999],
      [95, 99.999], [85, 94.999], [70, 84.999], [1e-200, 69.999],
    ]);
    expect(carte.total).toEqual({ gex: 16, dex: -32, nbStrikes: 16 });
    expect(carte.cellules.flatMap((c) => c.strikes)).toHaveLength(16);
  });

  it("les bornes en prix suivent le spot, y compris aux petits prix", () => {
    for (const spot of [0.1, 3_457.25, 100_000]) {
      const strikes = [1.3, 1.15, 1.05, 1, .95, .85, .7, .001].map((facteur) => spot * facteur);
      const carte = construireCarteExpositions([{ expiryMs: E1, points: strikes.map((k) => point(k)) }], spot);
      expect(carte.cellules.map((c) => c.nbStrikes)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    }
  });

  it("conserve les sommes signées, une compensation n’est pas une cellule absente", () => {
    const carte = construireCarteExpositions([
      { expiryMs: E2, points: [point(102, 5, 30), point(103, -5, -30)] },
      { expiryMs: E1, points: [] },
    ], 100);
    expect(carte.colonnes).toEqual([
      { expiryMs: E1, gex: null, dex: null, nbStrikes: 0 },
      { expiryMs: E2, gex: 0, dex: 0, nbStrikes: 2 },
    ]);
    const presente = carte.cellules.find((c) => c.expiryMs === E2 && c.idBande === "haut0");
    expect(presente).toMatchObject({ gex: 0, dex: 0, nbStrikes: 2 });
    expect(carte.total).toEqual({ gex: 0, dex: 0, nbStrikes: 2 });
    expect(carte.bandes.find((b) => b.idBande === "haut0")).toMatchObject({ gex: 0, dex: 0 });
    expect(carte.cellules.filter((c) => c !== presente).every((c) => c.gex === null && c.dex === null)).toBe(true);
  });

  it("garde les très petites expositions et fusionne les sources de la même échéance sans doubler les strikes", () => {
    const carte = construireCarteExpositions([
      { expiryMs: E2, points: [point(90, 2, -20)] },
      { expiryMs: E1, points: [point(100, 1e-12, 2e-12)] },
      { expiryMs: E2, points: [point(90, 3, -30)] },
    ], 100);
    expect(carte.colonnes.map((c) => c.expiryMs)).toEqual([E1, E2]);
    expect(carte.cellules.find((c) => c.expiryMs === E1 && c.idBande === "haut0")?.gex).toBe(1e-12);
    expect(carte.cellules.find((c) => c.expiryMs === E2 && c.idBande === "bas15")?.strikes).toEqual([point(90, 5, -50)]);
    expect(carte.total.nbStrikes).toBe(2);
  });

  it("exclut nombres invalides et timestamps non positifs ; les deux métriques ont le même univers", () => {
    const carte = construireCarteExpositions([
      { expiryMs: E1, points: [point(0), point(-1), point(NaN), point(Infinity), point(100, NaN), point(110, 1, Infinity)] },
      { expiryMs: 0, points: [point(100)] },
      { expiryMs: -1, points: [point(100)] },
      { expiryMs: NaN, points: [point(100)] },
    ], 100);
    expect(carte.colonnes).toEqual([{ expiryMs: E1, gex: null, dex: null, nbStrikes: 0 }]);
    expect(carte.total).toEqual({ gex: null, dex: null, nbStrikes: 0 });
    expect(carte.cellules.every((c) => c.strikes.length === 0)).toBe(true);
  });

  it.each([0, -100, NaN, Infinity])("spot %s : aucune affectation ni exposition inventée", (spot) => {
    const carte = construireCarteExpositions([{ expiryMs: E1, points: [point(100)] }], spot);
    expect(carte.total).toEqual({ gex: null, dex: null, nbStrikes: 0 });
    expect(carte.cellules.every((c) => c.gex === null && c.dex === null)).toBe(true);
  });

  it("n’exclut aucune échéance positive : la carte reste indépendante de l’horloge", () => {
    const carte = construireCarteExpositions([{ expiryMs: 1, points: [point(100, 2, 5)] }], 100);
    expect(carte.colonnes[0]).toEqual({ expiryMs: 1, gex: 2, dex: 5, nbStrikes: 1 });
  });
});

describe("construireSourcesCrypto", () => {
  it("trie les échéances actives, garde une échéance sans greeks et exclut les expirées", () => {
    const sources = construireSourcesCrypto([
      option({ expiryMs: E2, markIv: NaN }), option(), option({ expiryMs: NOW }),
      option({ expiryMs: NOW - 1 }), option({ expiryMs: Infinity }),
    ], 100, NOW);
    expect(sources.map((s) => s.expiryMs)).toEqual([E1, E2]);
    expect(sources[0]?.points.length).toBe(1);
    expect(sources[1]?.points).toEqual([]);
  });

  it("les totaux carte, colonnes et bandes conservent les expositions du moteur validé", () => {
    const chaine = [option(), option({ strike: 90, type: "put", openInterest: 7 }),
      option({ expiryMs: E2, strike: 120, underlying: 110, openInterest: 5 })];
    const sources = construireSourcesCrypto(chaine, 100, NOW);
    const carte = construireCarteExpositions(sources, 100);
    const calcul = computeCryptoGexDex(chaine, 100, NOW);
    const gex = calcul.reduce((s, p) => s + p.gex, 0);
    const dex = calcul.reduce((s, p) => s + p.dex, 0);
    for (const ensembles of [carte.colonnes, carte.bandes, carte.cellules]) {
      expect(ensembles.reduce((s, c) => s + (c.gex ?? 0), 0)).toBeCloseTo(gex, 9);
      expect(ensembles.reduce((s, c) => s + (c.dex ?? 0), 0)).toBeCloseTo(dex, 9);
    }
    expect(carte.total.gex).toBeCloseTo(gex, 9);
    expect(carte.total.dex).toBeCloseTo(dex, 9);
  });
});

describe("profilExpositionsCrypto", () => {
  it("simule les deux métriques sur 41 spots, le point central égale les totaux de la carte", () => {
    const chaine = [option(), option({ strike: 90, type: "put", expiryMs: E2 })];
    const { points } = profilExpositionsCrypto(chaine, 100, NOW);
    const carte = construireCarteExpositions(construireSourcesCrypto(chaine, 100, NOW), 100);
    expect(points).toHaveLength(41);
    expect(points[0]?.spot).toBe(85);
    expect(points[20]?.spot).toBe(100);
    expect(points[40]?.spot).toBe(115);
    expect(points[20]?.gex).toBeCloseTo(carte.total.gex!, 9);
    expect(points[20]?.dex).toBeCloseTo(carte.total.dex!, 9);
    expect(points[0]?.dex).not.toBe(points[40]?.dex);
    expect(points[0]?.gex).not.toBe(points[0]?.dex);
  });

  it("conserve la base forward/index : oracle Python indépendant au spot central", () => {
    const chaine = [option({ strike: 100, underlying: 110, markIv: 50, openInterest: 100, expiryMs: NOW + 182.5 * 86_400_000 })];
    const centre = profilExpositionsCrypto(chaine, 100, NOW).points[20];
    expect(centre?.gex).toBeCloseTo(102.1391615366253, 9);
    expect(centre?.dex).toBeCloseTo(6723.294365833989, 3);
  });

  it("absence de chaîne calculable et spot/horloge invalides : profil vide, jamais des zéros", () => {
    expect(profilExpositionsCrypto([], 100, NOW).points).toEqual([]);
    expect(profilExpositionsCrypto([option({ markIv: NaN })], 100, NOW).points).toEqual([]);
    expect(profilExpositionsCrypto([option({ expiryMs: NOW })], 100, NOW).points).toEqual([]);
    expect(profilExpositionsCrypto([option()], NaN, NOW).points).toEqual([]);
    expect(profilExpositionsCrypto([option()], 100, NaN).points).toEqual([]);
  });
});
