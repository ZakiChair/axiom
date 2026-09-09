import { describe, expect, it } from "vitest";
import { percentileCourant } from "./regime";

const JOUR = 86_400_000;

describe("percentile courant du régime", () => {
  const now = Date.UTC(2026, 8, 9);

  it("refuse une série périmée même si sa profondeur est suffisante", () => {
    const serie = Array.from({ length: 20 }, (_, i) => ({ t: now - (30 - i) * JOUR, v: i }));
    expect(percentileCourant(serie, now, { cadenceAttendueMs: JOUR, ageMaxMs: 3 * JOUR })).toBeNull();
  });

  it("refuse un historique dont la cadence connue révèle trop de trous", () => {
    const serie = Array.from({ length: 20 }, (_, i) => ({ t: now - (38 - i * 2) * JOUR, v: i }));
    expect(percentileCourant(serie, now, { cadenceAttendueMs: JOUR, ageMaxMs: 3 * JOUR })).toBeNull();
  });
});
