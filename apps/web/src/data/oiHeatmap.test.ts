import { describe, expect, it } from "vitest";
import { bandeStrikes, construireGrilleOi, intensiteCellule } from "./oiHeatmap";
import { computeMaxPain, type OptionPoint, type StrikeOi } from "./deribit";
import { computeCryptoGexDex } from "./gexDex";

// ─────────────────────────── Fabrique de fixtures ───────────────────────────

const NOW = Date.UTC(2026, 0, 1);
const UN_AN = 365 * 24 * 60 * 60 * 1000;
const E1 = NOW + 0.25 * UN_AN; // échéance proche
const E2 = NOW + 0.5 * UN_AN; // échéance lointaine

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
    ...over,
  };
}

describe("construireGrilleOi", () => {
  it("fusionne call+put par (échéance, strike), exclut les strikes sans OI et trie les échéances", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: E1, strike: 100, type: "call", openInterest: 10 }),
      pt({ expiryMs: E1, strike: 100, type: "put", openInterest: 5 }),
      pt({ expiryMs: E1, strike: 120, type: "put", openInterest: 8 }),
      // Strike présent mais OI nul des deux côtés : exclu des cellules (mais candidat max pain).
      pt({ expiryMs: E1, strike: 90, type: "call", openInterest: 0 }),
      pt({ expiryMs: E1, strike: 90, type: "put", openInterest: 0 }),
      pt({ expiryMs: E2, strike: 110, type: "call", openInterest: 3 }),
    ];
    const g = construireGrilleOi(chain, 100, NOW);

    // Échéances triées croissant.
    expect(g.echeances).toEqual([E1, E2]);

    // Cellule fusionnée E1/100 : call 10 + put 5.
    const c100 = g.cellules.find((c) => c.expiryMs === E1 && c.strike === 100);
    expect(c100).toMatchObject({ callOi: 10, putOi: 5, oiTotal: 15 });
    // Cellule E1/120 : put seul.
    const c120 = g.cellules.find((c) => c.expiryMs === E1 && c.strike === 120);
    expect(c120).toMatchObject({ callOi: 0, putOi: 8, oiTotal: 8 });
    // Strike 90 (OI nul) absent des cellules ET de la liste de strikes.
    expect(g.cellules.some((c) => c.strike === 90)).toBe(false);
    expect(g.strikes).toEqual([100, 110, 120]);
    expect(g.cellules).toHaveLength(3);
  });

  it("calcule le max pain par échéance sur l'agrégation COMPLÈTE (strikes à OI nul inclus)", () => {
    const pointsE1: OptionPoint[] = [
      pt({ expiryMs: E1, strike: 100, type: "call", openInterest: 10 }),
      pt({ expiryMs: E1, strike: 100, type: "put", openInterest: 5 }),
      pt({ expiryMs: E1, strike: 120, type: "put", openInterest: 8 }),
      pt({ expiryMs: E1, strike: 90, type: "call", openInterest: 0 }),
    ];
    const chain = [...pointsE1, pt({ expiryMs: E2, strike: 110, type: "call", openInterest: 3 })];
    const g = construireGrilleOi(chain, 100, NOW);

    // Référence : computeMaxPain sur l'agrégation manuelle (strike 90 inclus comme candidat).
    const aggE1: StrikeOi[] = [
      { strike: 90, callOi: 0, putOi: 0 },
      { strike: 100, callOi: 10, putOi: 5 },
      { strike: 120, callOi: 0, putOi: 8 },
    ];
    expect(g.maxPainParEcheance.get(E1)).toBe(computeMaxPain(aggE1));
    // E2 : un seul strike → max pain = ce strike.
    expect(g.maxPainParEcheance.get(E2)).toBe(110);
  });

  it("expose oiMax et gexAbsMax cohérents avec les cellules", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: E1, strike: 100, type: "call", openInterest: 10, markIv: 50 }),
      pt({ expiryMs: E1, strike: 100, type: "put", openInterest: 4, markIv: 50 }),
      pt({ expiryMs: E1, strike: 120, type: "call", openInterest: 2, markIv: 55 }),
    ];
    const g = construireGrilleOi(chain, 100, NOW);
    // oiMax = plus grand oiTotal = strike 100 (10 + 4 = 14).
    expect(g.oiMax).toBe(14);
    // gexAbsMax = |gex| max sur les cellules, cohérent avec computeCryptoGexDex de l'échéance.
    const gex = computeCryptoGexDex(chain, 100, NOW);
    const attendu = Math.max(...gex.map((p) => Math.abs(p.gex)));
    expect(g.gexAbsMax).toBeCloseTo(attendu, 6);
    // La cellule porte le gex SIGNÉ de son strike.
    const c100 = g.cellules.find((c) => c.strike === 100);
    const gex100 = gex.find((p) => p.strike === 100)?.gex ?? NaN;
    expect(c100?.gex).toBeCloseTo(gex100, 6);
  });

  it("ignore les échéances déjà expirées (expiryMs <= nowMs)", () => {
    const chain: OptionPoint[] = [
      pt({ expiryMs: NOW - UN_AN, strike: 100, type: "call", openInterest: 10 }),
      pt({ expiryMs: E1, strike: 100, type: "call", openInterest: 5 }),
    ];
    const g = construireGrilleOi(chain, 100, NOW);
    expect(g.echeances).toEqual([E1]);
  });
});

describe("bandeStrikes", () => {
  it("filtre les strikes hors ±40 % du spot", () => {
    const strikes = [50, 60, 80, 100, 120, 140, 150];
    // ±40 % de 100 → [60, 140]. 50 et 150 exclus.
    expect(bandeStrikes(strikes, 100)).toEqual([60, 80, 100, 120, 140]);
  });

  it("plafonne à maxLignes en gardant les strikes les plus proches du spot", () => {
    const strikes = [60, 70, 80, 90, 100, 110, 120, 130, 140];
    // Les 5 plus proches de 100 : 80, 90, 100, 110, 120 (résultat trié croissant).
    expect(bandeStrikes(strikes, 100, 5)).toEqual([80, 90, 100, 110, 120]);
  });

  it("se replie sur les plus proches du spot quand la bande ±40 % est vide", () => {
    const strikes = [10, 20, 200, 300];
    // Tous hors bande → repli sur les 2 plus proches du spot : 20 (d=80), 10 (d=90).
    expect(bandeStrikes(strikes, 100, 2)).toEqual([10, 20]);
  });
});

describe("intensiteCellule", () => {
  it("mappe 0 → 0 et vMax → 1", () => {
    expect(intensiteCellule(0, 10)).toBe(0);
    expect(intensiteCellule(10, 10)).toBeCloseTo(1, 9);
  });

  it("est monotone croissante en v", () => {
    expect(intensiteCellule(2, 10)).toBeLessThan(intensiteCellule(5, 10));
    expect(intensiteCellule(5, 10)).toBeLessThan(intensiteCellule(8, 10));
  });

  it("renvoie 0 si vMax <= 0", () => {
    expect(intensiteCellule(5, 0)).toBe(0);
    expect(intensiteCellule(5, -1)).toBe(0);
  });
});
