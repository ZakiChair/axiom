import { describe, expect, it } from "vitest";
import { mouvementsAttendus, SEUIL_BRUIT_JOURS } from "./mouvementAttendu";
import { normCdf } from "./blackScholes";
import type { OptionPoint } from "./deribit";

// Convention d'injection du temps du dépôt (cf. termIv.test.ts).
const NOW = Date.UTC(2026, 0, 1);
const UN_AN = 365 * 24 * 60 * 60 * 1000;
const HEURE = 3_600_000;
const E1 = NOW + 0.25 * UN_AN;
const E2 = NOW + 0.5 * UN_AN;

/** Point d'option avec valeurs par défaut plausibles, surchargées au besoin. */
function pt(over: Partial<OptionPoint>): OptionPoint {
  return {
    instrument: over.instrument ?? "X",
    expiryMs: E1,
    strike: 100_000,
    type: "call",
    markIv: 50,
    openInterest: 1,
    underlying: 100_000,
    interestRate: 0,
    volume24h: NaN,
    markPrice: 0.02,
    ...over,
  };
}

/** Call Black-Scholes sur forward (r = 0), en USD : F·N(d1) − K·N(d2). Helper de test uniquement. */
function prixCallForward(f: number, k: number, sigma: number, t: number): number {
  const volT = sigma * Math.sqrt(t);
  const d1 = (Math.log(f / k) + (volT * volT) / 2) / volT;
  const d2 = d1 - volT;
  return f * normCdf(d1) - k * normCdf(d2);
}

describe("mouvementsAttendus", () => {
  it("straddle ATM : marks call + put × forward, en % et en USD, bornes F ∓ straddle", () => {
    const chain = [pt({ type: "call" }), pt({ type: "put" })];
    const [p] = mouvementsAttendus(chain, NOW);
    expect(p?.forward).toBe(100_000);
    expect(p?.strikeAtm).toBe(100_000);
    expect(p?.straddlePct).toBeCloseTo(4, 9);
    expect(p?.straddleUsd).toBeCloseTo(4_000, 6);
    expect(p?.borneBasse).toBeCloseTo(96_000, 6);
    expect(p?.borneHaute).toBeCloseTo(104_000, 6);
  });

  it("convertit au forward DE L'ÉCHÉANCE (pas un spot commun)", () => {
    const chain = [
      pt({ type: "call", underlying: 102_000, strike: 102_000 }),
      pt({ type: "put", underlying: 102_000, strike: 102_000 }),
    ];
    const [p] = mouvementsAttendus(chain, NOW);
    expect(p?.straddleUsd).toBeCloseTo(0.04 * 102_000, 6);
  });

  it("strike ATM = le plus proche du forward (en dessous puis au-dessus)", () => {
    const grille = (f: number) => [
      pt({ strike: 100_000, type: "call", underlying: f }),
      pt({ strike: 100_000, type: "put", underlying: f }),
      pt({ strike: 101_000, type: "call", underlying: f }),
      pt({ strike: 101_000, type: "put", underlying: f }),
    ];
    expect(mouvementsAttendus(grille(100_400), NOW)[0]?.strikeAtm).toBe(100_000);
    expect(mouvementsAttendus(grille(100_600), NOW)[0]?.strikeAtm).toBe(101_000);
  });

  it("EM IV = F × IV/100 × √T (1σ), en USD et en %", () => {
    const chain = [pt({ type: "call", markIv: 50 }), pt({ type: "put", markIv: 50 })];
    const [p] = mouvementsAttendus(chain, NOW);
    expect(p?.ivAtm).toBeCloseTo(50, 9);
    expect(p?.emIvPct).toBeCloseTo(25, 9);
    expect(p?.emIvUsd).toBeCloseTo(25_000, 6);
  });

  it("IV ATM : moyenne call/put, sinon le seul côté fini", () => {
    const deux = [pt({ type: "call", markIv: 40 }), pt({ type: "put", markIv: 60 })];
    expect(mouvementsAttendus(deux, NOW)[0]?.ivAtm).toBeCloseTo(50, 9);
    const un = [pt({ type: "call", markIv: NaN }), pt({ type: "put", markIv: 62 })];
    expect(mouvementsAttendus(un, NOW)[0]?.ivAtm).toBe(62);
  });

  it("contrôle théorique : straddle ATM / σ√T ≈ 0,798 sur des marks Black-Scholes à σ plat", () => {
    const f = 100_000;
    const sigma = 0.4;
    const t = 0.1;
    const exp = NOW + t * UN_AN;
    const call = prixCallForward(f, f, sigma, t);
    const put = call; // parité à K = F, r = 0
    const chain = [
      pt({ expiryMs: exp, strike: f, type: "call", markIv: 40, markPrice: call / f }),
      pt({ expiryMs: exp, strike: f, type: "put", markIv: 40, markPrice: put / f }),
    ];
    const [p] = mouvementsAttendus(chain, NOW);
    const ratio = (p?.straddleUsd ?? NaN) / (p?.emIvUsd ?? NaN);
    expect(Math.abs(ratio - 0.798)).toBeLessThan(0.005);
  });

  it("côté put absent : straddle et bornes null, EM IV conservé", () => {
    const chain = [pt({ type: "call" }), pt({ type: "put", markPrice: NaN })];
    const [p] = mouvementsAttendus(chain, NOW);
    expect(p?.straddleBase).toBeNull();
    expect(p?.straddlePct).toBeNull();
    expect(p?.straddleUsd).toBeNull();
    expect(p?.borneBasse).toBeNull();
    expect(p?.borneHaute).toBeNull();
    expect(p?.emIvUsd).toBeCloseTo(25_000, 6);
  });

  it("aucune IV finie et positive à l'ATM : EM IV null (jamais 0), straddle conservé", () => {
    const chain = [pt({ type: "call", markIv: NaN }), pt({ type: "put", markIv: 0 })];
    const [p] = mouvementsAttendus(chain, NOW);
    expect(p?.ivAtm).toBeNull();
    expect(p?.emIvPct).toBeNull();
    expect(p?.emIvUsd).toBeNull();
    expect(p?.straddleUsd).toBeCloseTo(4_000, 6);
  });

  it("trie par échéance croissante et omet les échéances expirées", () => {
    const chain = [
      pt({ expiryMs: E2, type: "call" }),
      pt({ expiryMs: E2, type: "put" }),
      pt({ expiryMs: NOW, type: "call" }),
      pt({ expiryMs: NOW - HEURE, type: "put" }),
      pt({ expiryMs: E1, type: "call" }),
      pt({ expiryMs: E1, type: "put" }),
    ];
    expect(mouvementsAttendus(chain, NOW).map((p) => p.expiryMs)).toEqual([E1, E2]);
  });

  it("omet l'échéance sans forward fini et positif", () => {
    const chain = [pt({ type: "call", underlying: NaN }), pt({ type: "put", underlying: 0 })];
    expect(mouvementsAttendus(chain, NOW)).toEqual([]);
  });

  it("signale les échéances à moins de 2 jours comme bruitées", () => {
    expect(SEUIL_BRUIT_JOURS).toBe(2);
    const proche = NOW + 32 * HEURE;
    const loin = NOW + 56 * HEURE;
    const chain = [
      pt({ expiryMs: proche, type: "call" }),
      pt({ expiryMs: proche, type: "put" }),
      pt({ expiryMs: loin, type: "call" }),
      pt({ expiryMs: loin, type: "put" }),
    ];
    const res = mouvementsAttendus(chain, NOW);
    expect(res[0]?.joursRestants).toBeCloseTo(32 / 24, 9);
    expect(res[0]?.bruitee).toBe(true);
    expect(res[1]?.bruitee).toBe(false);
  });

  it("chaîne vide : tableau vide", () => {
    expect(mouvementsAttendus([], NOW)).toEqual([]);
  });
});
