/**
 * Tests des fonctions PURES du premium Coinbase/Binance : alignement des deux
 * séries de klines par openTime, calcul du premium signé, stats dérivées.
 * Les valeurs attendues sont justifiées en commentaire.
 */
import { describe, it, expect } from "vitest";
import {
  bandeGlissante,
  bandesGlissantes,
  ecartPegDernierPoint,
  FENETRE_Z_MS,
  MIN_POINTS_Z,
  serieCbprem,
  serieCbpremAjustee,
  statsPremium,
  zPoint,
  type PointPremium,
} from "./cbprem";

const HEURE_MS = 3_600_000;
const JOUR_MS = 24 * HEURE_MS;

/** Série horaire t = k h, valeur fournie par `valeur(k)`. */
function serieHoraire(longueur: number, valeur: (k: number) => number): PointPremium[] {
  return Array.from({ length: longueur }, (_, k) => ({ t: k * HEURE_MS, premiumPct: valeur(k) }));
}

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
    expect(statsPremium([])).toEqual({ courant: null, moyenne7j: null, zGlissant7j: null });
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

  it("zGlissant7j = null sur une série courte (moins de MIN_POINTS_Z points)", () => {
    expect(MIN_POINTS_Z).toBe(30);
    expect(statsPremium(serieHoraire(29, (k) => k)).zGlissant7j).toBeNull();
  });

  it("zGlissant7j = null si σ est nul (premium constant), même avec ≥ 30 points", () => {
    expect(statsPremium(serieHoraire(30, () => 3.5)).zGlissant7j).toBeNull();
    // 0,1 n'est pas représentable : une moyenne naïve vaut 0,10000000000000005 sur 30 points et
    // laisserait un σ résiduel ≈ 4e-17, donc un z de ±1 fabriqué. Le σ doit être EXACTEMENT nul.
    expect(statsPremium(serieHoraire(30, () => 0.1)).zGlissant7j).toBeNull();
    expect(statsPremium(serieHoraire(168, () => -0.0421)).zGlissant7j).toBeNull();
  });

  it("zGlissant7j exact quand toute la série tient dans 168 h (série 1..30 horaire)", () => {
    // 30 points sur 29 h : la fenêtre du dernier point les contient tous. Population :
    // moyenne = 15.5, σ = √((30² − 1) / 12) = 8.65544144839919 ; z(30) = 1.6752467319482305.
    const stats = statsPremium(serieHoraire(30, (k) => k + 1));
    expect(stats.courant).toBe(30);
    expect(stats.zGlissant7j).toBeCloseTo(1.6752467319482305, 9);
  });

  it("zGlissant7j ne lit que les 168 dernières heures : le passé plus ancien est ignoré", () => {
    // 200 points horaires : k < 32 valent 1e6 (dont k = 31, situé EXACTEMENT à t − 168 h, donc
    // exclu), puis 1..168. Fenêtre du dernier point = k 32..199 = valeurs 1..168 : moyenne = 84.5,
    // σ = √((168² − 1) / 12) = 48.496563452132015, z(168) = 1.7217714835076454. Un seul point
    // à 1e6 dans la fenêtre ferait exploser σ.
    const serie = serieHoraire(200, (k) => (k < 32 ? 1e6 : k - 31));
    expect(statsPremium(serie).zGlissant7j).toBeCloseTo(1.7217714835076454, 9);
  });

  it("zGlissant7j = z du dernier point contre la DERNIÈRE bande du tracé (même source)", () => {
    const serie = serieHoraire(120, (k) => Math.sin(k / 4) + k / 50);
    const derniere = bandesGlissantes(serie).at(-1);
    expect(derniere).not.toBeNull();
    expect(derniere).toBeDefined();
    if (derniere === null || derniere === undefined) return;
    expect(statsPremium(serie).zGlissant7j).toBe(zPoint(serie.at(-1)!.premiumPct, derniere));
  });
});

describe("bandeGlissante / bandesGlissantes — moyenne et σ causaux sur 168 h", () => {
  it("indice hors série → null ; bandesGlissantes garde la longueur et l'ordre de la série", () => {
    const serie = serieHoraire(40, (k) => k % 7);
    expect(bandeGlissante(serie, -1)).toBeNull();
    expect(bandeGlissante(serie, 40)).toBeNull();
    expect(bandeGlissante([], 0)).toBeNull();
    expect(bandesGlissantes([])).toEqual([]);
    expect(bandesGlissantes(serie)).toHaveLength(40);
  });

  it("début de série : indisponible tant que la fenêtre a moins de 30 points, puis n croît jusqu'à 168", () => {
    const bandes = bandesGlissantes(serieHoraire(200, (k) => k % 7));
    for (let i = 0; i < MIN_POINTS_Z - 1; i++) expect(bandes[i]).toBeNull();
    expect(bandes[MIN_POINTS_Z - 1]?.n).toBe(MIN_POINTS_Z);
    expect(bandes[100]?.n).toBe(101);
    expect(FENETRE_Z_MS).toBe(168 * HEURE_MS);
    // i = 168 : t > 0 → k = 1..168 ; le point k = 0, à t − 168 h exactement, est exclu.
    expect(bandes[168]?.n).toBe(168);
    expect(bandes[199]?.n).toBe(168);
  });

  it("moyenne et σ population exacts sur la fenêtre (le point courant inclus)", () => {
    // Même série que le test de statsPremium : fenêtre du dernier point = valeurs 1..168.
    const serie = serieHoraire(200, (k) => (k < 32 ? 1e6 : k - 31));
    const bande = bandeGlissante(serie, 199);
    expect(bande?.n).toBe(168);
    expect(bande?.moyenne).toBeCloseTo(84.5, 9);
    expect(bande?.sigma).toBeCloseTo(48.496563452132015, 9);
  });

  it("trous : la fenêtre est temporelle, un trou la vide au lieu de remonter plus loin", () => {
    // 40 points horaires (k = 0..39), 150 h sans bougie, puis 20 points (t = 190 h..209 h).
    // Fenêtre du dernier point : t > 41 h → seuls les 20 points récents → indisponible,
    // alors que la série compte 60 points.
    const avant = serieHoraire(40, (k) => k % 5);
    const apres = Array.from({ length: 20 }, (_, m) => ({ t: (190 + m) * HEURE_MS, premiumPct: m % 3 }));
    const serie = [...avant, ...apres];
    expect(bandeGlissante(serie, 39)?.n).toBe(40);
    expect(bandeGlissante(serie, serie.length - 1)).toBeNull();
    expect(statsPremium(serie).zGlissant7j).toBeNull();
  });

  it("σ nul : fenêtre constante → null ; dès qu'un point diffère, la bande redevient calculable", () => {
    const serie = serieHoraire(41, (k) => (k < 40 ? 0.1 : 0.2));
    const bandes = bandesGlissantes(serie);
    for (let i = 0; i < 40; i++) expect(bandes[i]).toBeNull();
    // 41 points : 40 × 0,1 et 1 × 0,2 → moyenne = 0.1 + 0.1 / 41, σ = 0.1 × √40 / 41.
    expect(bandes[40]?.moyenne).toBeCloseTo(0.1 + 0.1 / 41, 12);
    expect(bandes[40]?.sigma).toBeCloseTo((0.1 * Math.sqrt(40)) / 41, 12);
  });

  it("causalité par préfixe : ajouter des points ne modifie aucune bande ni aucun z passé", () => {
    // Série irrégulière : oscillations, pics isolés et trous (k multiples de 23, plage 250..289).
    const serie: PointPremium[] = [];
    for (let k = 0; k < 480; k++) {
      if (k % 23 === 0 || (k >= 250 && k < 290)) continue;
      const pic = k % 97 === 0 ? 0.4 : 0;
      serie.push({ t: k * HEURE_MS, premiumPct: 0.05 * Math.sin(k / 5) + 0.02 * Math.cos(k / 17) + pic });
    }
    const complete = bandesGlissantes(serie);
    let disponibles = 0;
    for (let n = 1; n <= serie.length; n++) {
      const prefixe = serie.slice(0, n);
      expect(bandesGlissantes(prefixe)).toEqual(complete.slice(0, n));
      const bande = complete[n - 1] ?? null;
      const attendu = bande === null ? null : zPoint(prefixe[n - 1]!.premiumPct, bande);
      expect(statsPremium(prefixe).zGlissant7j).toBe(attendu);
      if (bande !== null) disponibles++;
    }
    // Le test porte bien sur des bandes calculées, pas seulement sur des null.
    expect(disponibles).toBeGreaterThan(300);
  });

  it("un pic final ne repeint pas le passé : seules la bande et le z du pic le voient", () => {
    const base = serieHoraire(100, (k) => 0.1 + 0.01 * Math.sin(k));
    const avecPic = [...base, { t: 100 * HEURE_MS, premiumPct: 5 }];
    const bandesBase = bandesGlissantes(base);
    const bandesPic = bandesGlissantes(avecPic);
    expect(bandesPic.slice(0, 100)).toEqual(bandesBase);
    // Le pic entre dans sa propre fenêtre (point courant inclus) : z élevé mais borné par √(n − 1).
    const z = statsPremium(avecPic).zGlissant7j;
    expect(z).not.toBeNull();
    expect(z!).toBeGreaterThan(9);
    expect(z!).toBeLessThanOrEqual(Math.sqrt(100) + 1e-9);
  });
});

describe("zPoint — z-score d'un premium vs une bande", () => {
  it("z exact : (p − moyenne) / σ", () => {
    const bande = { moyenne: 15.5, sigma: 8.65544144839919 };
    // Cohérent avec la série 1..30 : zPoint(30) = 1.6752467319482305.
    expect(zPoint(30, bande)).toBeCloseTo(1.6752467319482305, 9);
    // La moyenne elle-même a un z de 0.
    expect(zPoint(15.5, bande)).toBeCloseTo(0, 9);
    // Signe négatif si p < moyenne.
    expect(zPoint(15.5 - 8.65544144839919, bande)).toBeCloseTo(-1, 9);
  });
});
