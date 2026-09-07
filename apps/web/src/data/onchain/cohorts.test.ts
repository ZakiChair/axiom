import { describe, expect, it } from "vitest";
import { ecartPrixRealise, variationCalendaire, offreEnProfit } from "./cohorts";
describe("cohortes on-chain : dates et unités", () => {
  it("prime spot/prix réalisé, sans valeur infinie ni zéro inventé", () => {
    expect(ecartPrixRealise(120, 100)).toBeCloseTo(20);
    expect(ecartPrixRealise(80, 100)).toBeCloseTo(-20);
    expect(ecartPrixRealise(100, 0)).toBeNull();
    expect(ecartPrixRealise(null, 100)).toBeNull();
  });
  it("variation 30 jours calendaires exige la date exacte, pas 30 lignes", () => {
    const points = [{ time: Date.UTC(2026, 7, 1), value: 100 }, { time: Date.UTC(2026, 7, 31), value: 120 }];
    expect(variationCalendaire(points, 30)).toEqual({ absolue: 20, pct: 20, debut: Date.UTC(2026, 7, 1), fin: Date.UTC(2026, 7, 31) });
    expect(variationCalendaire(points, 90)).toBeNull();
    expect(variationCalendaire([{ time: Date.UTC(2026, 7, 2), value: 100 }, points[1]!], 30)).toBeNull();
  });
  it("offre profit/perte : jointure de date et part BTC, aucune comparaison de deux jours différents", () => {
    expect(offreEnProfit([{ time: 1, value: 8 }, { time: 2, value: 9 }], [{ time: 1, value: 2 }]))
      .toEqual({ time: 1, profitBtc: 8, perteBtc: 2, pct: 80 });
    expect(offreEnProfit([{ time: 2, value: 8 }], [{ time: 1, value: 2 }])).toBeNull();
  });
});
