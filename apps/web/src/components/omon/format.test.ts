import { describe, expect, it } from "vitest";
import { formatStrike, graduationsLisibles } from "./dessins";
import { formatUsdExact } from "./format";

describe("formatUsdExact", () => {
  it("distingue les petits strikes fractionnaires (ETF : 44,5 et 45)", () => {
    expect(formatUsdExact(44.5)).toBe("$44.5");
    expect(formatUsdExact(45)).toBe("$45");
    expect(formatUsdExact(44.825)).toBe("$44.83");
  });

  it("reste entier au-delà de 1 000 (crypto, SPX, NDX) et « — » si absent", () => {
    expect(formatUsdExact(79461.3)).toBe("$79,461");
    expect(formatUsdExact(68432)).toBe("$68,432");
    expect(formatUsdExact(null)).toBe("—");
    expect(formatUsdExact(Number.NaN)).toBe("—");
  });
});

describe("formatStrike", () => {
  it("n'arrondit plus les petits strikes fractionnaires (44,5 ≠ 45, VIX 12,5)", () => {
    expect(formatStrike(44.5)).toBe("44.5");
    expect(formatStrike(45)).toBe("45");
    expect(formatStrike(12.5)).toBe("12.5");
    expect(formatStrike(17.25)).toBe("17.25");
  });

  it("garde le format compact des grands strikes et des entiers", () => {
    expect(formatStrike(78000)).toBe("78K");
    expect(formatStrike(5)).toBe("5.0");
  });
});

describe("graduationsLisibles", () => {
  // Projection de dessinerBarres : padT 12, hauteur utile 166 px.
  const projection = (yHi: number, yLo: number) => (v: number) => 12 + (1 - (v - yLo) / (yHi - yLo)) * 166;

  it("zéro à 2 px de la borne basse (+5 M$ contre −74,76 K$) : bornes gardées, « $0.00 » retiré", () => {
    const py = projection(5_000_000, -74_760);
    expect(graduationsLisibles([5_000_000, -74_760, 0], py).map((g) => g.valeur)).toEqual([5_000_000, -74_760]);
  });

  it("borne haute nulle (expositions toutes négatives) : un seul « $0.00 »", () => {
    const py = projection(0, -74_760);
    expect(graduationsLisibles([0, -74_760, 0], py)).toEqual([
      { valeur: 0, y: 12 },
      { valeur: -74_760, y: 178 },
    ]);
  });

  it("échelle équilibrée (crypto) : les trois graduations restent, positions inchangées", () => {
    const py = projection(2e9, -1e9);
    expect(graduationsLisibles([2e9, -1e9, 0], py)).toEqual([
      { valeur: 2e9, y: py(2e9) },
      { valeur: -1e9, y: py(-1e9) },
      { valeur: 0, y: py(0) },
    ]);
  });

  it("écart minimal de 12 px (police canvas 10 px) : 11 px retiré, 12 px gardé", () => {
    const py = (v: number) => v;
    expect(graduationsLisibles([0, 11], py).map((g) => g.valeur)).toEqual([0]);
    expect(graduationsLisibles([0, 12], py).map((g) => g.valeur)).toEqual([0, 12]);
  });
});
