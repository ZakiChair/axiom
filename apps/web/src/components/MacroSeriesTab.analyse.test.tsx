import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MacroSeriesTab } from "./MacroSeriesTab";

describe("intégration du quadrant dans MACRO", () => {
  it("propose une sous-section clavier sans charger le panneau au rendu initial", () => {
    const html = renderToStaticMarkup(<MacroSeriesTab />);
    expect(html).toContain("Quadrants croissance et inflation");
    expect(html).toContain("<summary");
  });
});
