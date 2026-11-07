/**
 * Tests du HAR-RV (data/harRv.ts) : variance de Garman-Klass, historique contigu, OLS glissante,
 * causalité de la prévision, calibrage hors échantillon des queues épaisses et volatilité de la règle.
 * Séries synthétiques déterministes (générateur à graine) : aucun réseau.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import {
  ajusterHar,
  evaluerHorizon,
  historiqueRequis,
  mesureEnVolatilite,
  prevoirHar,
  segmentContigu,
  varianceGarmanKlass,
  volatiliteAvant,
} from "./harRv";

const JOUR = 86_400_000;
const T0 = Date.UTC(2023, 0, 2);

/** Générateur pseudo-aléatoire à graine (mulberry32). */
function alea(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normale(u: () => number): number {
  return Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** Student-t à `dl` degrés de liberté, réduite à variance 1 (queues épaisses). */
function student(u: () => number, dl: number): number {
  let chi = 0;
  for (let k = 0; k < dl; k++) chi += normale(u) ** 2;
  return normale(u) / Math.sqrt(chi / dl) / Math.sqrt(dl / (dl - 2));
}

/** Bougies 1d contiguës : rendement ouverture → clôture de σ quotidien donné, mèches cohérentes. */
function bougies(nb: number, sigma: (d: number) => number, tirage: (u: () => number) => number, graine = 7): Candle[] {
  const u = alea(graine);
  const out: Candle[] = [];
  let prix = 100;
  for (let d = 0; d < nb; d++) {
    const s = sigma(d);
    const open = prix;
    const close = open * Math.exp(s * tirage(u));
    const high = Math.max(open, close) * Math.exp(Math.abs(normale(u)) * s * 0.4);
    const low = Math.min(open, close) / Math.exp(Math.abs(normale(u)) * s * 0.4);
    out.push({ time: T0 + d * JOUR, open, high, low, close, volume: 1 });
    prix = close;
  }
  return out;
}

describe("varianceGarmanKlass", () => {
  it("0,5·ln(H/L)² − (2 ln 2 − 1)·ln(C/O)², nulle sur une bougie plate", () => {
    const v = varianceGarmanKlass({ time: 0, open: 100, high: 110, low: 95, close: 105, volume: 0 });
    expect(v).toBeCloseTo(0.5 * Math.log(110 / 95) ** 2 - (2 * Math.LN2 - 1) * Math.log(1.05) ** 2, 14);
    expect(varianceGarmanKlass({ time: 0, open: 5, high: 5, low: 5, close: 5, volume: 0 })).toBe(0);
  });

  it("OHLC absent ou incohérent → null (jamais 0)", () => {
    expect(varianceGarmanKlass({ time: 0, open: 0, high: 1, low: 1, close: 1, volume: 0 })).toBeNull();
    expect(varianceGarmanKlass({ time: 0, open: 1, high: 0.9, low: 1.1, close: 1, volume: 0 })).toBeNull();
    expect(varianceGarmanKlass({ time: 0, open: 1, high: Number.NaN, low: 1, close: 1, volume: 0 })).toBeNull();
  });
});

describe("segmentContigu", () => {
  it("écarte la bougie en cours et coupe au dernier trou ou à la dernière bougie invalide", () => {
    const b = bougies(10, () => 0.02, normale);
    const avecTrou = [...b.slice(0, 4), ...b.slice(5), { ...b[9]!, time: b[9]!.time + JOUR, closed: false }];
    expect(segmentContigu(avecTrou).map((c) => c.time)).toEqual(b.slice(5).map((c) => c.time));
    const invalide = b.map((c, i) => (i === 6 ? { ...c, low: 0 } : c));
    expect(segmentContigu(invalide)).toHaveLength(3);
    expect(segmentContigu([])).toEqual([]);
  });
});

describe("ajusterHar / prevoirHar", () => {
  /** Variances d'un processus HAR connu (bruit multiplicatif) : la régression doit le retrouver. */
  function processusHar(nb: number): number[] {
    const u = alea(11);
    const v: number[] = Array.from({ length: 22 }, () => 4e-4 * (0.5 + u()));
    for (let t = 21; v.length < nb; t++) {
      const w = v.slice(t - 4, t + 1).reduce((s, x) => s + x, 0) / 5;
      const m = v.slice(t - 21, t + 1).reduce((s, x) => s + x, 0) / 22;
      v.push((1e-4 + 0.35 * v[t]! + 0.3 * w + 0.2 * m) * (0.4 + 1.2 * u()));
    }
    return v;
  }

  it("retrouve les coefficients d'un HAR connu (OLS sur 1 500 lignes)", () => {
    const v = processusHar(1600);
    const beta = ajusterHar(v, 1590, 1500, 1);
    expect(beta).not.toBeNull();
    const [b0, bd, bw, bm] = beta!;
    expect(b0).toBeCloseTo(1e-4, 4);
    expect(bd).toBeGreaterThan(0.25);
    expect(bd).toBeLessThan(0.45);
    expect(bw! + bm!).toBeGreaterThan(0.35);
    expect(bw! + bm!).toBeLessThan(0.65);
  });

  it("refuse une fenêtre qui déborde (début < 22e jour ou cible au-delà de la série)", () => {
    const v = processusHar(600);
    expect(ajusterHar(v, 519, 500, 1)).toBeNull(); // première ligne au 20e jour
    expect(ajusterHar(v, 599, 500, 1)).toBeNull(); // cible du jour 600 inconnue
    expect(prevoirHar(v, 520, 1)).toBeNull(); // 500 lignes à cible connue exigées
    expect(prevoirHar(v, 521, 1)).not.toBeNull();
  });

  it("causalité : la prévision à l'origine T ignore tout ce qui suit T", () => {
    const v = processusHar(800);
    const p = prevoirHar(v, 700, 7);
    const futurModifie = [...v.slice(0, 701), ...v.slice(701).map((x) => x * 50)];
    expect(prevoirHar(futurModifie, 700, 7)).toEqual(p);
    expect(prevoirHar(v.slice(0, 701), 700, 7)).toEqual(p);
  });

  it("système singulier (variance constante) : repli h × moyenne 22 j, signalé", () => {
    const v = new Array<number>(600).fill(4e-4);
    const p = prevoirHar(v, 590, 7);
    expect(p?.filtre).toBe(true);
    expect(p?.variance).toBeCloseTo(7 * 4e-4, 15);
    expect(prevoirHar(new Array<number>(600).fill(0), 590, 1)).toBeNull(); // jamais une variance nulle
  });
});

describe("evaluerHorizon — calibrage hors échantillon", () => {
  const regime = (d: number): number => 0.02 * (1 + 0.6 * Math.sin(d / 40)); // vol qui persiste

  it.each([
    { nom: "gaussien", tirage: normale },
    { nom: "queues épaisses (Student 4)", tirage: (u: () => number) => student(u, 4) },
  ])("$nom : couverture hors échantillon proche du nominal 68 % / 95 % en 1 j", ({ tirage }) => {
    const seg = bougies(1300, regime, tirage);
    const p = evaluerHorizon(seg, 1, seg.length - 1);
    expect(p).not.toBeNull();
    const { n, dans1, dans2 } = p!.couverture;
    expect(n).toBeGreaterThan(600);
    expect(dans1 / n).toBeGreaterThan(0.62);
    expect(dans1 / n).toBeLessThan(0.74);
    expect(dans2 / n).toBeGreaterThan(0.92);
    expect(dans2 / n).toBeLessThan(0.98);
    expect(p!.k2).toBeGreaterThan(p!.k1);
    expect(p!.amplitude).toBeGreaterThan(p!.sigma); // le haut − bas d'un jour dépasse σ
  });

  it("queues épaisses : ±2σ calibré s'écarte du ±2 gaussien (k₂/k₁ ≠ 2)", () => {
    const seg = bougies(1300, regime, (u) => student(u, 3), 3);
    const p = evaluerHorizon(seg, 1, seg.length - 1)!;
    expect(p.k2 / p.k1).toBeGreaterThan(2.1);
  });

  it("7 j : fenêtres chevauchantes, σ hebdomadaire > σ quotidien", () => {
    const seg = bougies(1300, regime, normale);
    const jour = evaluerHorizon(seg, 1, seg.length - 1)!;
    const semaine = evaluerHorizon(seg, 7, seg.length - 1)!;
    expect(semaine.sigma).toBeGreaterThan(2 * jour.sigma);
    expect(semaine.couverture.dans1 / semaine.couverture.n).toBeGreaterThan(0.55);
    expect(semaine.couverture.dans1 / semaine.couverture.n).toBeLessThan(0.8);
  });

  it("causalité : σ, k et amplitude à l'origine ne dépendent que des jours jusqu'à elle", () => {
    const seg = bougies(1000, regime, normale);
    const origine = 900;
    const complet = evaluerHorizon(seg, 7, origine)!;
    const prefixe = evaluerHorizon(seg.slice(0, origine + 1), 7, origine)!;
    expect(prefixe.sigma).toBe(complet.sigma);
    expect(prefixe.k1).toBe(complet.k1);
    expect(prefixe.k2).toBe(complet.k2);
    expect(prefixe.amplitude).toBe(complet.amplitude);
    expect(prefixe.couverture.n).toBeLessThan(complet.couverture.n); // la couverture compte les issues connues
  });

  it("historique insuffisant (alt récent) : refus plutôt qu'extrapolation", () => {
    const requis = historiqueRequis(1);
    expect(requis).toBe(622);
    const court = bougies(requis - 1, regime, normale);
    expect(evaluerHorizon(court, 1, court.length - 1)).toBeNull();
    const juste = bougies(requis, regime, normale);
    expect(evaluerHorizon(juste, 1, juste.length - 1)).not.toBeNull();
    expect(historiqueRequis(7)).toBe(634);
  });

  it("bougie invalide dans le segment ou origine hors série → null", () => {
    const seg = bougies(700, regime, normale);
    expect(evaluerHorizon(seg, 1, 700)).toBeNull();
    expect(evaluerHorizon(seg.map((c, i) => (i === 3 ? { ...c, high: Number.NaN } : c)), 1, 699)).toBeNull();
  });
});

describe("volatiliteAvant (règle)", () => {
  const seg = bougies(200, () => 0.01, normale, 5);

  it("ATR(14) de Wilder identique à l'indicateur, sur les seules bougies jusqu'au départ", () => {
    const attendu = computeIndicator(getIndicator("atr")!, seg, { length: 14 }).series.atr?.[150];
    const r = volatiliteAvant(seg, 150);
    expect(r.atr).toBeCloseTo(attendu ?? Number.NaN, 10);
    const futurModifie = seg.map((c, i) => (i > 150 ? { ...c, high: c.high * 3 } : c));
    expect(volatiliteAvant(futurModifie, 150)).toEqual(r);
  });

  it("σ par bougie = écart-type population des 100 derniers log-rendements", () => {
    const r = Array.from({ length: 100 }, (_, k) => Math.log(seg[51 + k]!.close / seg[50 + k]!.close));
    const m = r.reduce((s, x) => s + x, 0) / 100;
    const attendu = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / 100);
    expect(volatiliteAvant(seg, 150).sigma).toBeCloseTo(attendu, 14);
  });

  it("étiquette : |Δ| en ATR(14) et en σ de l'horizon (σ par bougie × √n)", () => {
    expect(mesureEnVolatilite({ atr: 50, sigma: 0.01 }, 1000, 1120, 4)).toBe("2.4 ATR · 5.7σ"); // ln 1,12 / (0,01 × 2)
    expect(mesureEnVolatilite({ atr: 50, sigma: 0.01 }, 1120, 1000, 4)).toBe("2.4 ATR · 5.7σ");
    expect(mesureEnVolatilite({ atr: null, sigma: 0.01 }, 1000, 1100, 0)).toBe("— ATR · — σ");
    expect(mesureEnVolatilite({ atr: 10, sigma: null }, 1000, 1100, 3)).toBe("10.0 ATR · — σ");
  });

  it("trop peu de bougies : non mesuré (null), jamais 0", () => {
    expect(volatiliteAvant(seg, 10)).toEqual({ atr: null, sigma: null });
    expect(volatiliteAvant(seg, 15).sigma).toBeNull();
    expect(volatiliteAvant(seg, 0)).toEqual({ atr: null, sigma: null });
    expect(volatiliteAvant(seg, 500)).toEqual({ atr: null, sigma: null });
  });
});
