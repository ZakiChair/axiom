import { describe, expect, it } from "vitest";
import {
  aggregateGexDex,
  computeCryptoGexDex,
  type CryptoOptionInput,
  type OptionGreekLeg,
} from "./gexDex";
import { bsGreeks } from "./blackScholes";

describe("aggregateGexDex", () => {
  it("agrège un strike call+put à la main (GEX = call−put, DEX = delta signé)", () => {
    // Spot 100, multiplicateur 1.
    // Call : gamma 0,02, OI 10, delta 0,6.  Put : gamma 0,03, OI 5, delta −0,4.
    const legs: OptionGreekLeg[] = [
      { strike: 100, type: "call", openInterest: 10, delta: 0.6, gamma: 0.02 },
      { strike: 100, type: "put", openInterest: 5, delta: -0.4, gamma: 0.03 },
    ];
    const [pt] = aggregateGexDex(legs, 100, 1);
    // gammaSigne = 0,02·10 − 0,03·5 = 0,2 − 0,15 = 0,05.
    // GEX = 0,05 · 100² · 0,01 · 1 = 0,05 · 100 = 5.
    expect(pt?.strike).toBe(100);
    expect(pt?.gex).toBeCloseTo(5, 9);
    // deltaSigne = 0,6·10 + (−0,4)·5 = 6 − 2 = 4.
    // DEX = 4 · 100 · 1 = 400.
    expect(pt?.dex).toBeCloseTo(400, 9);
  });

  it("applique le multiplicateur de contrat (actions = 100)", () => {
    const legs: OptionGreekLeg[] = [
      { strike: 5000, type: "call", openInterest: 2, delta: 0.5, gamma: 0.001 },
    ];
    const [pt] = aggregateGexDex(legs, 5000, 100);
    // GEX = 0,001·2 · 5000² · 0,01 · 100 = 0,002 · 25_000_000 · 0,01 · 100 = 500_000.
    expect(pt?.gex).toBeCloseTo(0.002 * 5000 * 5000 * 0.01 * 100, 3);
    // DEX = 0,5·2 · 5000 · 100 = 500_000.
    expect(pt?.dex).toBeCloseTo(0.5 * 2 * 5000 * 100, 3);
  });

  it("regroupe plusieurs jambes du même strike et trie par strike", () => {
    const legs: OptionGreekLeg[] = [
      { strike: 120, type: "call", openInterest: 1, delta: 0.3, gamma: 0.01 },
      { strike: 100, type: "call", openInterest: 1, delta: 0.5, gamma: 0.02 },
      { strike: 100, type: "call", openInterest: 2, delta: 0.5, gamma: 0.02 },
    ];
    const out = aggregateGexDex(legs, 100, 1);
    expect(out.map((p) => p.strike)).toEqual([100, 120]);
    // Strike 100 : gammaSigne = 0,02·1 + 0,02·2 = 0,06 ; GEX = 0,06·100²·0,01 = 6.
    expect(out[0]?.gex).toBeCloseTo(6, 9);
  });

  it("ignore les jambes/valeurs non finies et le strike invalide", () => {
    const legs: OptionGreekLeg[] = [
      { strike: 0, type: "call", openInterest: 10, delta: 0.5, gamma: 0.02 }, // strike invalide
      { strike: 100, type: "call", openInterest: NaN, delta: 0.5, gamma: 0.02 }, // OI NaN → 0
      { strike: 100, type: "put", openInterest: 5, delta: NaN, gamma: 0.03 }, // delta NaN → 0
    ];
    const out = aggregateGexDex(legs, 100, 1);
    expect(out).toHaveLength(1);
    expect(out[0]?.strike).toBe(100);
    // gammaSigne = 0·... (OI 0 pour le call) − 0,03·5 = −0,15 ; GEX = −0,15·100²·0,01 = −15.
    expect(out[0]?.gex).toBeCloseTo(-15, 9);
    // deltaSigne = 0 (call OI 0) + 0 (put delta NaN→0) = 0.
    expect(out[0]?.dex).toBeCloseTo(0, 9);
  });

  it("renvoie une liste vide si le spot est invalide", () => {
    const legs: OptionGreekLeg[] = [
      { strike: 100, type: "call", openInterest: 1, delta: 0.5, gamma: 0.02 },
    ];
    expect(aggregateGexDex(legs, 0, 1)).toEqual([]);
    expect(aggregateGexDex(legs, NaN, 1)).toEqual([]);
  });
});

describe("computeCryptoGexDex", () => {
  const NOW = Date.UTC(2026, 0, 1);
  const UN_AN = 365 * 24 * 60 * 60 * 1000;

  it("calcule les greeks BS puis agrège (cohérent avec bsGreeks direct)", () => {
    // Un call + un put ATM, échéance dans 0,25 an, σ=50 %, r=0, spot=100.
    const expiry = NOW + 0.25 * UN_AN;
    const points: CryptoOptionInput[] = [
      { strike: 100, type: "call", markIv: 50, openInterest: 10, interestRate: 0, expiryMs: expiry },
      { strike: 100, type: "put", markIv: 50, openInterest: 4, interestRate: 0, expiryMs: expiry },
    ];
    const out = computeCryptoGexDex(points, 100, NOW);
    expect(out).toHaveLength(1);

    const g = bsGreeks(100, 100, 0.25, 0.5, 0);
    const gammaSigne = g.gamma * 10 - g.gamma * 4; // call − put
    const deltaSigne = g.deltaCall * 10 + g.deltaPut * 4;
    expect(out[0]?.gex).toBeCloseTo(gammaSigne * 100 * 100 * 0.01 * 1, 6);
    expect(out[0]?.dex).toBeCloseTo(deltaSigne * 100 * 1, 6);
    // DEX net positif ici (delta call ~0,55·10 vs put ~−0,45·4).
    expect(out[0]?.dex).toBeGreaterThan(0);
  });

  it("ignore une option déjà expirée (T ≤ 0 → greeks NaN → non agrégés)", () => {
    const points: CryptoOptionInput[] = [
      { strike: 100, type: "call", markIv: 50, openInterest: 10, interestRate: 0, expiryMs: NOW - UN_AN },
    ];
    // Aucun strike contribue (gammaSigne/deltaSigne restent à 0 → point à 0, mais présent).
    const out = computeCryptoGexDex(points, 100, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.gex).toBe(0);
    expect(out[0]?.dex).toBe(0);
  });

  it("multiplicateur crypto = 1 (pas de facteur 100)", () => {
    const expiry = NOW + 0.5 * UN_AN;
    const points: CryptoOptionInput[] = [
      { strike: 100, type: "call", markIv: 60, openInterest: 1, interestRate: 0, expiryMs: expiry },
    ];
    const out = computeCryptoGexDex(points, 100, NOW);
    const g = bsGreeks(100, 100, 0.5, 0.6, 0);
    expect(out[0]?.gex).toBeCloseTo(g.gamma * 1 * 100 * 100 * 0.01 * 1, 6);
  });
});
