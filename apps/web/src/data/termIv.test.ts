import { describe, expect, it } from "vitest";
import { termStructureIv } from "./termIv";
import { calculerSkew25d } from "./skew";
import type { OptionPoint } from "./deribit";

// Convention d'injection du temps du dépôt (cf. skew.test.ts / oiHeatmap.test.ts).
const NOW = Date.UTC(2026, 0, 1);
const UN_AN = 365 * 24 * 60 * 60 * 1000;
const E1 = NOW + 0.25 * UN_AN; // échéance proche
const E2 = NOW + 0.5 * UN_AN; // échéance lointaine
const SPOT = 100;

/** Point d'option avec valeurs par défaut plausibles, surchargées au besoin. */
function pt(over: Partial<OptionPoint>): OptionPoint {
  return {
    instrument: over.instrument ?? "X",
    expiryMs: E1,
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

describe("termStructureIv", () => {
  it("trie les échéances croissant", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: E2, strike: 100, type: "call", markIv: 60 }),
      pt({ expiryMs: E1, strike: 100, type: "call", markIv: 50 }),
    ];
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res.map((p) => p.expiryMs)).toEqual([E1, E2]);
  });

  it("exclut les échéances déjà expirées (expiryMs <= nowMs)", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: NOW - UN_AN, strike: 100, type: "call", markIv: 50 }),
      pt({ expiryMs: E1, strike: 100, type: "call", markIv: 55 }),
    ];
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res.map((p) => p.expiryMs)).toEqual([E1]);
  });

  it("sélectionne le strike ATM le plus proche du spot AU-DESSUS", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: E1, strike: 90, type: "call", markIv: 40 }), // |90-100|=10
      pt({ expiryMs: E1, strike: 105, type: "call", markIv: 70 }), // |105-100|=5 : plus proche
    ];
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res[0]?.ivAtm).toBe(70);
  });

  it("sélectionne le strike ATM le plus proche du spot EN-DESSOUS", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: E1, strike: 95, type: "call", markIv: 65 }),
      pt({ expiryMs: E1, strike: 130, type: "call", markIv: 40 }),
    ];
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res[0]?.ivAtm).toBe(65);
  });

  it("moyenne call/put à l'ATM quand les deux existent", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: E1, strike: 100, type: "call", markIv: 50 }),
      pt({ expiryMs: E1, strike: 100, type: "put", markIv: 60 }),
    ];
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res[0]?.ivAtm).toBeCloseTo(55, 9);
  });

  it("utilise le seul côté disponible à l'ATM si l'autre est absent", () => {
    const chain: OptionPoint[] = [pt({ expiryMs: E1, strike: 100, type: "put", markIv: 62 })];
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res[0]?.ivAtm).toBe(62);
  });

  it("délègue rr25 à calculerSkew25d (comparaison directe, pas de recopie)", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: E1, strike: 100, type: "call", markIv: 50 }),
      pt({ expiryMs: E1, strike: 100, type: "put", markIv: 50 }),
      pt({ expiryMs: E1, strike: 118, type: "call", markIv: 55 }),
      pt({ expiryMs: E1, strike: 128, type: "call", markIv: 57 }),
      pt({ expiryMs: E1, strike: 140, type: "call", markIv: 60 }),
      pt({ expiryMs: E1, strike: 78, type: "put", markIv: 64 }),
      pt({ expiryMs: E1, strike: 84, type: "put", markIv: 62 }),
      pt({ expiryMs: E1, strike: 90, type: "put", markIv: 58 }),
    ];
    const attendu = calculerSkew25d(chain, SPOT, NOW);
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res[0]?.rr25).toBeCloseTo(attendu?.rr25 ?? NaN, 9);
  });

  it("rr25 = null si calculerSkew25d ne peut pas le calculer (grille clairsemée)", () => {
    const chain: OptionPoint[] = [pt({ expiryMs: E1, strike: 100, type: "call", markIv: 50 })];
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res[0]?.rr25).toBeNull();
  });

  it("omet le point si aucune IV finie à l'ATM", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: E1, strike: 100, type: "call", markIv: NaN }),
      pt({ expiryMs: E1, strike: 100, type: "put", markIv: NaN }),
    ];
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res).toEqual([]);
  });

  it("omet le point si l'ATM (le plus proche) est NaN, MÊME si un strike plus loin a une IV finie (pas de repli)", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: E1, strike: 100, type: "call", markIv: NaN }), // ATM (le plus proche du spot 100)
      pt({ expiryMs: E1, strike: 100, type: "put", markIv: NaN }),
      pt({ expiryMs: E1, strike: 105, type: "call", markIv: 70 }), // finie, mais pas l'ATM → ignorée
    ];
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res).toEqual([]);
  });

  it("expose nbStrikes = nombre de strikes distincts de l'échéance", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: E1, strike: 90, type: "call", markIv: 50 }),
      pt({ expiryMs: E1, strike: 100, type: "call", markIv: 50 }),
      pt({ expiryMs: E1, strike: 100, type: "put", markIv: 50 }),
      pt({ expiryMs: E1, strike: 110, type: "call", markIv: 50 }),
    ];
    const res = termStructureIv(chain, SPOT, NOW);
    expect(res[0]?.nbStrikes).toBe(3);
  });

  it("renvoie un tableau vide si le spot est NaN", () => {
    const chain: OptionPoint[] = [pt({ expiryMs: E1, strike: 100, type: "call", markIv: 50 })];
    expect(termStructureIv(chain, NaN, NOW)).toEqual([]);
  });

  it("renvoie un tableau vide pour une chaîne vide", () => {
    expect(termStructureIv([], SPOT, NOW)).toEqual([]);
  });
});
