import { describe, expect, it } from "vitest";
import { formatStrike } from "./dessins";
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
