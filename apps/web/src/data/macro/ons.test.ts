import { describe, expect, it } from "vitest";
import { parseOnsTimeseries } from "./ons";

// EXTRAIT RÉEL de www.ons.gov.uk, capturé le 2026-09-06 sur
// economy/inflationandpriceindices/timeseries/d7g7/mm23/data.
// Traits du format : `value` est une CHAÎNE, le mois est en anglais en toutes
// lettres, et le document porte aussi `quarters`/`years` qu'il faut IGNORER.
const ONS_D7G7 = {
  description: { title: "CPI ANNUAL RATE 00: ALL ITEMS 2015=100" },
  years: [{ date: "2025", value: "2.5", year: "2025", month: "April", quarter: "" }],
  quarters: [{ date: "2026 Q2", value: "3.5", year: "2026", month: "September", quarter: "Q2" }],
  months: [
    { date: "2019 DEC", value: "1.3", year: "2019", month: "December", quarter: "" },
    { date: "2026 MAY", value: "2.8", year: "2026", month: "May", quarter: "" },
    { date: "2026 JUN", value: "2.6", year: "2026", month: "June", quarter: "" },
    { date: "2026 JUL", value: "2.9", year: "2026", month: "July", quarter: "" },
  ],
};

const DEPUIS_2020 = Date.UTC(2020, 0, 1);

describe("parseOnsTimeseries", () => {
  it("lit les mois, convertit la valeur chaîne en nombre", () => {
    expect(parseOnsTimeseries(ONS_D7G7, DEPUIS_2020)).toEqual([
      { time: Date.UTC(2026, 4, 1), value: 2.8 },
      { time: Date.UTC(2026, 5, 1), value: 2.6 },
      { time: Date.UTC(2026, 6, 1), value: 2.9 },
    ]);
  });

  // L'ONS sert 451 mois (~119 Ko) SANS bornage amont possible : on tronque avant
  // toute mise en cache, sinon localStorage se remplit d'historique jamais affiché.
  it("tronque à la fenêtre demandée", () => {
    const tout = parseOnsTimeseries(ONS_D7G7, Date.UTC(2019, 0, 1));
    expect(tout).toHaveLength(4);
    expect(parseOnsTimeseries(ONS_D7G7, DEPUIS_2020)).toHaveLength(3);
  });

  it("ignore les blocs quarters et years", () => {
    // Les entrées years et quarters ont des mois valides pour que SEUL le fait que
    // le parseur lit `months` et non ces blocs les exclue. Un parseur défectueux qui
    // fusionnerait les trois blocs échouerait ce test.
    const serie = parseOnsTimeseries(ONS_D7G7, Date.UTC(2019, 0, 1));
    expect(serie.some((p) => p.value === 2.5)).toBe(false); // years
    expect(serie.some((p) => p.value === 3.5)).toBe(false); // quarters
  });

  it("écarte les valeurs « NA » et les mois illisibles", () => {
    const sale = structuredClone(ONS_D7G7);
    sale.months.push({ date: "2026 AUG", value: "NA", year: "2026", month: "August", quarter: "" });
    sale.months.push({ date: "2026 ???", value: "3.1", year: "2026", month: "Brumaire", quarter: "" });
    expect(parseOnsTimeseries(sale, DEPUIS_2020)).toHaveLength(3);
  });

  it("rejette une réponse sans bloc months", () => {
    expect(() => parseOnsTimeseries({ description: {} }, DEPUIS_2020)).toThrow();
  });
});

describe("ONS trimestriel", () => {
  it("lit le PIB réel trimestriel sans exiger de mois ni mélanger les fréquences", () => {
    const raw = { quarters: [{ year: "2026", quarter: "Q2", value: "712545" }, { year: "2026", quarter: "Q3", value: "NA" }], months: [] };
    expect(parseOnsTimeseries(raw, DEPUIS_2020, "Q")).toEqual([{ time: Date.UTC(2026, 3, 1), value: 712545 }]);
  });
});
