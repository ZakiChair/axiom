import { describe, expect, it } from "vitest";
import { serieDansHorizon, formatValeurMacro, formatPeriodeMacro, segmentsMacro } from "./macroSeriesTab.util";
import { CATALOGUE_MACRO } from "../data/macro/catalogueMacro";

describe("présentation des séries macro", () => {
  it("ne formate pas des effectifs ou un indice comme un pourcentage", () => {
    expect(formatValeurMacro(206000, "personnes")).toContain("206");
    expect(formatValeurMacro(206000, "personnes")).not.toContain("%");
    expect(formatValeurMacro(-0.56, "indice")).toBe("−0,56");
    expect(formatValeurMacro(1, "pb")).toBe("1,00 pb");
    expect(formatValeurMacro(-2.4, "%")).toBe("−2,40 %");
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
  it("interrompt une courbe mensuelle lorsqu'une observation manque", () => {
    const points = [{ time: Date.UTC(2026, 0, 1), value: 1 }, { time: Date.UTC(2026, 2, 1), value: 3 }];
    expect(segmentsMacro(points, "M")).toEqual([[points[0]], [points[1]]]);
    expect(segmentsMacro([{ time: Date.UTC(2026, 8, 4), value: 1 }, { time: Date.UTC(2026, 8, 7), value: 2 }], "D")).toHaveLength(1);
  });
});
