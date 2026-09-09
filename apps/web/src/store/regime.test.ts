import { describe, expect, it } from "vitest";
import { metadataEtfRegime, percentileCourant } from "./regime";
import { agregerFluxEtfRegime } from "../data/regime";

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

describe("métadonnées du flux ETF agrégé", () => {
  it("ignore les acquisitions récentes des actifs en erreur", () => {
    const t0 = Date.UTC(2026, 8, 9, 10);
    const t1 = t0 + 15 * 60_000;
    const resultats = [
      { disponible: true, jour: "2026-09-08", total: 100_000_000, recupereLe: t0, sourceEffective: "cache SoSoValue" },
      { disponible: false, raison: "HTTP 429", recupereLe: t1, sourceEffective: "SoSoValue" },
      { disponible: false, raison: "HTTP 429", recupereLe: t1, sourceEffective: "SoSoValue" },
    ];
    const agregat = agregerFluxEtfRegime([
      { actif: "btc", disponible: true, jour: "2026-09-08", total: 100_000_000 },
      { actif: "eth", disponible: false, jour: null, total: null },
      { actif: "sol", disponible: false, jour: null, total: null },
    ], t1);

    expect(metadataEtfRegime(["btc", "eth", "sol"], resultats, agregat)).toEqual({
      recupereLe: t0,
      sourceEffective: "cache SoSoValue",
    });
  });

  it("retient l'acquisition la plus ancienne lorsque plusieurs actifs contribuent", () => {
    const t0 = Date.UTC(2026, 8, 9, 10);
    const agregat = agregerFluxEtfRegime([
      { actif: "btc", disponible: true, jour: "2026-09-08", total: 100_000_000 },
      { actif: "eth", disponible: true, jour: "2026-09-08", total: 20_000_000 },
      { actif: "sol", disponible: false, jour: null, total: null },
    ], t0 + 15 * 60_000);

    expect(metadataEtfRegime(["btc", "eth", "sol"], [
      { disponible: true, jour: "2026-09-08", total: 100_000_000, recupereLe: t0, sourceEffective: "cache SoSoValue" },
      { disponible: true, jour: "2026-09-08", total: 20_000_000, recupereLe: t0 + 60_000, sourceEffective: "SoSoValue" },
      { disponible: false, recupereLe: t0 + 15 * 60_000, sourceEffective: "SoSoValue" },
    ], agregat)).toEqual({ recupereLe: t0, sourceEffective: "cache SoSoValue" });
  });
});
