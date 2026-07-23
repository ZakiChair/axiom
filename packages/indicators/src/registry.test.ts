import { describe, expect, it } from "vitest";
import type { IndicatorCategory } from "@axiom/types";
import { INDICATORS, getIndicator } from "./registry";

const VALID_CATEGORIES = new Set<IndicatorCategory>([
  "trend",
  "momentum",
  "volatility",
  "statistical",
  "volume",
  "orderflow",
  "billwilliams",
  "support_resistance",
  "derivatives",
  "custom",
]);

describe("registry", () => {
  it("câble exactement 153 indicateurs", () => {
    expect(INDICATORS.length).toBe(153);
  });

  it("n'a aucun id dupliqué", () => {
    const ids = INDICATORS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("chaque def a une category valide et ≥ 1 output", () => {
    for (const def of INDICATORS) {
      expect(VALID_CATEGORIES.has(def.category)).toBe(true);
      expect(def.outputs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("résout un indicateur connu par id", () => {
    expect(getIndicator("cvd")?.id).toBe("cvd");
  });

  it("renvoie undefined pour un id inconnu", () => {
    expect(getIndicator("__inexistant__")).toBeUndefined();
  });
});
