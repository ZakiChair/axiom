/**
 * Tests du helper PUR de construction des lignes VaR de l'overlay DIST (distLignes.ts).
 * Le rendu KLineChart (NiveauxLignesController) n'est PAS testé (couplage canvas, comme les
 * autres overlays). On vérifie ici le CÂBLAGE quantile→ligne : 4 lignes (p5/p95 forte,
 * p1/p99 faible), étiquettes VaR95/VaR99, couleur neutre — et le cas « échantillon insuffisant ».
 */
import { describe, expect, it } from "vitest";
import { niveauxVarLignes } from "./distLignes";
import type { NiveauxVar } from "../data/distVar";

/** Fixture d'un horizon 20 bougies aux quantiles distincts (verrouille le câblage prix→ligne). */
const H20: NiveauxVar = {
  h: 20,
  nEchantillons: 100,
  niveaux: { p1: 90, p5: 95, p50: 100, p95: 105, p99: 110 },
  pct: { p1: -10, p5: -5, p50: 0, p95: 5, p99: 10 },
  cvar95Niveau: 92,
  cvar95Pct: -8,
};

describe("niveauxVarLignes", () => {
  it("renvoie [] quand l'horizon est absent (échantillon insuffisant)", () => {
    expect(niveauxVarLignes(null)).toEqual([]);
  });

  it("construit exactement 4 lignes (p5/p95/p1/p99)", () => {
    const lignes = niveauxVarLignes(H20);
    expect(lignes).toHaveLength(4);
    expect(lignes.map((l) => l.price).sort((a, b) => a - b)).toEqual([90, 95, 105, 110]);
  });

  it("p5 et p95 → étiquette VaR95, emphase forte", () => {
    const lignes = niveauxVarLignes(H20);
    const p5 = lignes.find((l) => l.price === 95);
    const p95 = lignes.find((l) => l.price === 105);
    expect(p5).toMatchObject({ label: "VaR95", emphase: "forte" });
    expect(p95).toMatchObject({ label: "VaR95", emphase: "forte" });
  });

  it("p1 et p99 → étiquette VaR99, emphase faible", () => {
    const lignes = niveauxVarLignes(H20);
    const p1 = lignes.find((l) => l.price === 90);
    const p99 = lignes.find((l) => l.price === 110);
    expect(p1).toMatchObject({ label: "VaR99", emphase: "faible" });
    expect(p99).toMatchObject({ label: "VaR99", emphase: "faible" });
  });

  it("toutes les lignes sont de couleur neutre --text-dim", () => {
    const lignes = niveauxVarLignes(H20);
    expect(lignes.every((l) => l.couleur === "--text-dim")).toBe(true);
  });
});
