/**
 * Tests du calcul PUR de l'outil position (R:R, sens, taille de position).
 *
 * position.ts enregistre un overlay klinecharts à l'import (effet de bord) :
 * mock inerte, même pattern que navigation.test.ts / drawing.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("../lib/canvasTokens", () => ({
  lireTokenCanvas: (_t: string, d: string) => d,
  rgbaTokenCanvas: (_t: string, _a: number, d: string) => d,
}));

import { calculerPosition, formaterRatio, taillePosition } from "./position";

describe("calculerPosition", () => {
  it("déduit un LONG quand le stop est SOUS l'entrée", () => {
    const p = calculerPosition(100, 90, 120);
    expect(p?.sens).toBe("long");
    expect(p?.risqueParUnite).toBe(10);
    expect(p?.gainParUnite).toBe(20);
    expect(p?.ratio).toBe(2);
  });

  it("déduit un SHORT quand le stop est AU-DESSUS de l'entrée", () => {
    const p = calculerPosition(100, 110, 70);
    expect(p?.sens).toBe("short");
    expect(p?.risqueParUnite).toBe(10);
    expect(p?.gainParUnite).toBe(30);
    expect(p?.ratio).toBe(3);
  });

  it("null si l'entrée et le stop sont confondus (risque nul : R:R infini)", () => {
    expect(calculerPosition(100, 100, 120)).toBeNull();
  });

  it("null sur des prix non finis", () => {
    expect(calculerPosition(Number.NaN, 90, 120)).toBeNull();
    expect(calculerPosition(100, Number.NaN, 120)).toBeNull();
    expect(calculerPosition(100, 90, Number.NaN)).toBeNull();
  });

  it("ratio NÉGATIF si la cible est du mauvais côté de l'entrée (long visant plus bas)", () => {
    // Setup incohérent : on ne le masque pas, on l'affiche négatif — le trader
    // doit VOIR que sa cible est du mauvais côté, pas obtenir un null silencieux.
    const p = calculerPosition(100, 90, 95);
    expect(p?.sens).toBe("long");
    expect(p?.ratio).toBeLessThan(0);
  });

  it("ratio négatif symétrique pour un short visant plus haut", () => {
    const p = calculerPosition(100, 110, 105);
    expect(p?.sens).toBe("short");
    expect(p?.ratio).toBeLessThan(0);
  });

  it("ratio nul quand la cible est confondue avec l'entrée", () => {
    expect(calculerPosition(100, 90, 100)?.ratio).toBe(0);
  });
});

describe("taillePosition", () => {
  it("dimensionne selon le risque toléré", () => {
    // 10 000 $ de capital, 1 % de risque = 100 $ ; 10 $ de risque/unité → 10 unités.
    const t = taillePosition(10_000, 1, 10, 100);
    expect(t?.risqueUsd).toBe(100);
    expect(t?.unites).toBe(10);
    expect(t?.notionnelUsd).toBe(1000);
  });

  it("null si le capital est absent ou nul (référentiel non paramétré)", () => {
    expect(taillePosition(0, 1, 10, 100)).toBeNull();
    expect(taillePosition(null, 1, 10, 100)).toBeNull();
  });

  it("null si le risque par unité est nul (division par zéro)", () => {
    expect(taillePosition(10_000, 1, 0, 100)).toBeNull();
  });

  it("null si le pourcentage de risque est nul ou négatif", () => {
    expect(taillePosition(10_000, 0, 10, 100)).toBeNull();
    expect(taillePosition(10_000, -1, 10, 100)).toBeNull();
  });

  it("null sur des entrées non finies", () => {
    expect(taillePosition(10_000, 1, Number.NaN, 100)).toBeNull();
    expect(taillePosition(10_000, 1, 10, Number.NaN)).toBeNull();
  });

  it("gère un prix d'entrée nul sans produire un notionnel absurde", () => {
    expect(taillePosition(10_000, 1, 10, 0)).toBeNull();
  });
});

describe("formaterRatio", () => {
  it("formate en R:R lisible", () => {
    expect(formaterRatio(2)).toBe("R:R 2.00");
    expect(formaterRatio(1.5)).toBe("R:R 1.50");
  });

  it("marque explicitement un setup à ratio négatif", () => {
    expect(formaterRatio(-0.5)).toBe("R:R −0.50");
  });

  it("tiret sur valeur non finie", () => {
    expect(formaterRatio(Number.NaN)).toBe("R:R —");
  });
});
