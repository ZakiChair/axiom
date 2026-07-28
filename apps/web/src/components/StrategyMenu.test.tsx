/**
 * Foyer exclusif des stratégies : le catalogue du menu « Stratégies » et celui du
 * menu « Indicateurs » doivent PARTITIONNER le registre (aucun recouvrement, aucun
 * oubli). Env vitest node (pas de jsdom dans apps/web) → on teste les helpers PURS
 * seulement ; le rendu réel est couvert par le gate visuel.
 */
import { describe, expect, it } from "vitest";
import { INDICATORS } from "@axiom/indicators";
import { defsStrategie } from "./StrategyMenu";
import { INDICATEURS_ANALYSE } from "./IndicatorMenu";

describe("partition stratégies / analyse (foyer exclusif)", () => {
  it("les deux catalogues partitionnent le registre sans recouvrement", () => {
    expect(defsStrategie().length + INDICATEURS_ANALYSE.length).toBe(INDICATORS.length);
    const ids = new Set(defsStrategie().map((d) => d.id));
    expect(INDICATEURS_ANALYSE.some((d) => ids.has(d.id))).toBe(false);
    expect(defsStrategie().every((d) => d.category === "strategy")).toBe(true);
  });
});
