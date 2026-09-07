import { describe, expect, it } from "vitest";
import { parseHistoriquePortWatch, statistiquesPortWatch, type JourPortWatch } from "./portwatchHistorique";

const jour = 86_400_000;
function semaine(fin: string, n: number): JourPortWatch[] {
  return Array.from({ length: 7 }, (_, i) => ({ time: Date.parse(fin) - (6 - i) * jour, navires: n, tankers: n / 2, cargos: n / 2 }));
}
describe("PortWatch : historique et référence saisonnière", () => {
  it("ne confond pas valeur absente et zéro, filtre le détroit et trie", () => {
    const r = parseHistoriquePortWatch({ features: [
      { attributes: { date: "2026-08-30", portid: "chokepoint6", n_total: 0, n_tanker: null, n_cargo: "" } },
      { attributes: { date: "2026-08-29", portid: "chokepoint5", n_total: 50 } },
      { attributes: { date: "2026-02-31", portid: "chokepoint6", n_total: 50 } },
    ] }, "chokepoint6");
    expect(r).toEqual([{ time: Date.UTC(2026, 7, 30), navires: 0, tankers: null, cargos: null }]);
  });
  it("compare 7 jours complets à la médiane des semaines correspondantes des 3 années précédentes", () => {
    const r = statistiquesPortWatch([...semaine("2023-08-30", 200), ...semaine("2024-08-30", 100), ...semaine("2025-08-30", 120), ...semaine("2026-08-30", 6)], "navires");
    expect(r).toMatchObject({ moyenne7j: 6, reference: 120, anneesReference: 3, ecartPct: -95 });
  });
  it("les trous, une seule référence ou une référence nulle ne produisent pas de faux ratios", () => {
    expect(statistiquesPortWatch(semaine("2026-08-30", 6).slice(1), "navires").moyenne7j).toBeNull();
    expect(statistiquesPortWatch([...semaine("2025-08-30", 120), ...semaine("2026-08-30", 6)], "navires").ecartPct).toBeNull();
    expect(statistiquesPortWatch([...semaine("2024-08-30", 0), ...semaine("2025-08-30", 0), ...semaine("2026-08-30", 6)], "navires").ecartPct).toBeNull();
  });
  it("le 29 février se compare à des fenêtres finissant le 28 les années non bissextiles", () => {
    expect(statistiquesPortWatch([...semaine("2022-02-28", 20), ...semaine("2023-02-28", 20), ...semaine("2024-02-29", 10)], "navires").ecartPct).toBe(-50);
  });
});
