import { describe, expect, it } from "vitest";
import { computeMaxPain, parseOptionInstrument, putCallRatioOi, type StrikeOi } from "./deribit";

describe("parseOptionInstrument", () => {
  it("parse un put BTC daté (échéance à 08:00 UTC)", () => {
    const p = parseOptionInstrument("BTC-28AUG26-78000-P");
    expect(p).toEqual({
      currency: "BTC",
      expiryMs: Date.UTC(2026, 7, 28, 8, 0, 0),
      strike: 78000,
      type: "put",
    });
  });

  it("parse un call ETH et respecte la convention 08:00 UTC vérifiée sur les futures", () => {
    const p = parseOptionInstrument("ETH-2JUL26-3000-C");
    expect(p?.type).toBe("call");
    expect(p?.strike).toBe(3000);
    // BTC-2JUL26 a pour expiration_timestamp 1782979200000 (relevé réel Deribit).
    expect(p?.expiryMs).toBe(1782979200000);
  });

  it("gère un strike décimal (ex. options à petit prix)", () => {
    const p = parseOptionInstrument("BTC-5JUL26-0.5-C");
    expect(p?.strike).toBe(0.5);
  });

  it("renvoie null pour un future (pas d'option)", () => {
    expect(parseOptionInstrument("BTC-25SEP26")).toBeNull();
    expect(parseOptionInstrument("BTC-PERPETUAL")).toBeNull();
  });

  it("renvoie null pour un mois invalide", () => {
    expect(parseOptionInstrument("BTC-2ZZZ26-78000-P")).toBeNull();
  });
});

describe("computeMaxPain", () => {
  it("trouve le strike de douleur minimale (exemple contrôlé)", () => {
    // 90 (call 10), 100 (call 5 / put 5), 110 (put 10).
    // Douleur : S=90 → 250 ; S=100 → 200 ; S=110 → 250. Minimum en 100.
    const niveaux: StrikeOi[] = [
      { strike: 90, callOi: 10, putOi: 0 },
      { strike: 100, callOi: 5, putOi: 5 },
      { strike: 110, callOi: 0, putOi: 10 },
    ];
    expect(computeMaxPain(niveaux)).toBe(100);
  });

  it("ignore les strikes invalides et renvoie null si aucun strike valide", () => {
    expect(computeMaxPain([])).toBeNull();
    expect(computeMaxPain([{ strike: 0, callOi: 1, putOi: 1 }])).toBeNull();
  });

  it("tolère des OI non finis (traités comme absents)", () => {
    const niveaux: StrikeOi[] = [
      { strike: 100, callOi: NaN, putOi: 10 },
      { strike: 120, callOi: 10, putOi: NaN },
    ];
    // S=100 : puts K>100 → aucun ; calls K<100 → aucun → 0 (minimum).
    expect(computeMaxPain(niveaux)).toBe(100);
  });
});

describe("putCallRatioOi", () => {
  it("calcule Σputs / Σcalls", () => {
    const points = [
      { type: "call" as const, openInterest: 10 },
      { type: "call" as const, openInterest: 30 },
      { type: "put" as const, openInterest: 20 },
    ];
    expect(putCallRatioOi(points)).toBeCloseTo(20 / 40, 6);
  });

  it("renvoie NaN sans aucun call", () => {
    expect(Number.isNaN(putCallRatioOi([{ type: "put", openInterest: 5 }]))).toBe(true);
  });
});
