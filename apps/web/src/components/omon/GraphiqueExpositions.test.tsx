import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { construireCarteExpositions } from "../../data/carteExpositions";
import { GraphiqueExpositions } from "./GraphiqueExpositions";

const expiryMs = Date.UTC(2026, 9, 2);
describe("graphique net des options", () => {
  it("place les strikes selon leur prix réel et conserve la hauteur des petites contributions", () => {
    const carte = construireCarteExpositions([{ expiryMs, points: [
      { strike: 90, gex: 10, dex: 100 }, { strike: 100, gex: 20, dex: 200 }, { strike: 120, gex: .01, dex: .1 },
    ] }], 100);
    const html = renderToStaticMarkup(<GraphiqueExpositions carte={carte} spot={100} metrique="gex" />);
    const barres = [...html.matchAll(/data-strike="(\d+)" x="([\d.]+)" y="[\d.]+" width="[\d.]+" height="([\d.]+)"/g)]
      .map((m) => ({ strike: Number(m[1]), x: Number(m[2]), hauteur: Number(m[3]) }));
    expect(barres).toHaveLength(3);
    expect(barres[2]!.x - barres[1]!.x).toBeCloseTo(2 * (barres[1]!.x - barres[0]!.x));
    expect(barres[0]!.hauteur / barres[1]!.hauteur).toBeCloseTo(.5);
    expect(barres[2]!.hauteur / barres[0]!.hauteur).toBeCloseTo(.001);
    expect(barres[2]!.hauteur).toBeLessThan(1);
  });

  it("un seul strike au net nul garde un graphique et un point neutre", () => {
    const carte = construireCarteExpositions([{ expiryMs, points: [{ strike: 100, gex: 0, dex: 0 }] }], 100);
    const html = renderToStaticMarkup(<GraphiqueExpositions carte={carte} spot={100} metrique="gex" />);
    expect(html).toContain('aria-label="GEX net par strike"');
    expect(html).toContain("<circle");
    expect(html).not.toContain('data-strike=');
    expect(html).toContain("$0.00");
    expect(html).not.toContain("NaN");
  });

  it("ne fabrique ni barres ni zéro quand aucune exposition n'est calculable", () => {
    const carte = construireCarteExpositions([{ expiryMs, points: [] }], 100);
    const html = renderToStaticMarkup(<GraphiqueExpositions carte={carte} spot={100} metrique="dex" />);
    expect(html).toContain("Aucune exposition calculable sur cette portée.");
    expect(html).toContain("Aucune exposition calculable par échéance.");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("$0");
    expect(html).not.toContain("NaN");
  });
});
