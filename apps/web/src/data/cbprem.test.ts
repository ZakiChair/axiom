/**
 * Tests des fonctions PURES du premium Coinbase/Binance : alignement des deux
 * séries de klines par openTime, calcul du premium signé, stats dérivées.
 * Les valeurs attendues sont justifiées en commentaire.
 */
import { describe, it, expect } from "vitest";
import {
  bandesPremium,
  ecartPegDernierPoint,
  serieCbprem,
  serieCbpremAjustee,
  statsPremium,
  zPoint,
  type PointPremium,
} from "./cbprem";

const JOUR_MS = 24 * 3_600_000;

describe("serieCbprem — alignement par openTime", () => {
  it("ne garde que les points communs (Map), tolère le désordre d'entrée, trie chrono en sortie", () => {
    // Entrée scramblée des DEUX côtés ; t=9999 (cb seul) et t=2000 (bn seul) sans
    // contrepartie → omis. Les deux points communs (1000, 3000) doivent sortir
    // triés par t croissant même si l'entrée cb les donne dans l'ordre inverse.
    const klinesCb = [
      { t: 3_000, close: 301 },
      { t: 9_999, close: 999 }, // sans contrepartie bn → exclu
      { t: 1_000, close: 101 },
    ];
    const klinesBn = [
      { t: 2_000, close: 200 }, // sans contrepartie cb → exclu
      { t: 3_000, close: 300 },
      { t: 1_000, close: 100 },
    ];
    const serie = serieCbprem(klinesCb, klinesBn);
    expect(serie.map((p) => p.t)).toEqual([1_000, 3_000]);
    // t=1000 : (101-100)/100*100 = 1
    expect(serie[0]?.premiumPct).toBeCloseTo(1, 9);
    // t=3000 : (301-300)/300*100 = 0.3333...
    expect(serie[1]?.premiumPct).toBeCloseTo((1 / 300) * 100, 9);
  });

  it("calcule le premium avec le signe exact : positif si cb>bn, négatif si cb<bn", () => {
    const klinesCb = [
      { t: 1_000, close: 110 }, // cb au-dessus de bn
      { t: 2_000, close: 90 }, // cb en-dessous de bn
    ];
    const klinesBn = [
      { t: 1_000, close: 100 },
      { t: 2_000, close: 100 },
    ];
    const serie = serieCbprem(klinesCb, klinesBn);
    expect(serie).toEqual([
      { t: 1_000, premiumPct: 10 },
      { t: 2_000, premiumPct: -10 },
    ]);
  });

  it("omet les points où bn<=0 ou une close est non finie (NaN/Infinity)", () => {
    const klinesCb = [
      { t: 1, close: 100 }, // bn=0 → exclu
      { t: 2, close: 100 }, // bn négatif → exclu
      { t: 3, close: NaN }, // cb non fini → exclu
      { t: 4, close: 100 }, // bn=Infinity → exclu (non fini)
      { t: 5, close: 100 }, // seul point valide
    ];
    const klinesBn = [
      { t: 1, close: 0 },
      { t: 2, close: -5 },
      { t: 3, close: 100 },
      { t: 4, close: Infinity },
      { t: 5, close: 100 },
    ];
    const serie = serieCbprem(klinesCb, klinesBn);
    expect(serie).toEqual([{ t: 5, premiumPct: 0 }]);
    // Jamais de NaN en sortie même sur des entrées volontairement invalides.
    for (const p of serie) expect(Number.isFinite(p.premiumPct)).toBe(true);
  });

  it("entrées vides ou totalement disjointes → série vide", () => {
    expect(serieCbprem([], [])).toEqual([]);
    expect(serieCbprem([{ t: 1, close: 100 }], [{ t: 2, close: 100 }])).toEqual([]);
  });
});

describe("serieCbpremAjustee — premium neutralisé du peg USDT (doc 02 § B7)", () => {
  it("k = 1 partout ⇒ sortie IDENTIQUE à serieCbprem (mêmes points, mêmes valeurs, même ordre)", () => {
    // Mêmes entrées scramblées que le premier test de serieCbprem ; USDT/USD à 1 sur
    // tous les openTime (y compris ceux sans contrepartie) : l'ajustement est neutre.
    const klinesCb = [
      { t: 3_000, close: 301 },
      { t: 9_999, close: 999 },
      { t: 1_000, close: 101 },
    ];
    const klinesBn = [
      { t: 2_000, close: 200 },
      { t: 3_000, close: 300 },
      { t: 1_000, close: 100 },
    ];
    const klinesUsdt = [
      { t: 9_999, close: 1 },
      { t: 3_000, close: 1 },
      { t: 2_000, close: 1 },
      { t: 1_000, close: 1 },
    ];
    expect(serieCbpremAjustee(klinesCb, klinesBn, klinesUsdt)).toEqual(serieCbprem(klinesCb, klinesBn));
  });

  it("convertit la jambe Binance en USD : premium = (cb − bn·k) / (bn·k) × 100 ; point sans k OMIS", () => {
    const klinesCb = [
      { t: 1_000, close: 101 },
      { t: 2_000, close: 101 }, // pas de k à t=2000 → exclu (pas d'interpolation)
      { t: 3_000, close: 99.8 },
    ];
    const klinesBn = [
      { t: 1_000, close: 100 },
      { t: 2_000, close: 100 },
      { t: 3_000, close: 100 },
    ];
    const klinesUsdt = [
      { t: 1_000, close: 0.998 },
      { t: 3_000, close: 0.998 },
    ];
    const serie = serieCbpremAjustee(klinesCb, klinesBn, klinesUsdt);
    expect(serie.map((p) => p.t)).toEqual([1_000, 3_000]);
    // t=1000 : bn·k = 99.8 ; (101 − 99.8) / 99.8 × 100 = 120 / 99.8 = 1.2024048096192384.
    // (Le brut donnerait 1 % : le peg à −0,2 % gonfle bien le premium ajusté.)
    expect(serie[0]?.premiumPct).toBeCloseTo(1.2024048096192384, 9);
    // t=3000 : cb = bn·k exactement → premium nul une fois le peg neutralisé.
    expect(serie[1]?.premiumPct).toBeCloseTo(0, 9);
  });

  it("omet les points où k ≤ 0 ou n'est pas fini (NaN/Infinity), mêmes gardes cb/bn que serieCbprem", () => {
    const klinesCb = [
      { t: 1, close: 100 }, // k=0 → exclu
      { t: 2, close: 100 }, // k négatif → exclu
      { t: 3, close: 100 }, // k=NaN → exclu
      { t: 4, close: 100 }, // k=Infinity → exclu
      { t: 5, close: 100 }, // bn=0 → exclu (garde héritée)
      { t: 6, close: NaN }, // cb non fini → exclu (garde héritée)
      { t: 7, close: 100 }, // seul point valide
    ];
    const klinesBn = [
      { t: 1, close: 100 },
      { t: 2, close: 100 },
      { t: 3, close: 100 },
      { t: 4, close: 100 },
      { t: 5, close: 0 },
      { t: 6, close: 100 },
      { t: 7, close: 100 },
    ];
    const klinesUsdt = [
      { t: 1, close: 0 },
      { t: 2, close: -1 },
      { t: 3, close: NaN },
      { t: 4, close: Infinity },
      { t: 5, close: 1 },
      { t: 6, close: 1 },
      { t: 7, close: 1 },
    ];
    const serie = serieCbpremAjustee(klinesCb, klinesBn, klinesUsdt);
    expect(serie).toEqual([{ t: 7, premiumPct: 0 }]);
    for (const p of serie) expect(Number.isFinite(p.premiumPct)).toBe(true);
  });

  it("entrées vides ou sans openTime commun aux TROIS séries → série vide", () => {
    expect(serieCbpremAjustee([], [], [])).toEqual([]);
    expect(
      serieCbpremAjustee([{ t: 1, close: 100 }], [{ t: 1, close: 100 }], [{ t: 2, close: 1 }]),
    ).toEqual([]);
  });
});

describe("ecartPegDernierPoint — écart de peg USDT/USD au dernier point aligné", () => {
  it("(k − 1) × 100 avec k = close USDT/USD à l'openTime du DERNIER point de la série", () => {
    const serie: PointPremium[] = [
      { t: 1_000, premiumPct: 0.5 },
      { t: 2_000, premiumPct: 0.4 },
    ];
    const klinesUsdt = [
      { t: 1_000, close: 1.001 }, // pas le dernier → ignoré
      { t: 2_000, close: 0.998 }, // dernier : (0.998 − 1) × 100 = −0.2
    ];
    expect(ecartPegDernierPoint(serie, klinesUsdt)).toBeCloseTo(-0.2, 9);
  });

  it("openTime USDT dupliqué : la DERNIÈRE close l'emporte, comme dans serieCbpremAjustee (Map.set)", () => {
    // Jamais observé chez Kraken, mais les deux fonctions doivent lire le MÊME k : la série
    // ajustée retient la dernière close par t (Map.set), l'écart affiché doit en faire autant.
    const klinesUsdt = [
      { t: 2_000, close: 1.001 }, // doublon écrasé
      { t: 2_000, close: 0.998 }, // dernière close → k retenu
    ];
    const serie = serieCbpremAjustee([{ t: 2_000, close: 100 }], [{ t: 2_000, close: 100 }], klinesUsdt);
    // bn·k = 99.8 : (100 − 99.8) / 99.8 × 100 = 0.2004008016032064 (k = 0.998, pas 1.001).
    expect(serie[0]?.premiumPct).toBeCloseTo(0.2004008016032064, 9);
    expect(ecartPegDernierPoint(serie, klinesUsdt)).toBeCloseTo(-0.2, 9);
  });

  it("null si la série est vide ou si aucune close USDT n'existe à l'openTime du dernier point", () => {
    expect(ecartPegDernierPoint([], [{ t: 1_000, close: 1 }])).toBeNull();
    expect(ecartPegDernierPoint([{ t: 2_000, premiumPct: 0 }], [{ t: 1_000, close: 1 }])).toBeNull();
  });
});

describe("statsPremium", () => {
  it("série vide → tout à null", () => {
    expect(statsPremium([])).toEqual({ courant: null, moyenne7j: null, z30j: null });
  });

  it("courant = dernier point de la série (déjà triée chrono)", () => {
    const serie: PointPremium[] = [
      { t: 1, premiumPct: 1 },
      { t: 2, premiumPct: 2 },
      { t: 3, premiumPct: 5 },
    ];
    expect(statsPremium(serie).courant).toBe(5);
  });

  it("moyenne7j = moyenne des points dans les 7 jours du DERNIER point (t relatif, pas 'maintenant')", () => {
    // 11 points espacés d'1 jour, t=0..10j, valeur = son index k (0..10).
    // Dernier point : k=10 (t=10j). Fenêtre = [10j-7j, 10j] = [3j, 10j] → k=3..10
    // (8 points, borne basse INCLUSE) : somme=3+4+..+10=52, moyenne=52/8=6.5.
    const serie: PointPremium[] = Array.from({ length: 11 }, (_, k) => ({
      t: k * JOUR_MS,
      premiumPct: k,
    }));
    const stats = statsPremium(serie);
    expect(stats.courant).toBe(10);
    expect(stats.moyenne7j).toBeCloseTo(6.5, 9);
  });

  it("z30j = null si moins de 30 points", () => {
    const serie: PointPremium[] = Array.from({ length: 29 }, (_, k) => ({
      t: k,
      premiumPct: k,
    }));
    expect(statsPremium(serie).z30j).toBeNull();
  });

  it("z30j = null si l'écart-type est nul (série constante), même avec >=30 points", () => {
    const serie: PointPremium[] = Array.from({ length: 30 }, (_, k) => ({
      t: k,
      premiumPct: 3.5,
    }));
    expect(statsPremium(serie).z30j).toBeNull();
  });

  it("z30j = z-score du courant vs toute la série (stdev POPULATION), exact à 30 points", () => {
    // Série 1..30 (30 points, valeur = son rang). Population : moyenne=15.5,
    // variance=(30²-1)/12=74.91666..., stdev=8.65544144839919.
    // Courant = dernier = 30 → z=(30-15.5)/8.65544144839919 = 1.6752467319482305.
    const serie: PointPremium[] = Array.from({ length: 30 }, (_, k) => ({
      t: k,
      premiumPct: k + 1,
    }));
    const stats = statsPremium(serie);
    expect(stats.courant).toBe(30);
    expect(stats.z30j).toBeCloseTo(1.6752467319482305, 9);
  });
});

describe("bandesPremium — moyenne / écart-type population de toute la série", () => {
  it("moins de 30 points → null", () => {
    const serie: PointPremium[] = Array.from({ length: 29 }, (_, k) => ({
      t: k,
      premiumPct: k,
    }));
    expect(bandesPremium(serie)).toBeNull();
  });

  it("écart-type nul (série constante) → null, même avec >=30 points", () => {
    const serie: PointPremium[] = Array.from({ length: 30 }, (_, k) => ({
      t: k,
      premiumPct: 3.5,
    }));
    expect(bandesPremium(serie)).toBeNull();
  });

  it("moyenne et σ population exacts sur 30 points (série 1..30)", () => {
    // Mêmes valeurs consacrées que le test z30j : moyenne=15.5,
    // stdev POPULATION = 8.65544144839919.
    const serie: PointPremium[] = Array.from({ length: 30 }, (_, k) => ({
      t: k,
      premiumPct: k + 1,
    }));
    const bandes = bandesPremium(serie);
    expect(bandes?.moyenne).toBeCloseTo(15.5, 9);
    expect(bandes?.sigma).toBeCloseTo(8.65544144839919, 9);
  });
});

describe("zPoint — z-score d'un premium vs des bandes", () => {
  it("z exact : (p − moyenne) / σ", () => {
    const bandes = { moyenne: 15.5, sigma: 8.65544144839919 };
    // Cohérent avec z30j de la série 1..30 : zPoint(30) = 1.6752467319482305.
    expect(zPoint(30, bandes)).toBeCloseTo(1.6752467319482305, 9);
    // La moyenne elle-même a un z de 0.
    expect(zPoint(15.5, bandes)).toBeCloseTo(0, 9);
    // Signe négatif si p < moyenne.
    expect(zPoint(15.5 - 8.65544144839919, bandes)).toBeCloseTo(-1, 9);
  });
});
