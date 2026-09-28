import { describe, expect, it } from "vitest";
import type { OptionPoint } from "./deribit";
import { resumerMarcheOptions } from "./marcheOptions";

const NOW = Date.parse("2026-09-25T07:59:59Z");
const EXP = Date.parse("2026-09-25T08:00:00Z");
const SUIVANTE = Date.parse("2026-10-02T08:00:00Z");
function option(patch: Partial<OptionPoint> = {}): OptionPoint {
  return { instrument: "BTC-25SEP26-100000-C", expiryMs: EXP, strike: 100_000,
    type: "call", markIv: 50, openInterest: 30, underlying: 100_000, indexPrice: 100_000,
    interestRate: 0, volume24h: 1, markPrice: 0.05, ...patch };
}

describe("synthèse de marché options", () => {
  it("concentration et couverture pondérées par OI, sans compter une IV absente dans les greeks", () => {
    const r = resumerMarcheOptions([
      option(), option({ type: "put", openInterest: 10 }),
      option({ expiryMs: SUIVANTE, openInterest: 40 }),
      option({ expiryMs: SUIVANTE, type: "put", openInterest: 20, markIv: NaN }),
    ], 100_000, NOW);
    expect(r.oiUsd).toBe(10_000_000);
    expect(r.pcOi).toBeCloseTo(30 / 70);
    expect(r.couvertureOiPct).toBe(80);
    expect(r.prochaineEcheance).toBe(EXP);
    expect(r.echeances.map((e) => [e.expiryMs, e.oiUsd, e.partOiPct])).toEqual([
      [EXP, 4_000_000, 40], [SUIVANTE, 6_000_000, 60],
    ]);
    expect(r.dominante?.expiryMs).toBe(SUIVANTE);
    expect(r.echeances[0]?.pcOi).toBeCloseTo(1 / 3);
    expect(r.echeances[1]?.couvertureOiPct).toBeCloseTo(200 / 3);
    expect(r.echeances[0]?.gexUsd).toBeGreaterThan(0);
  });

  it("retire à 08:00 UTC une échéance encore présente dans le dernier instantané", () => {
    const chain = [option({ openInterest: 90 }), option({ expiryMs: SUIVANTE, openInterest: 10 })];
    const r = resumerMarcheOptions(chain, 100_000, EXP);
    expect(r.oiUsd).toBe(1_000_000);
    expect(r.prochaineEcheance).toBe(SUIVANTE);
    expect(r.echeances).toHaveLength(1);
    expect(r.dominante?.partOiPct).toBe(100);
  });

  it("absence de greeks ou index = valeur absente, pas exposition nulle", () => {
    const sansIv = resumerMarcheOptions([option({ markIv: NaN })], 100_000, NOW);
    expect(sansIv.couvertureOiPct).toBe(0);
    expect(sansIv.echeances[0]?.gexUsd).toBeNull();
    expect(sansIv.echeances[0]?.dexUsd).toBeNull();
    const sansIndex = resumerMarcheOptions([option()], NaN, NOW);
    expect(sansIndex.oiUsd).toBeNull();
    expect(sansIndex.echeances[0]?.oiUsd).toBeNull();
    expect(resumerMarcheOptions([], 100_000, NOW).oiUsd).toBeNull();
  });

  it("écarte OI négatif/non fini et n'invente pas de concentration à OI nul", () => {
    const r = resumerMarcheOptions([option({ openInterest: -1 }), option({ openInterest: NaN }), option({ openInterest: 0 })], 100_000, NOW);
    expect(r.oiUsd).toBe(0);
    expect(r.pcOi).toBeNull();
    expect(r.couvertureOiPct).toBeNull();
    expect(r.dominante).toBeNull();
    expect(r.echeances[0]?.partOiPct).toBeNull();
    expect(r.nbOiInconnus).toBe(2);
    expect(r.echeances[0]?.gexUsd).toBe(0);
    expect(r.echeances[0]?.dexUsd).toBe(0);
  });

  it("OI intégralement inconnu : notionnel absent ; OI partiel : couverture qualifiée", () => {
    const absent = resumerMarcheOptions([option({ openInterest: NaN })], 100_000, NOW);
    expect(absent.oiUsd).toBeNull();
    expect(absent.echeances[0]?.oiUsd).toBeNull();
    expect(absent.nbOiInconnus).toBe(1);
    const partiel = resumerMarcheOptions([option({ openInterest: NaN }), option()], 100_000, NOW);
    expect(partiel.oiUsd).toBe(3_000_000);
    expect(partiel.couvertureOiPct).toBe(100);
    expect(partiel.nbOiInconnus).toBe(1);
  });

  it("distingue concentration et GEX court terme de la chaîne complète", () => {
    const r = resumerMarcheOptions([option({ type: "put", openInterest: 10 }), option({ expiryMs: SUIVANTE + 86400_000, openInterest: 90 })], 100_000, NOW);
    expect(r.courtTerme.partOiPct).toBe(10);
    expect(r.courtTerme.gexUsd).toBeLessThan(0);
  });

  it("OI inconnu sur une maturité : part inconnue même si une autre maturité est connue", () => {
    const r = resumerMarcheOptions([option({ openInterest: NaN }), option({ expiryMs: SUIVANTE + 86_400_000 })], 100_000, NOW);
    expect(r.echeances[0]?.partOiPct).toBeNull();
    expect(r.courtTerme.partOiPct).toBeNull();
    const sansIndex = resumerMarcheOptions([option(), option({ expiryMs: SUIVANTE + 86_400_000 })], NaN, NOW);
    expect(sansIndex.echeances[0]?.partOiPct).toBe(50);
    expect(sansIndex.courtTerme.partOiPct).toBe(50);
  });
});
