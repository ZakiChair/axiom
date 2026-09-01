import { describe, expect, it } from "vitest";
import type { PointMetrique } from "./onchain/coinmetrics";
import {
  BTC_GENESIS_MS,
  JOUR_MS,
  ajusterBtcPowerLaw,
  intervallesBtcPowerLaw,
  percentileBtcPowerLaw,
  prixQuantileBtcPowerLaw,
  prixTendanceBtcPowerLaw,
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
