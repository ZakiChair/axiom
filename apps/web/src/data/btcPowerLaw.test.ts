import { describe, expect, it } from "vitest";
import type { PointMetrique } from "./onchain/coinmetrics";
import {
  BTC_GENESIS_MS,
  JOUR_MS,
  ajusterBtcPowerLaw,
  bornesLogPrixBtcPowerLaw,
  courbeBtcPowerLaw,
  logJoursBtc,
  intervallesBtcPowerLaw,
  percentileBtcPowerLaw,
  prixQuantileBtcPowerLaw,
  prixTendanceBtcPowerLaw,
  reperesAxeBtcPowerLaw,
  ticksPrixBtcPowerLaw,
  timeDepuisLogJours,
} from "./btcPowerLaw";

function point(x: number, logPrix: number): PointMetrique {
  return {
    time: BTC_GENESIS_MS + 10 ** x * JOUR_MS,
    value: 10 ** logPrix,
  };
}

describe("ajusterBtcPowerLaw", () => {
  it("retrouve une loi de puissance log10(prix) = 2 + 3 × log10(jours)", () => {
    const modele = ajusterBtcPowerLaw([
      point(1, 5),
      point(2, 8),
      point(3, 11),
      point(4, 14),
    ]);

    expect(modele).not.toBeNull();
    expect(modele?.pente).toBeCloseTo(3, 12);
    expect(modele?.intercept).toBeCloseTo(2, 12);
    expect(modele?.r2).toBeCloseTo(1, 12);
    expect(modele?.n).toBe(4);
    expect(modele?.quantiles[50]).toBeCloseTo(0, 12);
    expect(prixTendanceBtcPowerLaw(modele!, BTC_GENESIS_MS + 100 * JOUR_MS)).toBeCloseTo(1e8, 2);
  });

  it("calcule des quantiles de résidus asymétriques sans les symétriser", () => {
    const residus = [-2, 1, 2, 1, -2];
    const modele = ajusterBtcPowerLaw(
      residus.map((residu, i) => {
        const x = i + 1;
        return point(x, 2 + 3 * x + residu);
      }),
    );

    expect(modele).not.toBeNull();
    expect(modele?.pente).toBeCloseTo(3, 10);
    expect(modele?.intercept).toBeCloseTo(2, 10);
    expect(modele?.quantiles[25]).toBeCloseTo(-2, 10);
    expect(modele?.quantiles[50]).toBeCloseTo(1, 10);
    expect(modele?.quantiles[75]).toBeCloseTo(1, 10);

    const cible = BTC_GENESIS_MS + 1_000 * JOUR_MS;
    const tendance = prixTendanceBtcPowerLaw(modele!, cible);
    expect(prixQuantileBtcPowerLaw(modele!, cible, 25)).toBeCloseTo(tendance * 0.01, 4);
    expect(prixQuantileBtcPowerLaw(modele!, cible, 50)).toBeCloseTo(tendance * 10, 4);
  });

  it("filtre les entrées invalides et conserve les bornes temporelles valides", () => {
    const valides = [point(3, 8), point(1, 4), point(2, 6)];
    const modele = ajusterBtcPowerLaw([
      { time: BTC_GENESIS_MS, value: 1 },
      { time: BTC_GENESIS_MS + JOUR_MS, value: 0 },
      { time: Number.NaN, value: 10 },
      ...valides,
    ]);

    expect(modele?.n).toBe(3);
    expect(modele?.debutMs).toBe(valides[1]?.time);
    expect(modele?.finMs).toBe(valides[0]?.time);
  });

  it("refuse un échantillon insuffisant ou sans variance temporelle", () => {
    expect(ajusterBtcPowerLaw([point(1, 2), point(2, 3)])).toBeNull();
    const memeDate = BTC_GENESIS_MS + 10 * JOUR_MS;
    expect(ajusterBtcPowerLaw([
      { time: memeDate, value: 1 },
      { time: memeDate, value: 2 },
      { time: memeDate, value: 3 },
    ])).toBeNull();
  });
});

describe("bandes de présence historiques", () => {
  const residus = [-2, 1, 2, 1, -2];
  const modele = ajusterBtcPowerLaw(
    residus.map((residu, i) => {
      const x = i + 1;
      return point(x, 2 + 3 * x + residu);
    }),
  )!;
  const cible = BTC_GENESIS_MS + 1_000 * JOUR_MS;

  it("expose les bandes centrales 50 %, 80 % et 90 %, correctement imbriquées", () => {
    const bandes = intervallesBtcPowerLaw(modele, cible);
    expect(bandes.map((b) => b.couverture)).toEqual([50, 80, 90]);
    expect(bandes[1]?.bas).toBeLessThanOrEqual(bandes[0]!.bas);
    expect(bandes[1]?.haut).toBeGreaterThanOrEqual(bandes[0]!.haut);
    expect(bandes[2]?.bas).toBeLessThanOrEqual(bandes[1]!.bas);
    expect(bandes[2]?.haut).toBeGreaterThanOrEqual(bandes[1]!.haut);
  });

  it("situe un prix selon le rang mi-distance de son résidu historique", () => {
    const tendance = prixTendanceBtcPowerLaw(modele, cible);
    expect(percentileBtcPowerLaw(modele, cible, tendance * 10)).toBeCloseTo(60, 10);
  });

  it("renvoie NaN pour une date ou un prix non projetable", () => {
    expect(Number.isNaN(prixTendanceBtcPowerLaw(modele, BTC_GENESIS_MS))).toBe(true);
    expect(Number.isNaN(percentileBtcPowerLaw(modele, cible, 0))).toBe(true);
  });
});

describe("axe log10(jours)", () => {
  it("fait l'aller-retour entre horodatage et abscisse logarithmique", () => {
    const time = BTC_GENESIS_MS + 1_234 * JOUR_MS;
    expect(logJoursBtc(time)).toBeCloseTo(Math.log10(1_234), 12);
    expect(timeDepuisLogJours(logJoursBtc(time))).toBeCloseTo(time, 3);
  });

  it("renvoie NaN avant la genèse", () => {
    expect(Number.isNaN(logJoursBtc(BTC_GENESIS_MS))).toBe(true);
    expect(Number.isNaN(logJoursBtc(BTC_GENESIS_MS - JOUR_MS))).toBe(true);
  });
});

describe("courbeBtcPowerLaw", () => {
  const modele = ajusterBtcPowerLaw([point(1, 5), point(2, 8), point(3, 11), point(4, 14)])!;

  it("échantillonne uniformément en log10(jours) entre les bornes demandées", () => {
    const courbe = courbeBtcPowerLaw(modele, 2, 4, 5);
    expect(courbe).toHaveLength(5);
    expect(courbe.map((p) => logJoursBtc(p.time))).toEqual([
      expect.closeTo(2, 9),
      expect.closeTo(2.5, 9),
      expect.closeTo(3, 9),
      expect.closeTo(3.5, 9),
      expect.closeTo(4, 9),
    ]);
  });

  it("reprend exactement la tendance et les quantiles analytiques", () => {
    const courbe = courbeBtcPowerLaw(modele, 2, 4, 3);
    const milieu = courbe[1]!;
    expect(milieu.tendance).toBeCloseTo(prixTendanceBtcPowerLaw(modele, milieu.time), 6);
    expect(milieu.q5).toBeCloseTo(prixQuantileBtcPowerLaw(modele, milieu.time, 5), 6);
    expect(milieu.q95).toBeCloseTo(prixQuantileBtcPowerLaw(modele, milieu.time, 95), 6);
  });

  it("garde au moins deux points et plafonne l'échantillonnage", () => {
    expect(courbeBtcPowerLaw(modele, 2, 4, 1)).toHaveLength(2);
    expect(courbeBtcPowerLaw(modele, 2, 4, 10_000)).toHaveLength(2_000);
  });

  it("renvoie une courbe vide pour une fenêtre non traçable", () => {
    expect(courbeBtcPowerLaw(modele, 4, 2, 10)).toEqual([]);
    expect(courbeBtcPowerLaw(modele, Number.NaN, 4, 10)).toEqual([]);
  });
});

describe("bornesLogPrixBtcPowerLaw", () => {
  const modele = ajusterBtcPowerLaw([point(1, 5), point(2, 8), point(3, 11), point(4, 14)])!;

  it("englobe les prix visibles et les quantiles extrêmes, marge comprise", () => {
    const courbe = courbeBtcPowerLaw(modele, 2, 3, 2);
    const bornes = bornesLogPrixBtcPowerLaw([point(2.5, 9.5)], courbe)!;
    const basCourbe = Math.min(...courbe.map((p) => Math.log10(p.q5)));
    const hautCourbe = Math.max(...courbe.map((p) => Math.log10(p.q95)));
    expect(bornes.yMin).toBeLessThan(Math.min(basCourbe, 9.5));
    expect(bornes.yMax).toBeGreaterThan(Math.max(hautCourbe, 9.5));
    const brut = Math.max(hautCourbe, 9.5) - Math.min(basCourbe, 9.5);
    expect(bornes.yMax - bornes.yMin).toBeCloseTo(brut * 1.1, 9);
  });

  it("tient sans prix visible et refuse un ensemble entièrement vide", () => {
    const courbe = courbeBtcPowerLaw(modele, 2, 3, 2);
    expect(bornesLogPrixBtcPowerLaw([], courbe)).not.toBeNull();
    expect(bornesLogPrixBtcPowerLaw([], [])).toBeNull();
  });
});

describe("reperesAxeBtcPowerLaw", () => {
  const bornes = (debut: number, fin: number) =>
    reperesAxeBtcPowerLaw(logJoursBtc(debut), logJoursBtc(fin));

  it("place des 1ers janvier au-delà de trois ans de fenêtre", () => {
    const reperes = bornes(Date.UTC(2013, 0, 1), Date.UTC(2017, 0, 1));
    expect(reperes.granularite).toBe("annee");
    expect(reperes.times).toEqual([2013, 2014, 2015, 2016, 2017].map((a) => Date.UTC(a, 0, 1)));
  });

  it("bascule sur les débuts de mois entre trois mois et trois ans", () => {
    const reperes = bornes(Date.UTC(2013, 0, 15), Date.UTC(2013, 5, 1));
    expect(reperes.granularite).toBe("mois");
    expect(reperes.times).toEqual([0, 1, 2, 3, 4, 5].map((m) => Date.UTC(2013, m, 1)));
  });

  it("bascule sur les jours sous trois mois — un zoom profond garde des repères", () => {
    const reperes = bornes(Date.UTC(2013, 2, 10), Date.UTC(2013, 3, 9));
    expect(reperes.granularite).toBe("jour");
    expect(reperes.times).toHaveLength(31);
    expect(reperes.times[0]).toBe(Date.UTC(2013, 2, 10));
    expect(reperes.times[30]).toBe(Date.UTC(2013, 3, 9));
  });

  it("renvoie des repères strictement croissants et couvrant la fenêtre", () => {
    for (const fenetre of [
      [Date.UTC(2010, 6, 18), Date.UTC(2076, 0, 1)],
      [Date.UTC(2020, 0, 1), Date.UTC(2021, 6, 1)],
      [Date.UTC(2015, 4, 3), Date.UTC(2015, 4, 25)],
    ] as const) {
      const { times } = bornes(fenetre[0], fenetre[1]);
      expect(times.length).toBeGreaterThan(1);
      expect(times.every((t, i) => i === 0 || t > times[i - 1]!)).toBe(true);
      expect(times.some((t) => t >= fenetre[0] && t <= fenetre[1])).toBe(true);
    }
  });

  it("refuse une fenêtre non traçable", () => {
    expect(reperesAxeBtcPowerLaw(4, 2).times).toEqual([]);
    expect(reperesAxeBtcPowerLaw(Number.NaN, 4).times).toEqual([]);
  });
});

describe("ticksPrixBtcPowerLaw", () => {
  it("reste sur les mêmes décennies quand la vue glisse — pas de saut de parité", () => {
    const pasDeuxDecennies = ticksPrixBtcPowerLaw(-1.3, 9);
    const apresLegerGlissement = ticksPrixBtcPowerLaw(-1.25, 9.05);
    expect(pasDeuxDecennies).toEqual(apresLegerGlissement);
    expect(pasDeuxDecennies).toEqual([1, 1e2, 1e4, 1e6, 1e8]);
  });

  it("affine les mantisses à mesure que la plage se resserre", () => {
    expect(ticksPrixBtcPowerLaw(3, 4.5)).toEqual([1e3, 2e3, 5e3, 1e4, 2e4]);
    expect(ticksPrixBtcPowerLaw(0.65, 1.05)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("ne sort jamais de la plage demandée et refuse une plage vide", () => {
    for (const [bas, haut] of [[-1.3, 9], [3, 4.5], [0.65, 1.05], [2.4, 2.9]] as const) {
      for (const tick of ticksPrixBtcPowerLaw(bas, haut)) {
        expect(Math.log10(tick)).toBeGreaterThanOrEqual(bas - 1e-12);
        expect(Math.log10(tick)).toBeLessThanOrEqual(haut + 1e-12);
      }
    }
    expect(ticksPrixBtcPowerLaw(4, 2)).toEqual([]);
    expect(ticksPrixBtcPowerLaw(Number.NaN, 2)).toEqual([]);
  });
});
