import { describe, expect, it, vi } from "vitest";
import { chargerPrixRotation, comparerPrixRotation } from "./prixRotation";
const JOUR = 86_400_000;
const FIN = Date.UTC(2026, 8, 20);
describe("prix de référence de la rotation", () => {
  it("ne crée aucun token Base ni appel marché", async () => {
    const fetchKlines = vi.fn();
    expect(await chargerPrixRotation("base", FIN - 30 * JOUR, FIN, FIN + JOUR, { fetchKlines })).toBeNull();
    expect(fetchKlines).not.toHaveBeenCalled();
  });
  it("exige les mêmes deux dates exactes et des bougies closes", () => {
    const debut = FIN - 30 * JOUR;
    const complet = comparerPrixRotation("ETHUSDT", debut, FIN, [
      { time: debut, close: 100, closed: true }, { time: FIN, close: 120, closed: true },
    ], FIN + JOUR);
    expect(complet).toMatchObject({ symbol: "ETHUSDT", dateDebut: debut, dateFin: FIN });
    expect(complet?.variationPct).toBeCloseTo(20);
    expect(comparerPrixRotation("ETHUSDT", debut, FIN, [
      { time: debut + JOUR, close: 100, closed: true }, { time: FIN, close: 120, closed: true },
    ], FIN + JOUR)).toBeNull();
    expect(comparerPrixRotation("ETHUSDT", debut, FIN, [
      { time: debut, close: 100, closed: true }, { time: FIN, close: 120, closed: false },
    ], FIN + JOUR)).toBeNull();
  });
});
