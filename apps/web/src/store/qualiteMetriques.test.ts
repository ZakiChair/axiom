import { describe, expect, it } from "vitest";
import { enregistrerQualite, qualiteMetriquesStore } from "./qualiteMetriques";

describe("registre de qualité par métrique", () => {
  it("enregistre et remplace une métrique sans exposer de secret", () => {
    enregistrerQualite("regime:funding", "Funding BTC", {
      sourceId: "binance-futures",
      sourceEffective: "Binance USDⓈ-M",
      observeLe: 10,
      recupereLe: 20,
      cadenceMs: 8 * 3_600_000,
      couverture: { disponibles: 20, attendus: 20 },
      estime: false,
      acces: "public",
      statut: "frais",
    });
    expect(qualiteMetriquesStore.getState().metriques["regime:funding"]?.libelle).toBe("Funding BTC");
  });
});
