/**
 * Tests du régime transversal (data/regimeTransversal.ts) : valeurs calculables à la main
 * (dispersion d'un éventail de rendements, univers parfaitement corrélé), plancher du
 * bruit sur rendements indépendants, données manquantes explicites, causalité par préfixe,
 * exclusion de la bougie du jour courant, résumé persisté du BRIEF (réseau bouchonné).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";

// Réseau bouchonné : catalogue CoinGecko, catalogue Binance et klines (jamais de fetch réel).
const bouchons = vi.hoisted(() => ({
  fetchKlines: vi.fn(),
  fetchMarketOverview: vi.fn(),
  fetchPairs: vi.fn(),
}));
vi.mock("./adapters", () => ({ getAdapter: () => ({ fetchKlines: bouchons.fetchKlines }) }));
vi.mock("./pairs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pairs")>()),
  fetchPairs: bouchons.fetchPairs,
}));
vi.mock("./marketOverview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./marketOverview")>()),
  fetchMarketOverview: bouchons.fetchMarketOverview,
}));

import { pearson, viderCacheSeries, type SerieCloture } from "./corr";
import {
  pearsonFenetre,
  calculerRegimeTransversal,
  CLE_RESUME_REGIME,
  derniereMesure,
  FENETRE_FACTEUR,
  hydraterResumeRegime,
  lireResumeRegime,
  mediane,
  mesurerRegimeTop50,
  MIN_ACTIFS_TRANSVERSAL,
  plancherBruitAbsorption,
  resumeRegimeFrais,
  resumeRegimeUtile,
  resumerRegime,
  TTL_RESUME_REGIME_MS,
  valeurPropreMax,
  type ResumeRegime,
} from "./regimeTransversal";

const JOUR = 86_400_000;
const J0 = 20_000;
const N = 400;
/** Midi UTC du jour qui suit la dernière clôture des fixtures. */
const NOW = (J0 + N) * JOUR + 12 * 3_600_000;

/** Générateur pseudo-aléatoire déterministe (mulberry32) et loi normale (Box-Muller). */
function aleatoire(graine: number): () => number {
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
  return Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

/** Série de clôtures depuis des rendements log (prix[0] = 100, puis produit cumulé). */
function serieDepuisRendements(rendements: readonly number[], depart = J0): SerieCloture[] {
  const out: SerieCloture[] = [{ time: depart * JOUR, close: 100 }];
  rendements.forEach((r, k) => {
    out.push({ time: (depart + k + 1) * JOUR, close: (out[k] as SerieCloture).close * Math.exp(r) });
  });
  return out;
}

/** Univers de `nb` alts à rendements gaussiens INDÉPENDANTS (σ = 3 %/j) + BTC indépendant. */
function universBruit(nb: number, graine = 7): { series: Map<string, SerieCloture[]>; alts: string[]; ref: SerieCloture[] } {
  const u = aleatoire(graine);
  const tirer = () => Array.from({ length: N - 1 }, () => 0.03 * normale(u));
  const alts = Array.from({ length: nb }, (_, i) => `A${i}USDT`);
  const series = new Map(alts.map((s) => [s, serieDepuisRendements(tirer())]));
  return { series, alts, ref: serieDepuisRendements(tirer()) };
}

describe("briques numériques", () => {
  it("médiane : impair, pair, vide", () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([4, 1, 3, 2])).toBe(2.5);
    expect(mediane([])).toBeNull();
  });

  it("valeur propre max : diagonale, matrice de uns, blocs anti-corrélés", () => {
    expect(valeurPropreMax([[3, 0], [0, 1]])).toBeCloseTo(3, 6);
    const uns = Array.from({ length: 4 }, () => [1, 1, 1, 1]);
    expect(valeurPropreMax(uns)).toBeCloseTo(4, 6);
    // [[1,−1],[−1,1]] : vecteur propre (1,−1), orthogonal à (1,1) — départ non uniforme exigé.
    expect(valeurPropreMax([[1, -1], [-1, 1]])).toBeCloseTo(2, 6);
    expect(valeurPropreMax([])).toBe(0);
  });

  it("pearsonFenetre : identique à pearson (corr.ts) sur la fenêtre, NaN écartés, effectif minimal", () => {
    const u = aleatoire(3);
    const xs = Array.from({ length: 50 }, () => normale(u));
    const ys = xs.map((x) => 0.6 * x + normale(u));
    xs[12] = NaN;
    ys[20] = NaN;
    expect(pearsonFenetre(xs, ys, 10, 39, 20)).toBeCloseTo(pearson(xs.slice(10, 40), ys.slice(10, 40)) as number, 12);
    expect(pearsonFenetre(xs, ys, 10, 39, 29)).toBeNull(); // 28 couples finis < 29
    expect(pearsonFenetre([1, 1, 1], [1, 2, 3], 0, 2, 2)).toBeNull(); // variance nulle
  });

  it("plancher du bruit Marchenko-Pastur : (1 + √(n/T))² / n", () => {
    expect(plancherBruitAbsorption(50, 60)).toBeCloseTo((1 + Math.sqrt(50 / 60)) ** 2 / 50, 12);
    expect(plancherBruitAbsorption(50, 60)).toBeCloseTo(0.0732, 3);
    expect(plancherBruitAbsorption(0, 60)).toBeNull();
  });

  it("dernière mesure : centile dans l'historique chargé, null si le dernier jour manque", () => {
    const d = derniereMesure({ valeurs: [0.1, null, 0.3, 0.2], nActifs: [5, 0, 6, 7] });
    expect(d).toEqual({ valeur: 0.2, nActifs: 7, centile: (100 * 2) / 3, nHistorique: 3 });
    expect(derniereMesure({ valeurs: [0.1, null], nActifs: [5, 0] })).toBeNull();
  });
});

describe("calculerRegimeTransversal — valeurs de construction", () => {
  it("éventail de rendements constants {−2a, −a, 0, a, 2a} : dispersion = a·√2 ; corrélations non mesurées", () => {
    const a = 0.01;
    const alts = ["M2USDT", "M1USDT", "Z0USDT", "P1USDT", "P2USDT"];
    const series = new Map(
      alts.map((s, i) => [s, serieDepuisRendements(new Array<number>(N - 1).fill((i - 2) * a))]),
    );
    const ref = universBruit(1).ref;
    const res = calculerRegimeTransversal(series, alts, ref, NOW);
    expect(res.derniers.dispersion7j?.valeur).toBeCloseTo(a * Math.SQRT2, 12);
    expect(res.derniers.dispersion7j?.nActifs).toBe(5);
    // Rendements constants : variance nulle ⇒ corrélations indéfinies ⇒ « non mesuré », pas 0.
    expect(res.derniers.medianeCorrBtc30j).toBeNull();
    expect(res.derniers.corrMoyenne60j).toBeNull();
    expect(res.derniers.absorption60j).toBeNull();
  });

  it("univers parfaitement corrélé à BTC (X = BTC × c) : corrélations et absorption = 1, dispersion = 0", () => {
    const { ref } = universBruit(1, 11);
    const alts = Array.from({ length: 8 }, (_, i) => `C${i}USDT`);
    const series = new Map(alts.map((s, i) => [s, ref.map((p) => ({ time: p.time, close: (i + 2) * p.close }))]));
    const res = calculerRegimeTransversal(series, alts, ref, NOW);
    expect(res.derniers.medianeCorrBtc30j?.valeur).toBeCloseTo(1, 9);
    expect(res.derniers.corrMoyenne60j?.valeur).toBeCloseTo(1, 9);
    expect(res.derniers.absorption60j?.valeur).toBeCloseTo(1, 9);
    expect(res.derniers.absorption60j?.nActifs).toBe(8);
    expect(res.derniers.dispersion7j?.valeur).toBeCloseTo(0, 12);
  });

  it("rendements indépendants (n = 50, T = 60) : absorption proche du plancher MP, pas de 1/n", () => {
    const { series, alts, ref } = universBruit(50);
    const res = calculerRegimeTransversal(series, alts, ref, NOW);
    const ar = res.derniers.absorption60j;
    const plancher = res.derniers.plancherBruit60j;
    expect(ar?.nActifs).toBe(50);
    expect(plancher).toBeCloseTo(plancherBruitAbsorption(50, FENETRE_FACTEUR) as number, 12);
    expect(ar!.valeur).toBeGreaterThan(2 / 50); // nettement au-dessus de 1/n = 0,02
    expect(ar!.valeur).toBeLessThan(1.3 * (plancher as number));
    expect(Math.abs(res.derniers.corrMoyenne60j!.valeur)).toBeLessThan(0.03);
    expect(Math.abs(res.derniers.medianeCorrBtc30j!.valeur)).toBeLessThan(0.15);
    // Dispersion ≈ σ = 3 %/j sur des tirages i.i.d.
    expect(res.derniers.dispersion7j!.valeur).toBeGreaterThan(0.025);
    expect(res.derniers.dispersion7j!.valeur).toBeLessThan(0.035);
  });
});

describe("calculerRegimeTransversal — données manquantes explicites", () => {
  it("moins de MIN_ACTIFS alts : toutes les mesures non mesurées (null), jamais 0", () => {
    const { series, alts, ref } = universBruit(MIN_ACTIFS_TRANSVERSAL - 1);
    const res = calculerRegimeTransversal(series, alts, ref, NOW);
    expect(res.derniers).toEqual({
      dispersion7j: null,
      medianeCorrBtc30j: null,
      corrMoyenne60j: null,
      absorption60j: null,
      plancherBruit60j: null,
    });
    expect(res.dispersion7j.valeurs.every((v) => v === null)).toBe(true);
  });

  it("référence absente : refDisponible faux, calendrier vide ; BTC et séries vides recensés", () => {
    const { series, alts } = universBruit(6);
    series.set("VIDEUSDT", []);
    const res = calculerRegimeTransversal(series, ["BTCUSDT", ...alts, "VIDEUSDT"], [], NOW);
    expect(res.refDisponible).toBe(false);
    expect(res.dernierJour).toBeNull();
    expect(res.jours).toEqual([]);
    expect(res.nAlts).toBe(6); // BTC écarté (référence), série vide non comptée
    expect(res.altsSansSerie).toEqual(["VIDEUSDT"]);
  });

  it("cotation non USD écartée et listée, BTC-PERP compté comme la référence (revue du 2026-11-07)", () => {
    const { series, alts, ref } = universBruit(6, 13);
    // ETHBTC (rendements en BTC) et SOLEUR (en EUR) ne se mêlent pas aux rendements en USD.
    series.set("ETHBTC", series.get("A0USDT") as SerieCloture[]);
    series.set("SOLEUR", series.get("A1USDT") as SerieCloture[]);
    series.set("BTC-PERP", ref);
    const res = calculerRegimeTransversal(series, [...alts, "ETHBTC", "BTC-PERP", "SOLEUR"], ref, NOW);
    const seuls = calculerRegimeTransversal(series, alts, ref, NOW);
    expect(res.nAlts).toBe(6);
    expect(res.exclus.map((e) => e.symbole)).toEqual(["ETHBTC", "SOLEUR"]);
    expect(res.exclus[0]!.raison).toMatch(/cotation BTC \(non USD\)/);
    expect(res.exclus[1]!.raison).toMatch(/cotation EUR \(non USD\)/);
    expect(res.derniers).toEqual(seuls.derniers);
    expect(seuls.exclus).toEqual([]);
  });

  it("alt à historique court : exclu de la matrice 60 j tant que sa fenêtre est incomplète", () => {
    const { series, alts, ref } = universBruit(6, 3);
    const court = (series.get("A0USDT") as SerieCloture[]).slice(-40); // 39 rendements
    series.set("A0USDT", court);
    const res = calculerRegimeTransversal(series, alts, ref, NOW);
    expect(res.derniers.absorption60j?.nActifs).toBe(5);
    expect(res.derniers.medianeCorrBtc30j?.nActifs).toBe(6); // 30 j : sa fenêtre est complète
  });
});

describe("calculerRegimeTransversal — causalité", () => {
  const { series, alts, ref } = universBruit(12, 5);

  it("préfixe : les valeurs des N premiers jours ne changent pas quand on en ajoute", () => {
    const complet = calculerRegimeTransversal(series, alts, ref, NOW);
    const k = N - 9;
    const tronquees = new Map([...series].map(([s, v]) => [s, v.slice(0, k)]));
    const prefixe = calculerRegimeTransversal(tronquees, alts, ref.slice(0, k), NOW);
    expect(prefixe.jours).toEqual(complet.jours.slice(0, k));
    for (const cle of ["dispersion7j", "medianeCorrBtc30j", "corrMoyenne60j", "absorption60j"] as const) {
      expect(prefixe[cle].valeurs.some((v) => v !== null)).toBe(true);
      expect(prefixe[cle].valeurs).toEqual(complet[cle].valeurs.slice(0, k));
    }
  });

  it("la bougie du jour UTC courant est écartée (un prix extrême ne change rien)", () => {
    const base = calculerRegimeTransversal(series, alts, ref, NOW);
    const avecPartielle = new Map([...series].map(([s, v]) => [s, [...v, { time: (J0 + N) * JOUR, close: 1e9 }]]));
    const res = calculerRegimeTransversal(avecPartielle, alts, [...ref, { time: (J0 + N) * JOUR, close: 1 }], NOW);
    expect(res).toEqual(base);
  });
});

describe("résumé du BRIEF", () => {
  const resume: ResumeRegime = {
    calculeA: NOW,
    jour: J0 + N - 1,
    univers: "Top 50",
    nAttendus: 49,
    nAlts: 47,
    dispersion7j: { valeur: 0.031, nActifs: 47, centile: 40, nHistorique: 390 },
    medianeCorrBtc30j: null,
    corrMoyenne60j: { valeur: 0.6, nActifs: 45, centile: 80, nHistorique: 340 },
    absorption60j: { valeur: 0.64, nActifs: 45, centile: 82, nHistorique: 340 },
    plancherBruit60j: 0.074,
  };

  it("aller-retour JSON, valeurs malformées rejetées sans jeter", () => {
    expect(hydraterResumeRegime(JSON.parse(JSON.stringify(resume)))).toEqual(resume);
    expect(hydraterResumeRegime(null)).toBeNull();
    expect(hydraterResumeRegime({ ...resume, calculeA: "hier" })).toBeNull();
    expect(hydraterResumeRegime({ ...resume, absorption60j: { valeur: NaN } })?.absorption60j).toBeNull();
  });

  it("fraîcheur : moins de 12 h ET dernière clôture de la veille UTC", () => {
    expect(resumeRegimeFrais(resume, NOW + 3_600_000)).toBe(true);
    expect(resumeRegimeFrais(resume, NOW + TTL_RESUME_REGIME_MS)).toBe(false);
    expect(resumeRegimeFrais(resume, NOW + JOUR - 13 * 3_600_000)).toBe(true); // 23 h UTC le même jour
    expect(resumeRegimeFrais({ ...resume, jour: J0 + N - 2 }, NOW)).toBe(false); // une clôture de retard
    expect(resumeRegimeFrais(resume, NOW - 1)).toBe(false); // calculé « dans le futur »
  });

  it("résumé null sans référence ; résumé sans aucune mesure jugé inutile", () => {
    const { series, alts } = universBruit(6);
    const sansRef = calculerRegimeTransversal(series, alts, [], NOW);
    expect(resumerRegime(sansRef, { calculeA: NOW, univers: "x", nAttendus: 6 })).toBeNull();
    expect(resumeRegimeUtile({ ...resume, dispersion7j: null, corrMoyenne60j: null, absorption60j: null })).toBe(false);
    expect(resumeRegimeUtile(resume)).toBe(true);
  });
});

describe("mesurerRegimeTop50 (réseau bouchonné)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    viderCacheSeries();
  });

  it("compose le top 50 (stables exclus, paires Binance), charge les séries, calcule et persiste", async () => {
    const stock = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stock.get(k) ?? null,
      setItem: (k: string, v: string) => void stock.set(k, v),
      removeItem: (k: string) => void stock.delete(k),
    });
    const tickers = ["BTC", "USDT", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LEO"];
    bouchons.fetchMarketOverview.mockResolvedValue({
      coins: tickers.map((symbol, i) => ({ symbol, mcapUsd: 1000 - i })),
    });
    // LEO n'a pas de paire Binance : sauté. USDT : stablecoin exclu.
    bouchons.fetchPairs.mockResolvedValue(tickers.filter((t) => t !== "LEO").map((t) => `${t}USDT`));
    const { series, ref } = universBruit(6, 9);
    const parSymbole = new Map<string, SerieCloture[]>([
      ["BTCUSDT", ref],
      ...["ETHUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT"].map(
        (s, i) => [s, series.get(`A${i}USDT`) as SerieCloture[]] as const,
      ),
    ]);
    bouchons.fetchKlines.mockImplementation(async (symbole: string): Promise<Candle[]> =>
      (parSymbole.get(symbole) ?? []).map((p) => ({
        time: p.time,
        open: p.close,
        high: p.close,
        low: p.close,
        close: p.close,
        volume: 0,
      })),
    );
    const resume = await mesurerRegimeTop50(NOW);
    expect(bouchons.fetchKlines.mock.calls.map((c) => c[0]).sort()).toEqual(
      ["ADAUSDT", "AVAXUSDT", "BTCUSDT", "DOGEUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"],
    );
    expect(resume.nAttendus).toBe(6);
    expect(resume.nAlts).toBe(6);
    expect(resume.jour).toBe(J0 + N - 1);
    expect(resume.absorption60j?.nActifs).toBe(6);
    expect(stock.has(CLE_RESUME_REGIME)).toBe(true);
    expect(lireResumeRegime()).toEqual(resume);
  });

  it("catalogue CoinGecko vide : erreur explicite, rien n'est persisté", async () => {
    const stock = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stock.get(k) ?? null,
      setItem: (k: string, v: string) => void stock.set(k, v),
    });
    bouchons.fetchMarketOverview.mockResolvedValue({ coins: [] });
    await expect(mesurerRegimeTop50(NOW)).rejects.toThrow(/CoinGecko/);
    expect(stock.size).toBe(0);
  });
});
