import { describe, expect, it } from "vitest";
import {
  courbeProbaImplicite,
  lireProbasNiveau,
  niveauParDefaut,
  prixCourant,
  probaClotureAuDessus,
  probaToucher,
  type CourbeProbaImplicite,
} from "./probaImplicite";
import { normCdf } from "./blackScholes";
import type { OptionPoint } from "./deribit";

// Convention d'injection du temps du dépôt (cf. termIv.test.ts, mouvementAttendu.test.ts).
const NOW = Date.UTC(2026, 0, 1);
const UN_AN = 365 * 24 * 60 * 60 * 1000;
const EXP = NOW + 0.25 * UN_AN;
const F = 100_000;
const SIGMA = 0.6;
const T = 0.25;

/** Point d'option avec valeurs par défaut plausibles, surchargées au besoin. */
function pt(over: Partial<OptionPoint>): OptionPoint {
  return {
    instrument: over.instrument ?? "X",
    expiryMs: EXP,
    strike: F,
    type: "call",
    markIv: 60,
    openInterest: 1,
    underlying: F,
    interestRate: 0,
    volume24h: NaN,
    markPrice: 0.02,
    ...over,
  };
}

/** d1, d2 Black-Scholes sur forward (r = 0). Helpers de test uniquement. */
function d1d2(f: number, k: number, sigma: number, t: number): [number, number] {
  const volT = sigma * Math.sqrt(t);
  const d1 = (Math.log(f / k) + (volT * volT) / 2) / volT;
  return [d1, d1 - volT];
}
/** Call sur forward en USD : F·N(d1) − K·N(d2). */
function prixCallForward(f: number, k: number, sigma: number, t: number): number {
  const [d1, d2] = d1d2(f, k, sigma, t);
  return f * normCdf(d1) - k * normCdf(d2);
}
/** Put sur forward en USD : K·N(−d2) − F·N(−d1). */
function prixPutForward(f: number, k: number, sigma: number, t: number): number {
  const [d1, d2] = d1d2(f, k, sigma, t);
  return k * normCdf(-d2) - f * normCdf(-d1);
}
/** N(d2) : probabilité risque-neutre de clôture au-dessus de K sous Black-Scholes à σ plat. */
function nD2(k: number): number {
  return normCdf(d1d2(F, k, SIGMA, T)[1]);
}

/** Chaîne synthétique à σ plat : marks = prix BS / F (unités de base, comme Deribit). */
function chaineBs(strikes: number[], cotes: "tous" | "calls" | "puts" = "tous"): OptionPoint[] {
  const out: OptionPoint[] = [];
  for (const k of strikes) {
    if (cotes !== "puts") out.push(pt({ strike: k, type: "call", markPrice: prixCallForward(F, k, SIGMA, T) / F }));
    if (cotes !== "calls") out.push(pt({ strike: k, type: "put", markPrice: prixPutForward(F, k, SIGMA, T) / F }));
  }
  return out;
}

function grille(debut: number, fin: number, pas: number): number[] {
  const out: number[] = [];
  for (let k = debut; k <= fin; k += pas) out.push(k);
  return out;
}

/** Chaîne à prix de call USD imposés (calls seuls) : lectures calculables à la main. */
function chaineCalls(prix: Array<[number, number]>): OptionPoint[] {
  return prix.map(([k, c]) => pt({ strike: k, type: "call", markPrice: c / F }));
}

describe("courbeProbaImplicite — référence Black-Scholes à σ plat", () => {
  const courbe = courbeProbaImplicite(chaineBs(grille(60_000, 140_000, 1_000)), NOW);

  it("P(clôture > K) = N(d2) à ±0,5 pt (milieu d'intervalle, strike listé, ailes)", () => {
    expect(courbe).not.toBeNull();
    for (const k of [100_500, 100_000, 85_000, 120_000, 70_250, 133_000]) {
      const p = probaClotureAuDessus(courbe!, k);
      expect(p, `K = ${k}`).not.toBeNull();
      expect(Math.abs(p! - nD2(k)), `K = ${k}`).toBeLessThan(0.005);
    }
  });

  it("grille non uniforme type Deribit (pas de 5 000 loin de la monnaie) : même tolérance", () => {
    const strikes = [...grille(50_000, 75_000, 5_000), ...grille(80_000, 120_000, 1_000), ...grille(125_000, 160_000, 5_000)];
    const c = courbeProbaImplicite(chaineBs(strikes), NOW);
    for (const k of [62_000, 77_500, 99_000, 122_500, 150_000]) {
      const p = probaClotureAuDessus(c!, k);
      expect(Math.abs(p! - nD2(k)), `K = ${k}`).toBeLessThan(0.005);
    }
  });

  it("expose l'échéance, le forward, T (base 365 j) et l'IV ATM au strike le plus proche du forward", () => {
    expect(courbe?.expiryMs).toBe(EXP);
    expect(courbe?.forward).toBe(F);
    expect(courbe?.t).toBeCloseTo(T, 12);
    expect(courbe?.ivAtm).toBeCloseTo(60, 12);
  });

  it("milieux triés croissants, probas dans [0 ; 1] et non croissantes", () => {
    expect(courbe!.milieux).toHaveLength(80);
    expect(courbe!.milieux[0]).toBe(60_500);
    for (let i = 1; i < courbe!.milieux.length; i++) {
      expect(courbe!.milieux[i]!).toBeGreaterThan(courbe!.milieux[i - 1]!);
      expect(courbe!.probas[i]!).toBeLessThanOrEqual(courbe!.probas[i - 1]!);
    }
    for (const p of courbe!.probas) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe("courbeProbaImplicite — prix de call par strike", () => {
  const strikes = grille(80_000, 120_000, 1_000);
  const complete = courbeProbaImplicite(chaineBs(strikes), NOW)!;

  it("parité : calls seuls partout (terme F − K non exercé) ⇒ probas identiques à 1e-6", () => {
    const calls = courbeProbaImplicite(chaineBs(strikes, "calls"), NOW)!;
    expect(calls.milieux).toEqual(complete.milieux);
    calls.probas.forEach((p, i) => expect(Math.abs(p - complete.probas[i]!)).toBeLessThan(1e-6));
  });

  it("parité : puts seuls partout (C = P·F + F − K au-dessus de F aussi) ⇒ probas identiques à 1e-6", () => {
    const puts = courbeProbaImplicite(chaineBs(strikes, "puts"), NOW)!;
    expect(puts.milieux).toEqual(complete.milieux);
    puts.probas.forEach((p, i) => expect(Math.abs(p - complete.probas[i]!)).toBeLessThan(1e-6));
  });

  it("put hors de la monnaie sous F, call au-dessus : un mark d'ITM incohérent est ignoré", () => {
    // Call ITM à 90 000 faux (mark nul) : le put OTM fait foi sous le forward.
    const chaine = chaineBs(strikes).map((p) =>
      p.strike === 90_000 && p.type === "call" ? { ...p, markPrice: 0 } : p,
    );
    const c = courbeProbaImplicite(chaine, NOW)!;
    c.probas.forEach((p, i) => expect(Math.abs(p - complete.probas[i]!)).toBeLessThan(1e-6));
  });

  it("strike sans aucun mark fini : exclu de la grille (jamais remplacé par zéro)", () => {
    const chaine = chaineBs(strikes).map((p) => (p.strike === 100_000 ? { ...p, markPrice: Number.NaN } : p));
    const c = courbeProbaImplicite(chaine, NOW)!;
    expect(c.milieux).not.toContain(99_500);
    expect(c.milieux).toContain(100_000); // (99 000 + 101 000) / 2
  });

  it("interpolation linéaire entre milieux (valeurs calculées à la main)", () => {
    // C : 10 500, 6 000, 2 500, 800, 200 → pentes 0,9 @ 92 500 ; 0,7 @ 97 500 ; 0,34 @ 102 500 ; 0,12 @ 107 500.
    const c = courbeProbaImplicite(
      chaineCalls([[90_000, 10_500], [95_000, 6_000], [100_000, 2_500], [105_000, 800], [110_000, 200]]),
      NOW,
    )!;
    expect(c.milieux).toEqual([92_500, 97_500, 102_500, 107_500]);
    [0.9, 0.7, 0.34, 0.12].forEach((v, i) => expect(c.probas[i]).toBeCloseTo(v, 9));
    expect(probaClotureAuDessus(c, 100_000)).toBeCloseTo(0.52, 9);
    expect(probaClotureAuDessus(c, 105_000)).toBeCloseTo(0.23, 9);
    expect(probaClotureAuDessus(c, 92_500)).toBeCloseTo(0.9, 9);
    expect(probaClotureAuDessus(c, 107_500)).toBeCloseTo(0.12, 9);
  });
});

describe("courbeProbaImplicite — bornes, monotonie et refus", () => {
  it("pente > 1 bornée à 1, pente négative bornée à 0, remontée aplatie (monotonie imposée)", () => {
    // Pentes brutes : 1,2 ; 0,7 ; −0,02 ; 0,48 → bornées 1 ; 0,7 ; 0 ; 0,48 → monotones 1 ; 0,7 ; 0 ; 0.
    const c = courbeProbaImplicite(
      chaineCalls([[90_000, 12_000], [95_000, 6_000], [100_000, 2_500], [105_000, 2_600], [110_000, 200]]),
      NOW,
    )!;
    expect(c.probas).toEqual([1, expect.closeTo(0.7, 9), 0, 0]);
  });

  it("hors grille : null sous le premier milieu et au-dessus du dernier", () => {
    const c = courbeProbaImplicite(
      chaineCalls([[90_000, 10_500], [95_000, 6_000], [100_000, 2_500]]),
      NOW,
    )!;
    expect(probaClotureAuDessus(c, 92_499)).toBeNull();
    expect(probaClotureAuDessus(c, 97_501)).toBeNull();
    expect(probaClotureAuDessus(c, Number.NaN)).toBeNull();
  });

  it("moins de 3 strikes exploitables, forward invalide ou échéance passée : null", () => {
    expect(courbeProbaImplicite(chaineCalls([[95_000, 6_000], [100_000, 2_500]]), NOW)).toBeNull();
    expect(courbeProbaImplicite([], NOW)).toBeNull();
    const sansForward = chaineBs(grille(90_000, 110_000, 5_000)).map((p) => ({ ...p, underlying: Number.NaN }));
    expect(courbeProbaImplicite(sansForward, NOW)).toBeNull();
    expect(courbeProbaImplicite(chaineBs(grille(90_000, 110_000, 5_000)), EXP)).toBeNull();
  });

  it("IV ATM : null si aucune IV finie au strike le plus proche du forward (la courbe reste lisible)", () => {
    const chaine = chaineBs(grille(90_000, 110_000, 5_000)).map((p) =>
      p.strike === F ? { ...p, markIv: Number.NaN } : p,
    );
    const c = courbeProbaImplicite(chaine, NOW);
    expect(c?.ivAtm).toBeNull();
    expect(c?.probas.length).toBe(4);
  });
});

describe("probaToucher — barrière log-normale sans dérive, depuis le prix courant S", () => {
  const S = 100_000;

  it("K = S : contact certain", () => {
    expect(probaToucher(S, S, 60, T)).toBeCloseTo(1, 12);
  });

  it("K à ±1σ (S·e^{±σ√T}) : 2·Φ(−1) ≈ 0,3173", () => {
    const k = S * Math.exp(SIGMA * Math.sqrt(T));
    expect(probaToucher(k, S, 60, T)).toBeCloseTo(0.3173, 4);
    expect(probaToucher(S * Math.exp(-SIGMA * Math.sqrt(T)), S, 60, T)).toBeCloseTo(0.3173, 4);
  });

  it("entrées invalides : null (σ ≤ 0, T ≤ 0, niveau ou prix courant ≤ 0, non finis)", () => {
    expect(probaToucher(F, F, 0, T)).toBeNull();
    expect(probaToucher(F, F, 60, 0)).toBeNull();
    expect(probaToucher(0, F, 60, T)).toBeNull();
    expect(probaToucher(F, Number.NaN, 60, T)).toBeNull();
  });
});

describe("lireProbasNiveau — les deux lectures d'un niveau", () => {
  const c = courbeProbaImplicite(
    chaineCalls([[90_000, 10_500], [95_000, 6_000], [100_000, 2_500], [105_000, 800], [110_000, 200]]).map((p) => ({ ...p, markIv: 50 })),
    NOW,
  );

  it("P(clôture) interpolée et P(toucher) à l'IV ATM de la courbe, depuis le prix courant", () => {
    const l = lireProbasNiveau(c, 105_000, F);
    expect(l.pCloture).toBeCloseTo(0.23, 9);
    expect(l.pToucher).toBeCloseTo(probaToucher(105_000, F, 50, T)!, 12);
  });

  it("forward de l'échéance ≠ prix courant : P(toucher) mesure la distance au prix courant, pas au forward", () => {
    // Échéance lointaine en contango : forward 104 000, prix courant 100 000, IV 50 %.
    const lointaine = courbeProbaImplicite(
      chaineCalls([[90_000, 16_000], [100_000, 8_000], [110_000, 3_000], [120_000, 1_000]]).map((p) => ({
        ...p,
        underlying: 104_000,
        markPrice: (p.markPrice * F) / 104_000,
        markIv: 50,
      })),
      NOW,
    )!;
    expect(lointaine.forward).toBe(104_000);
    const auForward = lireProbasNiveau(lointaine, 104_000, F);
    // K = F n'est pas un contact certain : ln(1,04) / (0,5·√0,25) = 0,1569 → 2·Φ(−0,1569) ≈ 87,5 %.
    expect(auForward.pToucher).toBeCloseTo(probaToucher(104_000, F, 50, T)!, 12);
    expect(auForward.pToucher).toBeCloseTo(2 * normCdf(-Math.log(1.04) / (0.5 * Math.sqrt(T))), 12);
    expect(auForward.pToucher!).toBeLessThan(0.9);
    // K = S : contact certain ; P(clôture) reste lue sur la courbe de l'échéance (forward 104 000).
    const auPrix = lireProbasNiveau(lointaine, F, F);
    expect(auPrix.pToucher).toBeCloseTo(1, 12);
    expect(auPrix.pCloture).toBeCloseTo(probaClotureAuDessus(lointaine, F)!, 12);
  });

  it("prix courant absent : P(toucher) null (jamais le forward de l'échéance en remplacement)", () => {
    const l = lireProbasNiveau(c, 105_000, null);
    expect(l.pCloture).toBeCloseTo(0.23, 9);
    expect(l.pToucher).toBeNull();
    expect(lireProbasNiveau(c, 105_000, Number.NaN).pToucher).toBeNull();
  });

  it("courbe absente, niveau absent ou ≤ 0 : les deux null ; hors grille : P(toucher) seule", () => {
    expect(lireProbasNiveau(null, 100_000, F)).toEqual({ pCloture: null, pToucher: null });
    expect(lireProbasNiveau(c, null, F)).toEqual({ pCloture: null, pToucher: null });
    expect(lireProbasNiveau(c, 0, F)).toEqual({ pCloture: null, pToucher: null });
    const hors = lireProbasNiveau(c, 120_000, F);
    expect(hors.pCloture).toBeNull();
    expect(hors.pToucher).not.toBeNull();
  });
});

describe("prixCourant — forward de l'échéance non expirée la plus proche (≈ index)", () => {
  it("indépendant de l'ordre de la chaîne : l'échéance la plus proche l'emporte", () => {
    const proche = pt({ expiryMs: NOW + 3_600_000, underlying: 100_010 });
    const lointaine = pt({ expiryMs: EXP, underlying: 104_000 });
    expect(prixCourant([lointaine, proche], NOW)).toBe(100_010);
    expect(prixCourant([proche, lointaine], NOW)).toBe(100_010);
  });

  it("ignore les échéances expirées et les forwards invalides ; null si aucun", () => {
    const expiree = pt({ expiryMs: NOW, underlying: 99_000 });
    const sansForward = pt({ expiryMs: NOW + 3_600_000, underlying: Number.NaN });
    const suivante = pt({ expiryMs: EXP, underlying: 104_000 });
    expect(prixCourant([expiree, sansForward, suivante], NOW)).toBe(104_000);
    expect(prixCourant([expiree, sansForward], NOW)).toBeNull();
    expect(prixCourant([], NOW)).toBeNull();
  });
});

describe("niveauParDefaut — forward arrondi à 3 chiffres significatifs", () => {
  it("BTC au pas de 100 (1 000 au-delà de 100 000), ETH au pas de 10", () => {
    expect(niveauParDefaut(79_294)).toBe(79_300);
    expect(niveauParDefaut(100_000)).toBe(100_000);
    expect(niveauParDefaut(123_456)).toBe(123_000);
    expect(niveauParDefaut(3_124.5)).toBe(3_120);
  });
});

// Garde de type : l'interface exportée reste la forme attendue par OptionsWindow.
const _forme: CourbeProbaImplicite = { expiryMs: 0, forward: 1, t: 1, ivAtm: null, milieux: [], probas: [] };
void _forme;
