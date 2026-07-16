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
  it("compte la part des valeurs ≤ valeur (ties inclus)", () => {
    expect(rangPercentile([1, 2, 3, 4], 4)).toBe(100);
    expect(rangPercentile([1, 2, 3, 4], 1)).toBe(25);
    expect(rangPercentile([1, 2, 3, 4], 0)).toBe(0);
    expect(rangPercentile([1, 2, 2, 4], 2)).toBe(75);
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
    expect(ref?.percentile).toBe(100);
    expect(ref?.profondeurJours).toBe(10);
    expect(ref?.n).toBe(241);
  });
  it("ignore les v non finis", () => {
    const serie: PointSerie[] = [
      { t: now - 6 * JOUR_MS, v: 1 },
      { t: now - 3 * JOUR_MS, v: Number.NaN },
      { t: now, v: 3 },
    ];
    const ref = referentiel(serie, 2, now);
    expect(ref?.n).toBe(2);
    expect(ref?.percentile).toBe(50);
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
