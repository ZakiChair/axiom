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
  "strategy",
  "custom",
]);

describe("registry", () => {
  it("câble exactement 179 indicateurs", () => {
    expect(INDICATORS.length).toBe(179);
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

  it("catégorie strategy : 8 defs v2.1 déplacés + 7 stratégies v2.2 + 5 v2.3 + 7 v2.6", () => {
    const strategie = INDICATORS.filter((def) => def.category === "strategy").map((d) => d.id);
    expect(strategie.sort()).toEqual([
      "cvdDivergence", "cvdSpotPerp", "macdDivergence", "mfiDivergence",
      "obvDivergence", "premiumSpotPerp", "rsiDivergence", "stochDivergence",
      "stratBollingerReversion", "stratChampion", "stratCroisementMM", "stratDivergenceRsi",
      "stratDonchian", "stratIchimokuKumo", "stratMacdCross", "stratMacdSupertrend",
      "stratMmAdx", "stratMmRsi", "stratPsar", "stratPsarAdx",
      "stratRsiRange", "stratRsiReversion", "stratSqueezeBreakout", "stratSqueezeKumo",
      "stratSupertrend", "stratSupertrendAdx", "stratTripleConfirmation",
    ]);
  });
});
