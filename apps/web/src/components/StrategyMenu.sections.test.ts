/**
 * Sections du catalogue Stratégies (lot A v2.6) : la dérivation PAR RÈGLE d'id
 * doit classer chaque def strategy dans une section cohérente — les vraies
 * stratégies (fabrique `strat*`), les divergences d'oscillateurs (`*Divergence`)
 * et les lectures spot/perp (le reste). Env vitest node → helpers purs.
 */
import { describe, expect, it } from "vitest";
import { defsStrategie, sectionStrategie, sectionsStrategies } from "./StrategyMenu";

describe("sectionStrategie (règle d'id)", () => {
  it("classe chaque def strategy du registre dans une section attendue", () => {
    for (const def of defsStrategie()) {
      const section = sectionStrategie(def);
      if (def.id.startsWith("strat")) expect(section).toBe("strategies");
      else if (def.id.endsWith("Divergence")) expect(section).toBe("divergences");
      else expect(section).toBe("spotPerp");
    }
  });

  it("le registre actuel remplit les trois sections (aucune ne doit disparaître en silence)", () => {
    const sections = sectionsStrategies(defsStrategie());
    expect(sections.map(([s]) => s)).toEqual(["strategies", "divergences", "spotPerp"]);
    // Spot vs Perp = exactement les deux lectures spot/perp reclassées v2.1.
    const spotPerp = sections.find(([s]) => s === "spotPerp")?.[1] ?? [];
    expect(spotPerp.map((d) => d.id).sort()).toEqual(["cvdSpotPerp", "premiumSpotPerp"]);
  });

  it("préserve l'ordre du registre à l'intérieur d'une section et ignore les sections vides", () => {
    const defs = defsStrategie();
    const strategies = sectionsStrategies(defs).find(([s]) => s === "strategies")?.[1] ?? [];
    const attendu = defs.filter((d) => d.id.startsWith("strat")).map((d) => d.id);
    expect(strategies.map((d) => d.id)).toEqual(attendu);
    expect(sectionsStrategies([])).toEqual([]);
  });
});
