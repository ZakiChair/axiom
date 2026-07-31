/**
 * Tests de la logique PURE de corrélation (data/corr.ts). Chaque valeur attendue est
 * calculée À LA MAIN et justifiée en commentaire (pas d'oracle « circulaire »).
 */
import { describe, expect, it } from "vitest";
import {
  alignerSeries,
  calculerMatrice,
  correlation,
  correlationGlissante,
  exclureJourCourant,
  fenetrer,
  FENETRES_CORR,
  filtrerPairesExtremes,
  hydraterReglagesCorr,
  listerPaires,
  logRendements,
  ordonnerMatrice,
  ordonnerParSimilarite,
  pearson,
  pointsFiables,
  REFERENCES_CORR,
  SEUIL_POINTS_FIABLES,
  spearman,
  STABLECOINS_EXCLUS,
  symbolesEnEchec,
  topPairesUnivers,
  type CelluleCorr,
  type MatriceCorr,
  type PaireCorr,
  type SerieCloture,
} from "./corr";

const JOUR = 86_400_000;
/** Horodatage (ms) du jour calendaire UTC n° `n` (bucket = n). */
const j = (n: number): number => n * JOUR;

describe("logRendements", () => {
  it("calcule ln(cur/prev) par pas, longueur n-1", () => {
    // closes = [100, 110, 121] → r1 = ln(1.1), r2 = ln(1.1) = 0.0953101798...
    const r = logRendements([100, 110, 121]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.09531018, 8);
    expect(r[1]).toBeCloseTo(0.09531018, 8);
  });

  it("produit NaN sur une clôture ≤ 0 (donnée douteuse)", () => {
    const r = logRendements([100, 0, 120]);
    expect(Number.isNaN(r[0])).toBe(true); // ln(0/100) indéfini → NaN
    expect(Number.isNaN(r[1])).toBe(true); // prev = 0 → NaN
  });
});

describe("pearson", () => {
  it("vaut 1 pour une relation affine croissante", () => {
    // ys = 2*xs → corrélation linéaire parfaite = 1
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
  });

  it("vaut -1 pour une relation affine décroissante", () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
  });

  it("retrouve une valeur connue calculée à la main", () => {
    // xs=[1,2,3,4,5], ys=[2,4,5,4,5]. mx=3, my=4.
    // dx=[-2,-1,0,1,2], dy=[-2,0,1,0,1]
    // cov = 4+0+0+0+2 = 6 ; vx = 4+1+0+1+4 = 10 ; vy = 4+0+1+0+1 = 6
    // r = 6 / sqrt(10*6) = 6 / sqrt(60) = 0.7745966692...
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])).toBeCloseTo(0.77459667, 8);
  });

  it("renvoie null si série constante (variance nulle) ou < 2 couples", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull(); // vx = 0
    expect(pearson([1], [2])).toBeNull(); // 1 seul couple
  });

  it("ignore les couples non finis (suppression par paire)", () => {
    // Le couple NaN est retiré ; reste [1,2,3]×[2,4,6] → r = 1
    expect(pearson([1, 2, NaN, 3], [2, 4, 9, 6])).toBeCloseTo(1, 12);
  });
});

describe("spearman", () => {
  it("vaut 1 pour une relation monotone NON linéaire (là où Pearson < 1)", () => {
    // ys = xs^2, strictement croissant → rangs identiques → Spearman = 1
    const xs = [1, 2, 3, 4];
    const ys = [1, 4, 9, 16];
    expect(spearman(xs, ys)).toBeCloseTo(1, 12);
    expect(pearson(xs, ys)).toBeLessThan(1); // Pearson pénalise la courbure
  });

  it("gère les ex-aequo par rangs moyens (valeur connue)", () => {
    // xs=[1,2,2,3] → rangs [1, 2.5, 2.5, 4] ; ys=[1,2,3,4] → rangs [1,2,3,4]
    // pearson(rx, ry) : mrx=mry=2.5
    // dx=[-1.5,0,0,1.5], dy=[-1.5,-0.5,0.5,1.5]
    // cov = 2.25+0+0+2.25 = 4.5 ; vx = 4.5 ; vy = 2.25+0.25+0.25+2.25 = 5
    // r = 4.5 / sqrt(4.5*5) = 4.5 / sqrt(22.5) = 0.9486832981...
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9486833, 7);
  });
});

describe("alignerSeries", () => {
  it("ne garde que les jours calendaires UTC communs, en ordre chronologique", () => {
    const a: SerieCloture[] = [
      { time: j(0), close: 1 },
      { time: j(1), close: 2 },
      { time: j(2), close: 3 },
      { time: j(3), close: 4 },
    ];
    const b: SerieCloture[] = [
      { time: j(1), close: 10 },
      { time: j(3), close: 30 },
      { time: j(5), close: 50 },
    ];
    // jours communs = {1, 3} → a=[2,4], b=[10,30]
    expect(alignerSeries(a, b)).toEqual({ a: [2, 4], b: [10, 30] });
  });

  it("réduit deux bougies du même jour UTC à la dernière clôture rencontrée", () => {
    const a: SerieCloture[] = [
      { time: j(1), close: 2 },
      { time: j(1) + 3600_000, close: 22 }, // même jour 1 (une heure plus tard) → 22 gagne
    ];
    const b: SerieCloture[] = [{ time: j(1), close: 10 }];
    expect(alignerSeries(a, b)).toEqual({ a: [22], b: [10] });
  });
});

describe("fenetrer", () => {
  it("garde les jours dans la fenêtre relative à la dernière bougie", () => {
    const serie: SerieCloture[] = Array.from({ length: 10 }, (_, i) => ({ time: j(i), close: i }));
    // dernier = j(9) ; fenêtre 3 j → seuil = j(6) ; on garde les jours 6,7,8,9 = 4 points
    const f = fenetrer(serie, 3);
    expect(f.map((p) => p.time)).toEqual([j(6), j(7), j(8), j(9)]);
  });

  it("renvoie la série telle quelle si vide", () => {
    expect(fenetrer([], 30)).toEqual([]);
  });
});

describe("correlationGlissante", () => {
  it("produit une valeur par fenêtre complète (longueur n-fenetre+1)", () => {
    // 5 rendements, fenêtre 3 → 3 fenêtres, chacune parfaitement corrélée → [1,1,1]
    const xs = [0.1, 0.2, -0.1, 0.05, -0.2];
    const ys = xs.map((v) => 2 * v); // affine → corrélation 1 sur chaque fenêtre
    const g = correlationGlissante("pearson", xs, ys, 3);
    expect(g).toHaveLength(3);
    for (const v of g) expect(v).toBeCloseTo(1, 12);
  });

  it("renvoie [] si l'historique est plus court que la fenêtre", () => {
    expect(correlationGlissante("pearson", [0.1, 0.2], [0.1, 0.2], 30)).toEqual([]);
  });
});

describe("calculerMatrice", () => {
  it("diagonale = 1, symétrie, et corrélation parfaite entre deux séries co-évoluant", () => {
    // A et B multiplient leur clôture par 1.1 chaque jour → log-rendements identiques → r = 1
    const a: SerieCloture[] = [
      { time: j(0), close: 100 },
      { time: j(1), close: 110 },
      { time: j(2), close: 121 },
      { time: j(3), close: 133.1 },
    ];
    const b: SerieCloture[] = [
      { time: j(0), close: 50 },
      { time: j(1), close: 55 },
      { time: j(2), close: 60.5 },
      { time: j(3), close: 66.55 },
    ];
    const map = new Map<string, SerieCloture[]>([
      ["A", a],
      ["B", b],
    ]);
    const m = calculerMatrice(map, ["A", "B"], "pearson", 180);
    expect(m.cellules[0]?.[0]?.valeur).toBe(1); // diagonale
    expect(m.cellules[1]?.[1]?.valeur).toBe(1);
    expect(m.cellules[0]?.[1]?.valeur).toBeCloseTo(1, 12);
    expect(m.cellules[1]?.[0]?.valeur).toBeCloseTo(1, 12); // symétrique
    expect(m.cellules[0]?.[1]?.points).toBe(3); // 4 clôtures communes → 3 rendements
  });

  it("cellule nulle pour un symbole sans série", () => {
    const map = new Map<string, SerieCloture[]>([["A", [{ time: j(0), close: 1 }]]]);
    const m = calculerMatrice(map, ["A", "B"], "pearson", 180);
    expect(m.cellules[0]?.[1]?.valeur).toBeNull(); // B absent → pas de corrélation
    expect(m.cellules[1]?.[1]?.valeur).toBeNull(); // diagonale B : aucune donnée
  });
});

describe("correlation (aiguillage)", () => {
  it("délègue à pearson ou spearman selon la méthode", () => {
    const xs = [1, 2, 3, 4];
    const ys = [1, 4, 9, 16];
    expect(correlation("pearson", xs, ys)).toBe(pearson(xs, ys));
    expect(correlation("spearman", xs, ys)).toBe(spearman(xs, ys));
  });
});

describe("exclureJourCourant", () => {
  it("écarte le(s) point(s) du jour calendaire UTC courant (bougie partielle)", () => {
    const serie: SerieCloture[] = [
      { time: j(8), close: 1 },
      { time: j(9), close: 2 },
      { time: j(9) + 3 * 3600_000, close: 3 }, // même jour 9, plus tard
    ];
    // now = milieu du jour 9 → les deux points du jour 9 sont écartés
    expect(exclureJourCourant(serie, j(9) + 12 * 3600_000)).toEqual([{ time: j(8), close: 1 }]);
  });

  it("ne touche pas une série entièrement antérieure au jour courant", () => {
    const serie: SerieCloture[] = [
      { time: j(3), close: 1 },
      { time: j(4), close: 2 },
    ];
    expect(exclureJourCourant(serie, j(12))).toEqual(serie);
  });

  it("écarte aussi un point postérieur au jour courant (horloge en avance)", () => {
    const serie: SerieCloture[] = [
      { time: j(5), close: 1 },
      { time: j(7), close: 2 },
    ];
    expect(exclureJourCourant(serie, j(6))).toEqual([{ time: j(5), close: 1 }]);
  });

  it("série vide → vide", () => {
    expect(exclureJourCourant([], j(1))).toEqual([]);
  });
});

describe("pointsFiables", () => {
  it("seuil de fiabilité = 20 rendements communs", () => {
    expect(SEUIL_POINTS_FIABLES).toBe(20);
    expect(pointsFiables(19)).toBe(false);
    expect(pointsFiables(20)).toBe(true);
    expect(pointsFiables(0)).toBe(false);
  });
});

describe("symbolesEnEchec", () => {
  it("signale les symboles à série vide ou absente (série vide = échec de chargement)", () => {
    const map = new Map<string, SerieCloture[]>([
      ["BTCUSDT", [{ time: j(0), close: 1 }]],
      ["SPY", []], // chargé mais vide → échec
    ]);
    // GLD absent de la map → échec aussi ; l'ordre d'entrée est conservé
    expect(symbolesEnEchec(map, ["BTCUSDT", "SPY", "GLD"])).toEqual(["SPY", "GLD"]);
  });

  it("renvoie [] quand toutes les séries sont non vides", () => {
    const map = new Map<string, SerieCloture[]>([["A", [{ time: j(0), close: 1 }]]]);
    expect(symbolesEnEchec(map, ["A"])).toEqual([]);
  });
});

describe("REFERENCES_CORR", () => {
  it("expose les 6 références curées (proxys étiquetés), symboles uniques", () => {
    const symboles = REFERENCES_CORR.map((r) => r.symbole);
    expect(symboles).toEqual(["SPY", "QQQ", "GLD", "UUP", "EUR/USD", "USD/JPY"]);
    expect(new Set(symboles).size).toBe(REFERENCES_CORR.length);
    for (const r of REFERENCES_CORR) expect(r.libelle.length).toBeGreaterThan(0);
  });
});

describe("hydraterReglagesCorr", () => {
  it("renvoie les défauts sur entrée absente ou non-objet, sans jeter", () => {
    const defauts = hydraterReglagesCorr(undefined);
    expect(defauts).toEqual({
      methode: "pearson",
      fenetreJours: 90,
      extras: [],
      referencesActives: [],
      univers: "watchlist",
      tri: "watchlist",
      onglet: "matrice",
    });
    expect(hydraterReglagesCorr(null)).toEqual(defauts);
    expect(hydraterReglagesCorr("n'importe quoi")).toEqual(defauts);
    expect(hydraterReglagesCorr(42)).toEqual(defauts);
    expect(hydraterReglagesCorr([])).toEqual(defauts);
  });

  it("rétro-compatible : un localStorage v2.6 sans univers/tri/onglet hérite des défauts", () => {
    const h = hydraterReglagesCorr({
      methode: "spearman",
      fenetreJours: 30,
      extras: ["AVAXUSDT"],
      referencesActives: ["SPY"],
    });
    expect(h.methode).toBe("spearman"); // les champs v2.6 survivent
    expect(h.univers).toBe("watchlist");
    expect(h.tri).toBe("watchlist");
    expect(h.onglet).toBe("matrice");
  });

  it("accepte univers/tri/onglet valides, remplace les inconnus par leurs défauts", () => {
    const valides = hydraterReglagesCorr({ univers: "top20", tri: "similarite", onglet: "paires" });
    expect(valides.univers).toBe("top20");
    expect(valides.tri).toBe("similarite");
    expect(valides.onglet).toBe("paires");
    const invalides = hydraterReglagesCorr({ univers: "top50", tri: "corr", onglet: "liste" });
    expect(invalides.univers).toBe("watchlist");
    expect(invalides.tri).toBe("watchlist");
    expect(invalides.onglet).toBe("matrice");
  });

  it("accepte un état valide champ par champ (extras normalisés trim+MAJUSCULES)", () => {
    const h = hydraterReglagesCorr({
      methode: "spearman",
      fenetreJours: 30,
      extras: ["avaxusdt", " spy "],
      referencesActives: ["GLD", "EUR/USD"],
    });
    expect(h.methode).toBe("spearman");
    expect(h.fenetreJours).toBe(30);
    expect(h.extras).toEqual(["AVAXUSDT", "SPY"]);
    expect(h.referencesActives).toEqual(["GLD", "EUR/USD"]);
  });

  it("remplace chaque champ invalide par son défaut, indépendamment des autres", () => {
    const h = hydraterReglagesCorr({
      methode: "kendall", // méthode inconnue → défaut
      fenetreJours: 45, // hors FENETRES_CORR → défaut
      extras: "SPY", // pas un tableau → défaut
      referencesActives: [12, "INCONNU", "UUP"], // seules les références du catalogue survivent
    });
    expect(h.methode).toBe("pearson");
    expect(h.fenetreJours).toBe(90);
    expect(h.extras).toEqual([]);
    expect(h.referencesActives).toEqual(["UUP"]);
  });

  it("dédoublonne extras et références, écarte les entrées vides", () => {
    const h = hydraterReglagesCorr({
      extras: ["SPY", "spy", "", "  ", 7],
      referencesActives: ["GLD", "GLD"],
    });
    expect(h.extras).toEqual(["SPY"]);
    expect(h.referencesActives).toEqual(["GLD"]);
  });

  it("chaque fenêtre proposée par l'UI est acceptée telle quelle", () => {
    for (const f of FENETRES_CORR) {
      expect(hydraterReglagesCorr({ fenetreJours: f }).fenetreJours).toBe(f);
    }
  });
});

describe("FENETRES_CORR", () => {
  it("propose 7, 30, 90 et 180 jours (7 j ajouté par CORR v2, MAX_JOURS inchangé)", () => {
    expect(FENETRES_CORR).toEqual([7, 30, 90, 180]);
  });
});

describe("topPairesUnivers", () => {
  const catalogue = [
    { symbol: "ETH", mcapUsd: 800 },
    { symbol: "BTC", mcapUsd: 1000 }, // désordre volontaire : le tri par cap est à la charge de la fonction
    { symbol: "USDT", mcapUsd: 900 }, // stablecoin → exclu
    { symbol: "eth", mcapUsd: 700 }, // doublon de paire (trim + MAJUSCULES) → écarté
    { symbol: "USDC", mcapUsd: 600 }, // stablecoin → exclu
    { symbol: "SOL", mcapUsd: 500 },
    { symbol: "XRP", mcapUsd: 400 },
  ];

  it("prend le top N par capitalisation, stablecoins exclus, en paires Binance USDT", () => {
    expect(topPairesUnivers(catalogue, 3)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  });

  it("renvoie tous les éligibles si N dépasse le catalogue, [] sur catalogue vide", () => {
    expect(topPairesUnivers(catalogue, 30)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]);
    expect(topPairesUnivers([], 10)).toEqual([]);
  });

  it("la liste d'exclusion couvre les stablecoins majeurs, pas les jetons adossés à l'or", () => {
    for (const s of ["USDT", "USDC", "DAI", "USDE", "FDUSD", "TUSD", "USDD", "PYUSD", "USDS"]) {
      expect(STABLECOINS_EXCLUS.has(s)).toBe(true);
    }
    expect(STABLECOINS_EXCLUS.has("BTC")).toBe(false);
    expect(STABLECOINS_EXCLUS.has("PAXG")).toBe(false);
  });
});

/** Matrice synthétique : cellules à points constants (30), valeurs fournies ligne à ligne. */
function matriceDe(symbols: string[], vals: (number | null)[][]): MatriceCorr {
  return {
    symbols,
    methode: "pearson",
    fenetreJours: 90,
    cellules: vals.map((ligne) => ligne.map((v) => ({ valeur: v, points: 30 }))),
  };
}

describe("ordonnerParSimilarite", () => {
  it("regroupe deux blocs corrélés entrelacés en deux blocs CONTIGUS (critère de succès)", () => {
    // Blocs {A,B} (r = 0,75) et {C,D} (r = 0,875), croisements à 0,25, ordre d'entrée
    // ENTRELACÉ [A, C, B, D]. Valeurs EXACTES en binaire (0,25/0,75/0,875) : les sommes
    // sont exactes quel que soit l'ordre d'addition, l'égalité C/D est donc réelle et
    // tranchée par le plus petit index. Moyennes absolues hors diagonale :
    //   A = (0,25+0,75+0,25)/3 ≈ 0,417 ; C = D = (0,25+0,25+0,875)/3 ≈ 0,458 → départ C.
    // Depuis C : plus proche voisin D (0,875) → puis A (égalité 0,25/0,25, plus petit
    // index) → puis B. Ordre attendu : [C, D, A, B] = indices [1, 3, 0, 2].
    const m = matriceDe(
      ["A", "C", "B", "D"],
      [
        [1, 0.25, 0.75, 0.25],
        [0.25, 1, 0.25, 0.875],
        [0.75, 0.25, 1, 0.25],
        [0.25, 0.875, 0.25, 1],
      ]
    );
    const ordre = ordonnerParSimilarite(m);
    expect(ordre).toEqual([1, 3, 0, 2]);
    const symbolesOrdonnes = ordre.map((i) => m.symbols[i]);
    // Contiguïté des blocs : {C,D} adjacents ET {A,B} adjacents.
    expect(Math.abs(symbolesOrdonnes.indexOf("C") - symbolesOrdonnes.indexOf("D"))).toBe(1);
    expect(Math.abs(symbolesOrdonnes.indexOf("A") - symbolesOrdonnes.indexOf("B"))).toBe(1);
  });

  it("traite les cellules null comme 0 (aucune affinité connue)", () => {
    // Moyennes absolues : A = (0,8+0)/2 = 0,4 ; B = (0,8+0,5)/2 = 0,65 (départ) ;
    // C = (0+0,5)/2 = 0,25. Depuis B : A (0,8) puis C. Ordre = [1, 0, 2].
    const m = matriceDe(
      ["A", "B", "C"],
      [
        [1, 0.8, null],
        [0.8, 1, 0.5],
        [null, 0.5, 1],
      ]
    );
    expect(ordonnerParSimilarite(m)).toEqual([1, 0, 2]);
  });

  it("matrice vide → [], singleton → [0]", () => {
    expect(ordonnerParSimilarite(matriceDe([], []))).toEqual([]);
    expect(ordonnerParSimilarite(matriceDe(["A"], [[1]]))).toEqual([0]);
  });
});

describe("ordonnerMatrice", () => {
  it("tri « watchlist » : renvoie la matrice TELLE QUELLE (même référence)", () => {
    const m = matriceDe(["B", "A"], [[1, 0.5], [0.5, 1]]);
    expect(ordonnerMatrice(m, "watchlist")).toBe(m);
  });

  it("tri « alpha » : symboles triés, cellules permutées de façon cohérente", () => {
    // Points distincts par cellule pour tracer la permutation.
    const cel = (valeur: number | null, points: number): CelluleCorr => ({ valeur, points });
    const m: MatriceCorr = {
      symbols: ["B", "A"],
      methode: "pearson",
      fenetreJours: 90,
      cellules: [
        [cel(1, 2), cel(0.5, 7)],
        [cel(0.5, 7), cel(1, 3)],
      ],
    };
    const o = ordonnerMatrice(m, "alpha");
    expect(o.symbols).toEqual(["A", "B"]);
    expect(o.cellules[0]?.[0]).toEqual(cel(1, 3)); // diagonale de A suit A
    expect(o.cellules[0]?.[1]).toEqual(cel(0.5, 7)); // cellule croisée conservée
    expect(m.symbols).toEqual(["B", "A"]); // l'entrée n'est pas mutée
  });

  it("tri « similarite » : applique l'ordre glouton aux symboles ET aux cellules", () => {
    // Mêmes valeurs exactes en binaire que le cas « deux blocs » ci-dessus.
    const m = matriceDe(
      ["A", "C", "B", "D"],
      [
        [1, 0.25, 0.75, 0.25],
        [0.25, 1, 0.25, 0.875],
        [0.75, 0.25, 1, 0.25],
        [0.25, 0.875, 0.25, 1],
      ]
    );
    const o = ordonnerMatrice(m, "similarite");
    expect(o.symbols).toEqual(["C", "D", "A", "B"]);
    expect(o.cellules[0]?.[1]?.valeur).toBe(0.875); // C×D en tête de bloc
    expect(o.cellules[2]?.[3]?.valeur).toBe(0.75); // A×B dans le second bloc
  });
});

describe("listerPaires", () => {
  it("liste le triangle supérieur (hors diagonale, A–B ≡ B–A une seule fois)", () => {
    const m = matriceDe(
      ["X", "Y", "Z"],
      [
        [1, 0.4, null],
        [0.4, 1, -0.2],
        [null, -0.2, 1],
      ]
    );
    expect(listerPaires(m)).toEqual([
      { a: "X", b: "Y", valeur: 0.4, points: 30 },
      { a: "X", b: "Z", valeur: null, points: 30 },
      { a: "Y", b: "Z", valeur: -0.2, points: 30 },
    ]);
  });

  it("matrice vide ou singleton → aucune paire", () => {
    expect(listerPaires(matriceDe([], []))).toEqual([]);
    expect(listerPaires(matriceDe(["A"], [[1]]))).toEqual([]);
  });
});

describe("filtrerPairesExtremes", () => {
  const paires: PaireCorr[] = [
    { a: "A", b: "B", valeur: 0.9, points: 30 },
    { a: "A", b: "C", valeur: 0.5, points: 30 },
    { a: "B", b: "C", valeur: null, points: 0 }, // sans valeur → jamais retenue
    { a: "C", b: "D", valeur: -0.3, points: 30 },
  ];

  it("« plus » : les nb corrélations les plus hautes, extrême en tête", () => {
    expect(filtrerPairesExtremes(paires, "plus", 2).map((p) => p.valeur)).toEqual([0.9, 0.5]);
  });

  it("« moins » : les nb corrélations les plus basses, extrême en tête", () => {
    expect(filtrerPairesExtremes(paires, "moins", 2).map((p) => p.valeur)).toEqual([-0.3, 0.5]);
  });

  it("écarte les paires sans valeur même si nb dépasse l'effectif", () => {
    expect(filtrerPairesExtremes(paires, "plus", 10)).toHaveLength(3);
  });
});
