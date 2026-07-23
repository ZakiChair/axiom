import { describe, expect, it } from "vitest";
import {
  aggregateGexDex,
  computeCryptoGexDex,
  gammaFlip,
  gexParStrikeToutesEcheances,
  type CryptoOptionInput,
  type OptionGreekLeg,
} from "./gexDex";
import type { OptionPoint } from "./deribit";
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

describe("gexParStrikeToutesEcheances", () => {
  const NOW = Date.UTC(2026, 0, 1);
  const UN_AN = 365 * 24 * 60 * 60 * 1000;
  const EXP_A = NOW + 0.25 * UN_AN;
  const EXP_B = NOW + 0.5 * UN_AN;

  /** Fabrique d'OptionPoint : seuls les champs consommés par le calcul GEX/DEX comptent. */
  function pt(over: Partial<OptionPoint>): OptionPoint {
    return {
      instrument: "TEST",
      expiryMs: EXP_A,
      strike: 100,
      type: "call",
      markIv: 50,
      openInterest: 1,
      underlying: 100,
      interestRate: 0,
      volume24h: NaN,
      markPrice: NaN,
      ...over,
    };
  }

  it("fusionne les échéances par strike = somme des computeCryptoGexDex par échéance", () => {
    // Strike 100 présent dans LES DEUX échéances → la fusion doit sommer leurs contributions.
    const chain: OptionPoint[] = [
      pt({ expiryMs: EXP_A, strike: 100, type: "call", markIv: 50, openInterest: 10 }),
      pt({ expiryMs: EXP_A, strike: 120, type: "put", markIv: 55, openInterest: 5 }),
      pt({ expiryMs: EXP_B, strike: 100, type: "put", markIv: 60, openInterest: 8 }),
      pt({ expiryMs: EXP_B, strike: 140, type: "call", markIv: 45, openInterest: 3 }),
    ];
    const out = gexParStrikeToutesEcheances(chain, 100, NOW);

    // Attendu = agrégation échéance par échéance puis somme par strike (comparaison directe).
    const gexA = computeCryptoGexDex(
      chain.filter((p) => p.expiryMs === EXP_A),
      100,
      NOW,
    );
    const gexB = computeCryptoGexDex(
      chain.filter((p) => p.expiryMs === EXP_B),
      100,
      NOW,
    );
    const attenduGex = new Map<number, number>();
    const attenduDex = new Map<number, number>();
    for (const p of [...gexA, ...gexB]) {
      attenduGex.set(p.strike, (attenduGex.get(p.strike) ?? 0) + p.gex);
      attenduDex.set(p.strike, (attenduDex.get(p.strike) ?? 0) + p.dex);
    }

    // Strikes triés croissants et exhaustifs.
    expect(out.map((p) => p.strike)).toEqual([100, 120, 140]);
    for (const p of out) {
      expect(p.gex).toBeCloseTo(attenduGex.get(p.strike) ?? 0, 6);
      expect(p.dex).toBeCloseTo(attenduDex.get(p.strike) ?? 0, 6);
    }

    // Strike 100 = somme lisible des deux échéances (call échéance A + put échéance B).
    const a100 = gexA.find((p) => p.strike === 100)!;
    const b100 = gexB.find((p) => p.strike === 100)!;
    const o100 = out.find((p) => p.strike === 100)!;
    expect(o100.gex).toBeCloseTo(a100.gex + b100.gex, 6);
    expect(o100.dex).toBeCloseTo(a100.dex + b100.dex, 6);
  });

  it("renvoie une liste vide si le spot est invalide", () => {
    const chain: OptionPoint[] = [pt({ strike: 100, openInterest: 5 })];
    expect(gexParStrikeToutesEcheances(chain, NaN, NOW)).toEqual([]);
    expect(gexParStrikeToutesEcheances(chain, 0, NOW)).toEqual([]);
  });

  it("chaîne vide → liste vide", () => {
    expect(gexParStrikeToutesEcheances([], 100, NOW)).toEqual([]);
  });
});

describe("gammaFlip", () => {
  it("interpole le strike du changement de signe entre les deux strikes encadrants", () => {
    // cum(100) = −10 ; cum(200) = −10 + 20 = +10.  Changement de signe entre 100 et 200.
    // flip = 100 + (0 − (−10)) / (10 − (−10)) · (200 − 100) = 100 + (10/20)·100 = 150.
    const out = gammaFlip([
      { strike: 100, gex: -10 },
      { strike: 200, gex: 20 },
    ]);
    expect(out).toBeCloseTo(150, 9);
  });

  it("renvoie null quand le cumul ne change jamais de signe", () => {
    // cum : 10, 15 — toujours positif.
    expect(
      gammaFlip([
        { strike: 100, gex: 10 },
        { strike: 200, gex: 5 },
      ]),
    ).toBeNull();
  });

  it("renvoie le PREMIER passage quand le cumul change de signe plusieurs fois", () => {
    // cum : −10 (100), +10 (200) → 1er flip à 150 ; −20 (300) → 2e flip ; +30 (400) → 3e flip.
    const out = gammaFlip([
      { strike: 100, gex: -10 },
      { strike: 200, gex: 20 },
      { strike: 300, gex: -30 },
      { strike: 400, gex: 50 },
    ]);
    expect(out).toBeCloseTo(150, 9);
  });

  it("tableau vide → null", () => {
    expect(gammaFlip([])).toBeNull();
  });

  it("un seul strike → null (aucune paire à encadrer)", () => {
    expect(gammaFlip([{ strike: 100, gex: -5 }])).toBeNull();
  });

  it("GEX nul partout → null (cumul constant à 0, pas de changement de signe)", () => {
    expect(
      gammaFlip([
        { strike: 100, gex: 0 },
        { strike: 200, gex: 0 },
        { strike: 300, gex: 0 },
      ]),
    ).toBeNull();
  });

  it("trie les strikes croissants avant de cumuler (entrée non triée)", () => {
    // Mêmes points que le cas d'interpolation mais désordonnés → même flip à 150.
    const out = gammaFlip([
      { strike: 200, gex: 20 },
      { strike: 100, gex: -10 },
    ]);
    expect(out).toBeCloseTo(150, 9);
  });
});
