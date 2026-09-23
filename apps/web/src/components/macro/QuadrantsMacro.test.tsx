import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuadrantsMacroVue } from "./QuadrantsMacro";
import { calculerQuadrants } from "../../data/macro/quadrants";
import type { EtatSerie } from "../../store/macroSeries";

const etat = (vals: number[]): EtatSerie => ({
  statut: "ok", points: vals.map((value, i) => ({ time: Date.UTC(2026, i + 3, 1), value })),
  majTs: Date.UTC(2026, 6, 31), message: null, recupereTs: Date.UTC(2026, 7, 1), contexteConnuLe: null,
});

describe("vue des quadrants macro", () => {
  it("montre valeurs, transition inconnue et contexte PIB distinct", () => {
    const resultat = calculerQuadrants({
      "production-aa-us": etat([1, 1.2, 1.5, 2]),
      "cpi-aa-us": etat([3, 2.8, 2.5, 2]),
      "pib-aa-us": { ...etat([]), points: [{ time: Date.UTC(2026, 3, 1), value: 2.1 }] },
    }, { regions: ["US", "EZ"], maintenant: Date.UTC(2026, 8, 2) });
    const html = renderToStaticMarkup(<QuadrantsMacroVue resultat={resultat} chargement={false} erreur={null} />);
    expect(html).toContain("croissance accélère");
    expect(html).toContain("inflation décélère");
    expect(html).toContain("2,1");
    expect(html).toContain("indéterminé");
    expect(html).toContain("périodes observées");
  });
});
