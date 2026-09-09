import { afterEach, describe, expect, it, vi } from "vitest";
import { verdictGammaDepuisChaine, type PointChaineGamma } from "./gammaRegime";

const NOW = 1_700_000_000_000;
const ECHEANCE = NOW + 30 * 86_400_000; // 30 j — T > 0, greeks finis.

afterEach(() => vi.useRealTimers());

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
    expect(res?.scenarios.map((s) => s.verdict.regime)).toEqual([
      "indetermine", "long-gamma", "short-gamma",
    ]);
    expect(res?.sensibleAuxHypotheses).toBe(true);
  });

  it("fige le même spot et la même horloge pour les trois hypothèses", () => {
    const res = verdictGammaDepuisChaine([
      opt({ strike: 95_000, type: "call", openInterest: 4 }),
      opt({ strike: 105_000, type: "put", openInterest: 7 }),
    ], NOW);
    expect(res?.scenarios).toHaveLength(3);
    expect(res?.scenarios.map((s) => s.gexNet)).toEqual([
      res?.gexNetUsd,
      res?.scenarios[1]?.gexNet,
      res?.scenarios[2]?.gexNet,
    ]);
    expect(res?.scenarios[1]?.gexNet).toBeGreaterThanOrEqual(0);
    expect(res?.scenarios[2]?.gexNet).toBeLessThanOrEqual(0);
    expect(new Set(res?.scenarios.map((s) => s.dexNet)).size).toBe(1);
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

// ─── Cache TTL de chargerVerdictGammaBtc (impur, fetch Deribit MOCKÉ — revue Lot 3 :
// une inversion du TTL ou la mise en cache d'un échec doit casser un test) ───

vi.mock("./deribit", () => ({
  fetchDeribitOptionChain: vi.fn(),
}));

describe("chargerVerdictGammaBtc — cache TTL 10 min, succès seulement", () => {
  it("mémoïse un succès dans le TTL, re-fetch après expiration, et ne cache JAMAIS un échec", async () => {
    const { fetchDeribitOptionChain } = await import("./deribit");
    const { chargerVerdictGammaBtc, _viderCacheGammaRegime } = await import("./gammaRegime");
    const fetchMock = vi.mocked(fetchDeribitOptionChain);
    _viderCacheGammaRegime();

    const chaine = [opt({ strike: 95_000, type: "call" })];
    vi.useFakeTimers();
    vi.setSystemTime(NOW + 1_000);
    fetchMock.mockResolvedValueOnce(chaine as never);
    const r1 = await chargerVerdictGammaBtc(NOW);
    expect(r1?.verdict.regime).toBe("long-gamma");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1?.recupereLe).toBe(NOW + 1_000);

    // Dans le TTL : servi du cache, AUCUN nouvel appel réseau.
    vi.setSystemTime(NOW + 60_000);
    const r2 = await chargerVerdictGammaBtc(NOW + 60_000);
    expect(r2).toBe(r1);
    expect(r2?.recupereLe).toBe(NOW + 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // TTL expiré : re-fetch. Un ÉCHEC renvoie null sans être caché…
    fetchMock.mockRejectedValueOnce(new Error("panne"));
    const r3 = await chargerVerdictGammaBtc(NOW + 700_000);
    expect(r3).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // …et le tick suivant RETENTE immédiatement (l'échec n'a pas empoisonné le cache).
    fetchMock.mockResolvedValueOnce(chaine as never);
    vi.setSystemTime(NOW + 700_500);
    const r4 = await chargerVerdictGammaBtc(NOW + 700_001);
    expect(r4?.verdict.regime).toBe("long-gamma");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r4?.recupereLe).toBe(NOW + 700_500);

    _viderCacheGammaRegime();
  });
});
