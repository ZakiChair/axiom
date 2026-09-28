import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { construireCarteExpositions } from "../../data/carteExpositions";
import { CarteExpositions } from "./CarteExpositions";

describe("carte d'expositions nette", () => {
  it("deux mêmes montants dans des colonnes différentes ont la même intensité globale", () => {
    const carte = construireCarteExpositions([
      { expiryMs: Date.UTC(2026, 9, 2), points: [{ strike: 110, gex: 100, dex: 1 }, { strike: 100, gex: 10, dex: 2 }] },
      { expiryMs: Date.UTC(2026, 9, 30), points: [{ strike: 100, gex: 10, dex: 200 }] },
    ], 100);
    const html = renderToStaticMarkup(<CarteExpositions carte={carte} spot={100} metrique="gex" />);
    // Les cellules de 10 restent à 1/10 de la saturation de 100, même dans leur propre colonne.
    const intensites = [...html.matchAll(/background-color:rgba\(\d+, \d+, \d+, ([\d.]+)\)/g)]
      .map((m) => Number(m[1])).filter((v) => v > 0).sort((a, b) => b - a);
    expect(intensites).toHaveLength(3);
    expect(intensites[1]).toBeCloseTo(intensites[0]! / 10);
    expect(intensites[2]).toBeCloseTo(intensites[1]!);
    expect(html).toContain("Échelle commune, linéaire");
    expect(html).toContain("Des positions opposées peuvent se compenser");
  });

  it("une compensation réelle à zéro ne reçoit ni hachure ni label d'absence", () => {
    const carte = construireCarteExpositions([{ expiryMs: Date.UTC(2026, 9, 2), points: [{ strike: 100, gex: 0, dex: 15 }] }], 100);
    const html = renderToStaticMarkup(<CarteExpositions carte={carte} spot={100} metrique="gex" />);
    expect(html).toContain("0 à +5 % · GEX $0.00");
    expect(html).toContain("+30 % et plus · GEX aucun strike calculable");
    expect(html).toContain("repeating-linear-gradient");
  });

  it("une carte sans contribution ne fabrique pas une échelle zéro", () => {
    const carte = construireCarteExpositions([{ expiryMs: Date.UTC(2026, 9, 2), points: [] }], 100);
    const html = renderToStaticMarkup(<CarteExpositions carte={carte} spot={100} metrique="dex" />);
    expect(html).toContain("Échelle indisponible");
    expect(html).not.toContain("$0.00");
  });
});
