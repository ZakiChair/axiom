import { describe, expect, it } from "vitest";
import { verdictGammaDepuisChaine, type PointChaineGamma } from "./gammaRegime";

const NOW = 1_700_000_000_000;
const ECHEANCE = NOW + 30 * 86_400_000; // 30 j — T > 0, greeks finis.

/** Option synthétique : IV 60 %, OI 10, spot 100 000, échéance 30 j (surchargables). */
function opt(
  partiel: Partial<PointChaineGamma> & { strike: number; type: "call" | "put" },
): PointChaineGamma {
  return {
    markIv: 60,
    openInterest: 10,
    interestRate: 0,
    expiryMs: ECHEANCE,
    underlying: 100_000,
    ...partiel,
  };
}

describe("verdictGammaDepuisChaine", () => {
  it("chaîne de calls seuls → long-gamma, GEX net > 0, spot pris sur la chaîne", () => {
    // Le premier underlying non fini est ignoré (même définition que spotChaine).
    const res = verdictGammaDepuisChaine(
      [
        opt({ strike: 95_000, type: "call", underlying: NaN }),
        opt({ strike: 100_000, type: "call" }),
      ],
      NOW,
    );
    expect(res).not.toBeNull();
    expect(res?.verdict.regime).toBe("long-gamma");
    expect(res?.gexNetUsd).toBeGreaterThan(0);
    expect(res?.spot).toBe(100_000);
  });

  it("chaîne de puts seuls → short-gamma, GEX net < 0", () => {
    const res = verdictGammaDepuisChaine(
      [opt({ strike: 95_000, type: "put" }), opt({ strike: 100_000, type: "put" })],
      NOW,
    );
    expect(res?.verdict.regime).toBe("short-gamma");
    expect(res?.gexNetUsd).toBeLessThan(0);
  });

  it("call et put identiques (même strike/échéance/OI) → GEX net 0 → indéterminé", () => {
    // Gamma Black-Scholes identique calls/puts → contributions opposées exactes.
    const res = verdictGammaDepuisChaine(
      [opt({ strike: 100_000, type: "call" }), opt({ strike: 100_000, type: "put" })],
      NOW,
    );
    expect(res?.gexNetUsd).toBe(0);
    expect(res?.verdict.regime).toBe("indetermine");
  });

  it("cumul qui change de signe entre deux strikes → flip et distance au flip présents", () => {
    // Put à 90 k puis call à 110 k (gamma du 110 k > gamma du 90 k à ce spot) :
    // cumul négatif puis positif → flip interpolé entre les deux strikes.
    const res = verdictGammaDepuisChaine(
      [opt({ strike: 90_000, type: "put" }), opt({ strike: 110_000, type: "call" })],
      NOW,
    );
    expect(res?.verdict.regime).toBe("long-gamma");
    expect(res?.verdict.distanceFlipPct).not.toBeNull();
    expect(Number.isFinite(res?.verdict.distanceFlipPct ?? NaN)).toBe(true);
  });

  it("chaîne vide ou sans underlying exploitable → null", () => {
    expect(verdictGammaDepuisChaine([], NOW)).toBeNull();
    expect(
      verdictGammaDepuisChaine([opt({ strike: 100_000, type: "call", underlying: NaN })], NOW),
    ).toBeNull();
    expect(
      verdictGammaDepuisChaine([opt({ strike: 100_000, type: "call", underlying: -5 })], NOW),
    ).toBeNull();
  });
});
