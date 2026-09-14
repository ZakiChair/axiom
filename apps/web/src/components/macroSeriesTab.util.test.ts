import { describe, expect, it } from "vitest";
import { contexteSourcesMacro, serieDansHorizon, formatValeurMacro, formatPeriodeMacro, segmentsMacro } from "./macroSeriesTab.util";
import { CATALOGUE_MACRO } from "../data/macro/catalogueMacro";

describe("présentation des séries macro", () => {
  it("ne formate pas des effectifs ou un indice comme un pourcentage", () => {
    expect(formatValeurMacro(206000, "personnes")).toContain("206");
    expect(formatValeurMacro(206000, "personnes")).not.toContain("%");
    expect(formatValeurMacro(-0.56, "indice")).toBe("−0,56");
    expect(formatValeurMacro(1, "pb")).toBe("1,00 pb");
    expect(formatValeurMacro(-2.4, "%")).toBe("−2,40 %");
  });
  it("affiche les unités macro natives sans les assimiler à des pourcentages", () => {
    expect(formatValeurMacro(130.658, "indice-2017=100")).toBe("130,658 (2017=100)");
    expect(formatValeurMacro(83.333, "milliers")).toBe("83,333 milliers");
    expect(formatValeurMacro(763602, "millions-usd-nominaux")).toMatch(/^763\s?602 M\$ nominaux$/u);
    expect(formatValeurMacro(123.45, "pourcent-pib")).toBe("123,45 % du PIB");
  });
  it("affiche la période trimestrielle et le vrai trimestre glissant britannique", () => {
    const uk = CATALOGUE_MACRO.find((d) => d.id === "chomage-uk")!;
    const gdp = CATALOGUE_MACRO.find((d) => d.id === "pib-aa-us")!;
    expect(formatPeriodeMacro(Date.UTC(2026, 4, 1), uk)).toBe("avr.–juin 2026");
    expect(formatPeriodeMacro(Date.UTC(2026, 3, 1), gdp)).toBe("T2 2026");
  });
  it("coupe le cache large au bon horizon sans extrapoler des dates", () => {
    const serie = [{ time: Date.UTC(2024, 1, 1), value: 1 }, { time: Date.UTC(2026, 1, 1), value: 2 }];
    expect(serieDansHorizon(serie, 1, Date.UTC(2026, 8, 7))).toEqual([serie[1]]);
    expect(serieDansHorizon(serie, 5, Date.UTC(2026, 8, 7))).toEqual(serie);
  });
  it("ancre l'horizon historique au cutoff, pas à aujourd'hui", () => {
    const serie = [{ time: Date.UTC(2015, 0, 1), value: 1 }, { time: Date.UTC(2019, 11, 1), value: 2 }, { time: Date.UTC(2021, 0, 1), value: 3 }];
    expect(serieDansHorizon(serie, 5, Date.UTC(2020, 0, 15))).toEqual([serie[0], serie[1]]);
  });
  it.each([
    { horizon: 30 as const, debut: Date.UTC(1996, 8, 1) },
    { horizon: 60 as const, debut: Date.UTC(1966, 8, 1) },
  ])("inclut la borne mensuelle UTC sur $horizon ans", ({ horizon, debut }) => {
    const ancre = Date.UTC(2026, 8, 11);
    const serie = [{ time: debut - 1, value: 1 }, { time: debut, value: 2 }, { time: ancre, value: 3 }, { time: ancre + 1, value: 4 }];
    expect(serieDansHorizon(serie, horizon, ancre)).toEqual([serie[1], serie[2]]);
  });
  it("Max inclut 1960 et toute la borne de 1900, sans observations futures", () => {
    const ancre = Date.UTC(2026, 8, 11);
    const serie = [
      { time: Date.UTC(1899, 11, 31), value: 1 },
      { time: Date.UTC(1900, 0, 1), value: 2 },
      { time: Date.UTC(1960, 0, 1), value: 3 },
      { time: ancre, value: 4 },
      { time: ancre + 1, value: 5 },
    ];
    expect(serieDansHorizon(serie, "max", ancre)).toEqual([serie[1], serie[2], serie[3]]);
  });
  it("Max respecte un cutoff ALFRED avant 1970", () => {
    const serie = [{ time: Date.UTC(1960, 0, 1), value: 1 }, { time: Date.UTC(1965, 5, 15), value: 2 }, { time: Date.UTC(1965, 5, 16), value: 3 }];
    expect(serieDansHorizon(serie, "max", Date.UTC(1965, 5, 15))).toEqual([serie[0], serie[1]]);
  });
  it("rend le contexte ALFRED visible pour FRED tout en signalant les autres sources courantes", () => {
    const fred = CATALOGUE_MACRO.find((d) => d.id === "pce-niveau-us")!;
    const oecd = CATALOGUE_MACRO.find((d) => d.id === "cpi-aa-jp")!;
    expect(contexteSourcesMacro([fred, oecd], "2025-01-01")).toContain("FRED : vue ALFRED au 2025-01-01");
    expect(contexteSourcesMacro([fred, oecd], "2025-01-01")).toContain("Autres sources : données courantes");
    expect(contexteSourcesMacro([fred, CATALOGUE_MACRO.find((d) => d.id === "demandes-chomage-us-4s")!], "2025-01-01")).toContain("FRED : vue ALFRED au 2025-01-01");
  });
  it("interrompt une courbe mensuelle lorsqu'une observation manque", () => {
    const points = [{ time: Date.UTC(2026, 0, 1), value: 1 }, { time: Date.UTC(2026, 2, 1), value: 3 }];
    expect(segmentsMacro(points, "M")).toEqual([[points[0]], [points[1]]]);
    expect(segmentsMacro([{ time: Date.UTC(2026, 8, 4), value: 1 }, { time: Date.UTC(2026, 8, 7), value: 2 }], "D")).toHaveLength(1);
  });
});
