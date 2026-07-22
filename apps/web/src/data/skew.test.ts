import { describe, expect, it } from "vitest";
import { calculerSkew25d, type OptionSkewInput } from "./skew";
import { bsGreeks } from "./blackScholes";

// Convention d'injection du temps du dépôt (cf. gexDex.test.ts) : échéance à T = 0,25 an.
const NOW = Date.UTC(2026, 0, 1);
const UN_AN = 365 * 24 * 60 * 60 * 1000;
const EXPIRY = NOW + 0.25 * UN_AN;
const SPOT = 100;

/** Fabrique un point de chaîne (échéance T = 0,25 an, taux 0). */
function opt(type: "call" | "put", strike: number, markIv: number): OptionSkewInput {
  return { strike, type, markIv, interestRate: 0, expiryMs: EXPIRY };
}

/** Delta BS du point avec son IV PROPRE — même calcul que l'implémentation. */
function delta(p: OptionSkewInput): number {
  const g = bsGreeks(SPOT, p.strike, 0.25, p.markIv / 100, p.interestRate);
  return p.type === "call" ? g.deltaCall : g.deltaPut;
}

/** Écart à la cible 25Δ (call : +0,25 ; put : −0,25). */
function ecart(p: OptionSkewInput): number {
  return Math.abs(delta(p) - (p.type === "call" ? 0.25 : -0.25));
}

// Chaîne discriminante : plusieurs calls encadrant +0,25 et puts encadrant −0,25 en delta.
// Les gagnants attendus (128 côté call, 84 côté put) ne sont NI les premiers de la liste NI
// les plus proches du spot — une sélection « ATM » ou « premier venu » ferait échouer le test.
const CALLS = [opt("call", 118, 55), opt("call", 128, 57), opt("call", 140, 60)];
const PUTS = [opt("put", 78, 64), opt("put", 84, 62), opt("put", 90, 58)];

describe("calculerSkew25d", () => {
  it("retient le call/put au delta le plus proche de ±0,25 (pas l'ATM ni le premier)", () => {
    // Garde-fous du fixture : 128 et 84 sont bien les plus proches de ±0,25 en delta.
    expect(Math.min(...CALLS.map(ecart))).toBeCloseTo(ecart(opt("call", 128, 57)), 12);
    expect(Math.min(...PUTS.map(ecart))).toBeCloseTo(ecart(opt("put", 84, 62)), 12);

    const res = calculerSkew25d([...CALLS, ...PUTS], SPOT, NOW);
    expect(res?.strikeCall).toBe(128);
    expect(res?.strikePut).toBe(84);
    expect(res?.ivCall).toBe(57);
    expect(res?.ivPut).toBe(62);
    // RR25 = IV(call 25Δ) − IV(put 25Δ) = 57 − 62 = −5 pts : puts chers → skew baissier.
    expect(res?.rr25).toBeCloseTo(-5, 9);
  });

  it("renvoie null si aucun call n'est à ±0,10 en delta de la cible (grille clairsemée)", () => {
    const callLoin = opt("call", 114, 55); // delta ≈ 0,37 → écart ≈ 0,12, juste hors tolérance
    expect(ecart(callLoin)).toBeGreaterThan(0.1);
    expect(calculerSkew25d([callLoin, ...PUTS], SPOT, NOW)).toBeNull();
  });

  it("renvoie null si l'échéance n'a pas de put proche de 25Δ (absent ou hors tolérance)", () => {
    expect(calculerSkew25d([], SPOT, NOW)).toBeNull();
    expect(calculerSkew25d(CALLS, SPOT, NOW)).toBeNull(); // aucun put du tout
    const putLoin = opt("put", 40, 62); // put très OTM : delta ≈ 0 → écart ≈ 0,25
    expect(ecart(putLoin)).toBeGreaterThan(0.1);
    expect(calculerSkew25d([...CALLS, putLoin], SPOT, NOW)).toBeNull();
  });

  it("écarte les IV manquantes ou nulles (repli sur le candidat suivant)", () => {
    // Le call 128 (gagnant du cas nominal) a une IV NaN → écarté ; repli sur 118.
    const callsNan = [opt("call", 118, 55), opt("call", 128, NaN), opt("call", 140, 60)];
    expect(calculerSkew25d([...callsNan, ...PUTS], SPOT, NOW)?.strikeCall).toBe(118);
    // IV ≤ 0 : écartée aussi (pas de delta exploitable).
    const callsZero = [opt("call", 118, 55), opt("call", 128, 0), opt("call", 140, 60)];
    expect(calculerSkew25d([...callsZero, ...PUTS], SPOT, NOW)?.strikeCall).toBe(118);
  });

  it("renvoie null si l'échéance est passée (T ≤ 0 → greeks NaN)", () => {
    const passes = [...CALLS, ...PUTS].map((p) => ({ ...p, expiryMs: NOW - UN_AN }));
    expect(calculerSkew25d(passes, SPOT, NOW)).toBeNull();
  });

  it("renvoie null si le spot est invalide", () => {
    expect(calculerSkew25d([...CALLS, ...PUTS], NaN, NOW)).toBeNull();
    expect(calculerSkew25d([...CALLS, ...PUTS], 0, NOW)).toBeNull();
  });
});
