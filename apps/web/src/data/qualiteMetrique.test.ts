import { describe, expect, it } from "vitest";
import { actualiserQualite, type QualiteMetrique } from "./qualiteMetrique";

const T0 = Date.UTC(2026, 8, 9, 12, 30);
const qualite: QualiteMetrique = {
  sourceId: "test", sourceEffective: "Source quotidienne", observeLe: T0,
  recupereLe: T0, cadenceMs: 86_400_000, ageMaxMs: 3 * 86_400_000,
  couverture: null, estime: false, acces: "public", statut: "frais",
};

describe("fraîcheur actuelle, indépendante du collecteur", () => {
  it("fait expirer la même observation sans la modifier ni simuler une récupération", () => {
    expect(actualiserQualite(qualite, T0 + 3 * 86_400_000).statut).toBe("frais");
    const ancienne = actualiserQualite(qualite, T0 + 3 * 86_400_000 + 1);
    expect(ancienne.statut).toBe("perime");
    expect(ancienne.observeLe).toBe(T0);
    expect(ancienne.recupereLe).toBe(T0);
    expect(qualite.statut).toBe("frais");
  });
  it("fait vieillir un résultat partiel tout en conservant son motif", () => {
    const q = { ...qualite, statut: "partiel" as const, raison: "ETH absent" };
    expect(actualiserQualite(q, T0 + 1).statut).toBe("partiel");
    expect(actualiserQualite(q, T0 + 7 * 86_400_000)).toMatchObject({ statut: "perime", raison: expect.stringContaining("ETH absent") });
  });
  it.each(["indisponible", "perime", "en-construction"] as const)("ne promeut jamais %s en frais", (statut) => {
    expect(actualiserQualite({ ...qualite, statut }, T0).statut).toBe(statut);
  });
  it("ne certifie pas une observation absente, future, ni un seuil inconnu", () => {
    expect(actualiserQualite({ ...qualite, observeLe: null }, T0).statut).toBe("partiel");
    expect(actualiserQualite({ ...qualite, ageMaxMs: undefined }, T0).statut).toBe("partiel");
    expect(actualiserQualite(qualite, T0 - 1).statut).toBe("perime");
  });
});
