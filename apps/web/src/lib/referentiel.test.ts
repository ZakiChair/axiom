import { describe, expect, it } from "vitest";
import {
  estExtreme,
  rangPercentile,
  referentiel,
  texteRef,
  type PointSerie,
} from "./referentiel";

const JOUR_MS = 86_400_000;

/** Série linéaire : n points espacés d'une heure, v = 1..n, se terminant à `fin`. */
function serieLineaire(n: number, fin: number): PointSerie[] {
  return Array.from({ length: n }, (_, i) => ({
    t: fin - (n - 1 - i) * 3_600_000,
    v: i + 1,
  }));
}

describe("rangPercentile", () => {
  it("rang mi-distance : (strictement sous + ties / 2) / n", () => {
    expect(rangPercentile([1, 2, 3, 4], 4)).toBe(87.5);
    expect(rangPercentile([1, 2, 3, 4], 1)).toBe(12.5);
    expect(rangPercentile([1, 2, 3, 4], 0)).toBe(0);
    expect(rangPercentile([1, 2, 2, 4], 2)).toBe(50);
    // Masse d'égalités (funding clampé) = neutre, plus jamais p100.
    expect(rangPercentile([5, 5, 5, 5, 5], 5)).toBe(50);
  });
  it("renvoie NaN sous 2 valeurs", () => {
    expect(rangPercentile([], 1)).toBeNaN();
    expect(rangPercentile([1], 1)).toBeNaN();
  });
});

describe("referentiel", () => {
  const now = 1_700_000_000_000;
  it("null si série trop courte ou trop peu profonde", () => {
    expect(referentiel([], 1, now)).toBeNull();
    expect(referentiel(serieLineaire(2, now), 1, now)).toBeNull(); // 1 h de profondeur
  });
  it("calcule percentile, profondeur en jours et n", () => {
    const serie = serieLineaire(241, now); // 240 h = 10 j
    const ref = referentiel(serie, 241, now);
    expect(ref).not.toBeNull();
    expect(ref?.percentile).toBeCloseTo((240.5 / 241) * 100, 6);
    expect(ref?.profondeurJours).toBe(10);
    expect(ref?.n).toBe(241);
  });
  it("ignore les v non finis", () => {
    const serie: PointSerie[] = [
      { t: now - 6 * JOUR_MS, v: 1 },
      { t: now - 3 * JOUR_MS, v: Number.NaN },
      { t: now, v: 3 },
    ];
    const ref = referentiel(serie, 2, now, { minObservations: 2 });
    expect(ref?.n).toBe(2);
    expect(ref?.percentile).toBe(50);
  });

  it("mesure la profondeur entre premier et dernier point, séparément de l'âge", () => {
    const serie = Array.from({ length: 20 }, (_, i) => ({
      t: now - (30 - i) * JOUR_MS,
      v: i + 1,
    }));
    const ref = referentiel(serie, 10, now);
    expect(ref?.profondeurJours).toBe(19);
    expect(ref?.ageJours).toBe(11);
  });

  it("refuse deux observations anciennes rapprochées au lieu de compter leur âge comme profondeur", () => {
    expect(
      referentiel(
        [
          { t: now - 30 * JOUR_MS, v: 1 },
          { t: now - 29 * JOUR_MS, v: 2 },
        ],
        2,
        now,
      ),
    ).toBeNull();
  });

  it("écarte timestamps invalides, futurs et doublons avant de compter les observations", () => {
    const serie = Array.from({ length: 20 }, (_, i) => ({ t: now - (20 - i) * JOUR_MS, v: i + 1 }));
    serie.push(
      { t: Number.NaN, v: 999 },
      { t: now + JOUR_MS, v: 999 },
      { t: serie[0]!.t, v: 100 },
    );
    const ref = referentiel(serie, 10, now);
    expect(ref?.n).toBe(20);
    expect(ref?.percentile).toBe(42.5);
  });

  it("demande 20 observations par défaut et refuse une couverture connue trop trouée", () => {
    const dixNeuf = Array.from({ length: 19 }, (_, i) => ({ t: now - (19 - i) * JOUR_MS, v: i }));
    expect(referentiel(dixNeuf, 10, now)).toBeNull();

    const trouee = Array.from({ length: 20 }, (_, i) => ({ t: now - (40 - i * 2) * JOUR_MS, v: i }));
    expect(referentiel(trouee, 10, now, { cadenceAttendueMs: JOUR_MS })).toBeNull();
  });

  it("expose la couverture de cadence et permet un minimum explicite compatible", () => {
    const serie = Array.from({ length: 8 }, (_, i) => ({ t: now - (7 - i) * JOUR_MS, v: i }));
    const ref = referentiel(serie, 4, now, { cadenceAttendueMs: JOUR_MS, minObservations: 2 });
    expect(ref?.couverture).toEqual({ disponibles: 8, attendus: 8 });
  });

  it("refuse une dernière observation périmée quand un âge maximal est fourni", () => {
    const serie = Array.from({ length: 20 }, (_, i) => ({ t: now - (30 - i) * JOUR_MS, v: i }));
    expect(referentiel(serie, 10, now, { ageMaxMs: 5 * JOUR_MS })).toBeNull();
  });
});

describe("texteRef / estExtreme", () => {
  it("formate « pNN · NN j »", () => {
    expect(texteRef({ percentile: 96.6, profondeurJours: 12.4, n: 270 })).toBe("p97 · 12 j");
  });
  it("extrême au-delà de p90 / en-deçà de p10", () => {
    expect(estExtreme({ percentile: 90, profondeurJours: 30, n: 90 })).toBe(true);
    expect(estExtreme({ percentile: 10, profondeurJours: 30, n: 90 })).toBe(true);
    expect(estExtreme({ percentile: 50, profondeurJours: 30, n: 90 })).toBe(false);
  });
});
