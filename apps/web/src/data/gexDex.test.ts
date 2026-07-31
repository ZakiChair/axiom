import { describe, expect, it } from "vitest";
import {
  aggregateGexDex,
  computeCryptoGexDex,
  gammaFlip,
  gexParStrikeToutesEcheances,
  mursGamma,
  profilGexSpot,
  SEUIL_INDETERMINATION_GEX,
  verdictGamma,
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

describe("verdictGamma", () => {
  it("GEX net franchement positif → long-gamma (amorti), les dealers vendent les hausses", () => {
    // net = 1000, Σ|GEX| = 5000 → 1000 ≥ 2 % de 5000 (=100) : régime tranché.
    const v = verdictGamma(1000, 100, 90, 5000);
    expect(v.regime).toBe("long-gamma");
    expect(v.qualificatif).toBe("amorti");
    expect(v.action).toContain("vendent le sous-jacent quand ça monte");
    // distance = (100 − 90)/100 × 100 = 10 %.
    expect(v.distanceFlipPct).toBeCloseTo(10, 9);
  });

  it("GEX net franchement négatif → short-gamma (amplifié), les dealers achètent les hausses", () => {
    const v = verdictGamma(-1000, 100, 110, 5000);
    expect(v.regime).toBe("short-gamma");
    expect(v.qualificatif).toBe("amplifié");
    expect(v.action).toContain("achètent les hausses");
    // distance = (100 − 110)/100 × 100 = −10 %.
    expect(v.distanceFlipPct).toBeCloseTo(-10, 9);
  });

  it("|net| sous le seuil relatif de Σ|GEX| → indetermine (distance au flip calculée quand même)", () => {
    // 50 < 0,02 × 5000 = 100 → indéterminé, mais la distance reste informative.
    const v = verdictGamma(50, 100, 90, 5000);
    expect(v.regime).toBe("indetermine");
    expect(v.qualificatif).toBe("neutre");
    expect(v.distanceFlipPct).toBeCloseTo(10, 9);
  });

  it("au seuil EXACT le régime est tranché (comparaison stricte <)", () => {
    // 100 = 0,02 × 5000 exactement → « 100 < 100 » faux → long-gamma.
    const v = verdictGamma(SEUIL_INDETERMINATION_GEX * 5000, 100, null, 5000);
    expect(v.regime).toBe("long-gamma");
  });

  it("flip null → verdict fondé sur le seul signe du net, distance null", () => {
    const v = verdictGamma(-500, 100, null, 1000);
    expect(v.regime).toBe("short-gamma");
    expect(v.distanceFlipPct).toBeNull();
  });

  it("net NaN → indetermine (dégradation gracieuse, jamais d'exception)", () => {
    const v = verdictGamma(NaN, 100, 90, 1000);
    expect(v.regime).toBe("indetermine");
    expect(v.distanceFlipPct).toBeCloseTo(10, 9);
  });

  it("spot invalide (NaN ou ≤ 0) → distance null, régime inchangé", () => {
    expect(verdictGamma(1000, NaN, 90, 5000).distanceFlipPct).toBeNull();
    expect(verdictGamma(1000, 0, 90, 5000).distanceFlipPct).toBeNull();
    expect(verdictGamma(1000, NaN, 90, 5000).regime).toBe("long-gamma");
  });

  it("Σ|GEX| inexploitable (0 ou NaN) → seuil ignoré, verdict au seul signe du net", () => {
    expect(verdictGamma(1, 100, null, 0).regime).toBe("long-gamma");
    expect(verdictGamma(-1, 100, null, NaN).regime).toBe("short-gamma");
    // net exactement 0 → indéterminé même sans seuil.
    expect(verdictGamma(0, 100, null, NaN).regime).toBe("indetermine");
  });
});

describe("mursGamma", () => {
  it("call wall = strike du GEX positif max, put wall = strike du GEX négatif max en |valeur|", () => {
    const murs = mursGamma([
      { strike: 80, gex: -7 },
      { strike: 90, gex: -3 },
      { strike: 100, gex: 5 },
      { strike: 110, gex: 8 },
    ]);
    expect(murs.callWall).toBe(110);
    expect(murs.putWall).toBe(80);
  });

  it("aucun GEX du signe → mur null (profil tout positif / tout négatif / vide)", () => {
    expect(mursGamma([{ strike: 100, gex: 5 }]).putWall).toBeNull();
    expect(mursGamma([{ strike: 100, gex: 5 }]).callWall).toBe(100);
    expect(mursGamma([{ strike: 100, gex: -5 }]).callWall).toBeNull();
    expect(mursGamma([{ strike: 100, gex: -5 }]).putWall).toBe(100);
    expect(mursGamma([])).toEqual({ callWall: null, putWall: null });
  });

  it("ignore les valeurs non finies (GEX NaN, strike NaN)", () => {
    const murs = mursGamma([
      { strike: 100, gex: NaN },
      { strike: NaN, gex: 50 },
      { strike: 110, gex: 4 },
    ]);
    expect(murs.callWall).toBe(110);
    expect(murs.putWall).toBeNull();
  });

  it("un GEX nul ne compte ni comme call wall ni comme put wall", () => {
    expect(mursGamma([{ strike: 100, gex: 0 }])).toEqual({ callWall: null, putWall: null });
  });
});

describe("profilGexSpot", () => {
  const NOW = Date.UTC(2026, 0, 1);
  const UN_AN = 365 * 24 * 60 * 60 * 1000;
  const EXP = NOW + 0.25 * UN_AN; // T = 0,25 an exactement.

  it("recalcule le GEX net à chaque spot simulé — vérifié à la main via bsGreeks", () => {
    // Un seul call : strike 100, IV 50 %, OI 10, r 0. À chaque spot simulé s :
    // GEX(s) = Γ_BS(s, 100, 0,25, 0,5, 0) · 10 · s² · 0,01 (multiplicateur crypto 1).
    const chaine: CryptoOptionInput[] = [
      { strike: 100, type: "call", markIv: 50, openInterest: 10, interestRate: 0, expiryMs: EXP },
    ];
    const { points, flipReel } = profilGexSpot(chaine, [90, 100, 110], NOW);
    expect(points.map((p) => p.spot)).toEqual([90, 100, 110]);
    for (const p of points) {
      const attendu = bsGreeks(p.spot, 100, 0.25, 0.5, 0).gamma * 10 * p.spot * p.spot * 0.01;
      expect(p.gexNet).toBeCloseTo(attendu, 6);
      expect(p.gexNet).toBeGreaterThan(0); // un call seul → GEX toujours positif…
    }
    expect(flipReel).toBeNull(); // …donc aucun zéro du profil.
  });

  it("flip réel = zéro du profil, interpolé entre les deux spots encadrants (premier passage)", () => {
    // Call OTM haut (strike 120) + put OTM bas (strike 80), même OI/IV : près de 80 la
    // gamma du put domine (GEX net < 0), près de 120 celle du call domine (GEX net > 0)
    // → le profil traverse zéro entre les deux.
    const chaine: CryptoOptionInput[] = [
      { strike: 120, type: "call", markIv: 50, openInterest: 10, interestRate: 0, expiryMs: EXP },
      { strike: 80, type: "put", markIv: 50, openInterest: 10, interestRate: 0, expiryMs: EXP },
    ];
    const spots = [80, 90, 100, 110, 120];
    const { points, flipReel } = profilGexSpot(chaine, spots, NOW);
    expect(points[0]!.gexNet).toBeLessThan(0);
    expect(points[points.length - 1]!.gexNet).toBeGreaterThan(0);
    expect(flipReel).not.toBeNull();
    expect(flipReel!).toBeGreaterThan(80);
    expect(flipReel!).toBeLessThan(120);
    // Vérification à la main de l'interpolation sur la paire encadrant le zéro.
    const i = points.findIndex((p, k) => k > 0 && points[k - 1]!.gexNet * p.gexNet < 0);
    const a = points[i - 1]!;
    const b = points[i]!;
    const attendu = a.spot + (-a.gexNet / (b.gexNet - a.gexNet)) * (b.spot - a.spot);
    expect(flipReel!).toBeCloseTo(attendu, 9);
  });

  it("ignore les spots non finis ou ≤ 0 et trie les spots croissants", () => {
    const chaine: CryptoOptionInput[] = [
      { strike: 100, type: "call", markIv: 50, openInterest: 1, interestRate: 0, expiryMs: EXP },
    ];
    const { points } = profilGexSpot(chaine, [110, NaN, -5, 0, 90], NOW);
    expect(points.map((p) => p.spot)).toEqual([90, 110]);
  });

  it("chaîne vide → GEX net nul partout, flip réel null (pas de faux zéro)", () => {
    const { points, flipReel } = profilGexSpot([], [90, 100, 110], NOW);
    expect(points.map((p) => p.gexNet)).toEqual([0, 0, 0]);
    expect(flipReel).toBeNull();
  });

  it("délègue la convention d'unités à computeCryptoGexDex (somme des points par strike)", () => {
    // Deux échéances, deux strikes : le net à spot simulé s doit être EXACTEMENT la somme
    // des GEX par strike renvoyés par computeCryptoGexDex(chaîne, s, now).
    const EXP_B = NOW + 0.5 * UN_AN;
    const chaine: CryptoOptionInput[] = [
      { strike: 100, type: "call", markIv: 50, openInterest: 10, interestRate: 0, expiryMs: EXP },
      { strike: 110, type: "put", markIv: 60, openInterest: 8, interestRate: 0, expiryMs: EXP_B },
    ];
    const s = 105;
    const { points } = profilGexSpot(chaine, [s], NOW);
    const attendu = computeCryptoGexDex(chaine, s, NOW).reduce((somme, p) => somme + p.gex, 0);
    expect(points[0]!.gexNet).toBeCloseTo(attendu, 9);
  });
});

describe("passage EXACTEMENT par zéro (revue v2.6, trouvaille no 9)", () => {
  it("gammaFlip : cumul +5 → 0 → −3 bascule au strike du zéro", () => {
    // Cumuls : 5, 0, −3 — deux jambes symétriques s'annulent exactement puis
    // le cumul devient négatif : le flip est au strike où le cumul a touché 0.
    const flip = gammaFlip([
      { strike: 100, gex: 5 },
      { strike: 110, gex: -5 },
      { strike: 120, gex: -3 },
    ]);
    expect(flip).toBe(110);
  });

  it("gammaFlip : cumul +5 → 0 → +3 (retour du même côté) n'est PAS un flip", () => {
    const flip = gammaFlip([
      { strike: 100, gex: 5 },
      { strike: 110, gex: -5 },
      { strike: 120, gex: 3 },
    ]);
    expect(flip).toBeNull();
  });

  it("gammaFlip : cumul qui DÉMARRE à zéro puis devient négatif n'est pas un flip", () => {
    const flip = gammaFlip([
      { strike: 100, gex: 0 },
      { strike: 110, gex: -3 },
    ]);
    expect(flip).toBeNull();
  });
});
