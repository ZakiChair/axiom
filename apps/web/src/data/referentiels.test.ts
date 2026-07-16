import { describe, expect, it } from "vitest";
import { bucketsHoraires, deltasFenetre } from "./referentiels";
import type { PointSerie } from "../lib/referentiel";

const H = 3_600_000;

describe("deltasFenetre", () => {
  const base = 1_700_000_000_000;
  const points: PointSerie[] = [
    { t: base, v: 100 },
    { t: base + H, v: 110 },
    { t: base + 2 * H, v: 99 },
  ];
  it("variation % vs le dernier point ≤ t − fenêtre", () => {
    const d = deltasFenetre(points, H);
    expect(d).toHaveLength(2);
    expect(d[0]?.t).toBe(base + H);
    expect(d[0]?.v).toBeCloseTo(10, 6);
    expect(d[1]?.v).toBeCloseTo(-10, 6);
  });
  it("fenêtre plus large que la série → vide ; référence à 0 ignorée", () => {
    expect(deltasFenetre(points, 3 * H)).toEqual([]);
    expect(deltasFenetre([{ t: base, v: 0 }, { t: base + H, v: 5 }], H)).toEqual([]);
  });
});

describe("bucketsHoraires", () => {
  it("agrège l'USD par heure pleine et remplit les heures vides à 0", () => {
    const t0 = Math.floor(1_700_000_000_000 / H) * H; // heure pleine
    const events = [
      { t: t0 + 60_000, usd: 100 },
      { t: t0 + 120_000, usd: 50 },
      { t: t0 + 2 * H + 1, usd: 7 },
    ];
    const buckets = bucketsHoraires(events, t0 + 3 * H);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toEqual({ t: t0, v: 150 });
    expect(buckets[1]).toEqual({ t: t0 + H, v: 0 });
    expect(buckets[2]).toEqual({ t: t0 + 2 * H, v: 7 });
  });
  it("vide → vide", () => {
    expect(bucketsHoraires([], 1_700_000_000_000)).toEqual([]);
  });
});
