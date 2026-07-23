/**
 * Tests des utilitaires PURS de projection du radar de squeeze : domaine d'axes
 * (bornes symétriques autour de 0, 0 toujours visible, padding) et projection
 * données→pixels (aller-retour cohérent). Les valeurs attendues sont justifiées.
 */
import { describe, it, expect } from "vitest";
import {
  domaineAxes,
  domaineAxesRobuste,
  estEcrete,
  genTicks,
  placerLabels,
  projeterEnPixels,
  quantile,
  scoreSqueeze,
} from "./squeezeWindow.util";
import { SEUIL_DOI_PCT, SEUIL_FUNDING_PCT } from "../data/squeeze";

/** Vrai si `step` est un pas « rond » de forme 1/2/5×10^k (mantisse ∈ {1,2,5}). */
function estPasRond(step: number): boolean {
  const k = Math.floor(Math.log10(step));
  const mantisse = step / Math.pow(10, k);
  return [1, 2, 5].some((m) => Math.abs(mantisse - m) < 1e-9);
}

/** Point minimal accepté par les utilitaires (seules les deux coordonnées comptent). */
function pt(fundingPct: number, dOiPct: number) {
  return { fundingPct, dOiPct };
}

describe("domaineAxes", () => {
  it("renvoie des demi-étendues strictement positives même sans point (0 visible)", () => {
    const d = domaineAxes([]);
    // Un domaine [-fMax, fMax] avec fMax>0 garantit que x=0 (resp. y=0) est au centre,
    // donc TOUJOURS visible — condition du cahier des charges.
    expect(d.fMax).toBeGreaterThan(0);
    expect(d.oMax).toBeGreaterThan(0);
  });

  it("englobe tous les points sur chaque axe (borne ≥ max |valeur|)", () => {
    const points = [pt(0.05, 12), pt(-0.09, -4), pt(0.02, 20)];
    const d = domaineAxes(points);
    // Le point le plus extrême doit rester DANS le domaine : fMax ≥ |−0.09|, oMax ≥ |20|.
    expect(d.fMax).toBeGreaterThanOrEqual(0.09);
    expect(d.oMax).toBeGreaterThanOrEqual(20);
  });

  it("est symétrique autour de 0 (le domaine renvoie une seule demi-étendue par axe)", () => {
    const d = domaineAxes([pt(0.3, -50)]);
    // La symétrie est structurelle : le domaine est [-fMax, fMax] / [-oMax, oMax].
    // On vérifie que la borne couvre bien la valeur négative comme positive.
    expect(d.fMax).toBeGreaterThanOrEqual(0.3);
    expect(d.oMax).toBeGreaterThanOrEqual(50);
  });

  it("applique un padding : la borne dépasse strictement le point extrême", () => {
    const d = domaineAxes([pt(0.1, 10)]);
    // Padding = marge de respiration pour que les bulles ne collent pas au bord.
    expect(d.fMax).toBeGreaterThan(0.1);
    expect(d.oMax).toBeGreaterThan(10);
  });
});

describe("projeterEnPixels", () => {
  const w = 400;
  const h = 300;
  const pad = 30;

  it("projette (0,0) au centre de la zone de tracé", () => {
    const d = domaineAxes([pt(0.1, 10)]);
    const [p] = projeterEnPixels([pt(0, 0)], d, w, h, pad);
    expect(p!.x).toBeCloseTo(w / 2, 6);
    expect(p!.y).toBeCloseTo(h / 2, 6);
  });

  it("place funding+ à droite / funding− à gauche, ΔOI+ en haut / ΔOI− en bas (Y inversé)", () => {
    const d = { fMax: 0.2, oMax: 20 };
    const [droite] = projeterEnPixels([pt(0.2, 0)], d, w, h, pad);
    const [gauche] = projeterEnPixels([pt(-0.2, 0)], d, w, h, pad);
    const [haut] = projeterEnPixels([pt(0, 20)], d, w, h, pad);
    const [bas] = projeterEnPixels([pt(0, -20)], d, w, h, pad);
    // Bornes exactes de la zone de tracé.
    expect(droite!.x).toBeCloseTo(w - pad, 6);
    expect(gauche!.x).toBeCloseTo(pad, 6);
    expect(haut!.y).toBeCloseTo(pad, 6); // ΔOI+ = haut de canvas (petit y)
    expect(bas!.y).toBeCloseTo(h - pad, 6);
  });

  it("aller-retour cohérent : dé-projeter les pixels retrouve les données d'origine", () => {
    const d = { fMax: 0.15, oMax: 30 };
    const origine = [pt(0.05, -12), pt(-0.11, 7), pt(0.13, 29)];
    const pixels = projeterEnPixels(origine, d, w, h, pad);
    const innerW = w - 2 * pad;
    const innerH = h - 2 * pad;
    pixels.forEach((px, i) => {
      // Inverse analytique de la projection linéaire.
      const funding = ((px.x - pad) / innerW) * 2 * d.fMax - d.fMax;
      const dOi = d.oMax - ((px.y - pad) / innerH) * 2 * d.oMax;
      expect(funding).toBeCloseTo(origine[i]!.fundingPct, 6);
      expect(dOi).toBeCloseTo(origine[i]!.dOiPct, 6);
    });
  });
});

describe("placerLabels", () => {
  // Largeur fixe simulée : chaque label mesure `l` px (indépendant du texte).
  const largeur = (l: number) => () => l;
  const w = 400;
  const h = 300;

  it("laisse inchangés des labels sans collision", () => {
    const candidats = [
      { x: 80, y: 60, texte: "AAA" },
      { x: 300, y: 200, texte: "BBB" },
    ];
    const out = placerLabels(candidats, largeur(40), w, h);
    // Éloignés et loin des bords → aucun décalage ni clamp.
    expect(out[0]).toEqual({ x: 80, y: 60, texte: "AAA" });
    expect(out[1]).toEqual({ x: 300, y: 200, texte: "BBB" });
  });

  it("décale verticalement le second label quand deux se chevauchent", () => {
    const candidats = [
      { x: 100, y: 100, texte: "AAA" },
      { x: 100, y: 100, texte: "BBB" },
    ];
    const out = placerLabels(candidats, largeur(40), w, h);
    // Le premier garde sa place, le second est poussé vers le bas.
    expect(out[0]).toEqual({ x: 100, y: 100, texte: "AAA" });
    expect(out[1]!.x).toBe(100);
    expect(out[1]!.y).toBeGreaterThan(100);
  });

  it("clampe un label collé au bord droit dans le canvas", () => {
    // x=395, demi-largeur 20 → bord droit à 415 > w=400 : doit être ramené à ≤ 380.
    const out = placerLabels([{ x: 395, y: 100, texte: "AAA" }], largeur(40), w, h);
    expect(out[0]!.x).toBeLessThanOrEqual(w - 20);
  });

  it("clampe un label débordant en bas dans le canvas", () => {
    // y=310 > h=300 (baseline en bas) : doit être ramené à ≤ h.
    const out = placerLabels([{ x: 100, y: 310, texte: "AAA" }], largeur(40), w, h);
    expect(out[0]!.y).toBeLessThanOrEqual(h);
  });

  it("marché calme : 8 labels sur le même pixel → rects deux à deux disjoints", () => {
    // Scénario réel (tas au centre) : la cascade doit produire des rects sans chevauchement.
    const candidats = Array.from({ length: 8 }, () => ({ x: 200, y: 150, texte: "SYM" }));
    const out = placerLabels(candidats, largeur(40), w, h);
    // Vérifie l'absence de chevauchement deux à deux (hauteur label ≥ 1px, largeur 40).
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        // Rects centrés en x, baseline en bas : [x-20, x+20] × [y-H, y].
        const chevauchent =
          Math.abs(a.x - b.x) < 40 && Math.abs(a.y - b.y) < 1;
        expect(chevauchent).toBe(false);
      }
    }
  });
});

describe("quantile", () => {
  it("interpolation linéaire (convention type-7 : pos = q·(n−1))", () => {
    const v = [0, 10, 20, 30]; // n=4
    // q=0.5 → pos = 0.5·3 = 1.5 → v[1] + 0.5·(v[2]−v[1]) = 10 + 0.5·10 = 15
    expect(quantile(v, 0.5)).toBeCloseTo(15, 9);
    // q=0.02 → pos = 0.02·3 = 0.06 → v[0] + 0.06·(v[1]−v[0]) = 0 + 0.06·10 = 0.6
    expect(quantile(v, 0.02)).toBeCloseTo(0.6, 9);
    // Extrêmes : q=0 → min, q=1 → max (pos = 0 et n−1, sans fraction).
    expect(quantile(v, 0)).toBe(0);
    expect(quantile(v, 1)).toBe(30);
  });

  it("exclut les valeurs non finies avant de calculer", () => {
    const v = [10, NaN, 20, Infinity, 30, -Infinity];
    // Finis triés = [10, 20, 30], n=3 ; q=0.5 → pos = 1.0 → v[1] = 20 (aucune fraction).
    expect(quantile(v, 0.5)).toBe(20);
  });

  it("ne suppose pas l'entrée triée (tri interne)", () => {
    // Mêmes valeurs que le 1er cas mais désordonnées → même résultat q=0.5 = 15.
    expect(quantile([30, 0, 20, 10], 0.5)).toBeCloseTo(15, 9);
  });

  it("liste vide ou entièrement non finie → undefined", () => {
    expect(quantile([], 0.5)).toBeUndefined();
    expect(quantile([NaN, Infinity, -Infinity], 0.5)).toBeUndefined();
  });
});

describe("domaineAxesRobuste", () => {
  it("un outlier ×100 n'étire pas la borne au-delà de q98 (winsorisation)", () => {
    // 50 points calmes + 1 outlier. Avec n=51, pos(q98) = 0.98·50 = 49.0 → v[49],
    // qui est un point CALME (l'outlier est à l'index 50). La borne reste donc collée
    // aux données calmes, pas tirée par l'extrême. pos(q2) = 0.02·50 = 1.0 → v[1] calme.
    const calmes = Array.from({ length: 50 }, () => pt(0.05, 10));
    const avecOutlier = [...calmes, pt(5.0, 1000)];
    const d = domaineAxesRobuste(avecOutlier);
    // borne = max(|q2|, |q98|) = 0.05 (funding) / 10 (ΔOI), au-dessus du plancher.
    expect(d.fMax).toBeCloseTo(0.05, 6);
    expect(d.oMax).toBeCloseTo(10, 6);
    // L'outlier (5.0 ; 1000) est LOIN de la borne : preuve qu'il ne l'a pas étirée.
    expect(d.fMax).toBeLessThan(5.0);
    expect(d.oMax).toBeLessThan(1000);
  });

  it("nuage calme : plancher à 2× le seuil de neutralité de chaque axe", () => {
    // Toutes les |valeurs| < 2× seuil → q2/q98 sous le plancher → plancher retenu.
    const calme = [pt(0.003, 1), pt(-0.004, -2), pt(0.002, 1.5), pt(-0.001, -1), pt(0.005, 2)];
    const d = domaineAxesRobuste(calme);
    expect(d.fMax).toBe(2 * SEUIL_FUNDING_PCT); // 0.02
    expect(d.oMax).toBe(2 * SEUIL_DOI_PCT); // 6
  });

  it("sans point (quantile undefined) → plancher 2× seuils, 0 reste centré", () => {
    const d = domaineAxesRobuste([]);
    expect(d.fMax).toBe(2 * SEUIL_FUNDING_PCT);
    expect(d.oMax).toBe(2 * SEUIL_DOI_PCT);
  });
});

describe("scoreSqueeze", () => {
  const d = { fMax: 0.1, oMax: 10 };

  it("quadrant neutre → 0 (quelles que soient les valeurs)", () => {
    expect(scoreSqueeze({ fundingPct: 0.05, dOiPct: 5, quadrant: "neutre" }, d)).toBe(0);
  });

  it("point au coin du domaine → √2 (les deux ratios valent 1)", () => {
    const s = scoreSqueeze({ fundingPct: 0.1, dOiPct: 10, quadrant: "longs-crowded" }, d);
    expect(s).toBeCloseTo(Math.SQRT2, 9);
  });

  it("hors domaine → ratios clampés, jamais au-delà de √2", () => {
    const s = scoreSqueeze({ fundingPct: 100, dOiPct: 5000, quadrant: "carburant-squeeze" }, d);
    expect(s).toBeCloseTo(Math.SQRT2, 9);
  });

  it("point intermédiaire : √((f/bF)² + (oi/bOi)²)", () => {
    // f = 0.05/0.1 = 0.5 ; oi = 0/10 = 0 → √(0.25 + 0) = 0.5.
    const s = scoreSqueeze({ fundingPct: 0.05, dOiPct: 0, quadrant: "shorts-crowded" }, d);
    expect(s).toBeCloseTo(0.5, 9);
  });
});

describe("genTicks", () => {
  it("pas rond 1/2/5×10^k et écarts constants", () => {
    const t = genTicks(-0.02, 0.02, 5);
    expect(t.length).toBeGreaterThan(1);
    const step = t[1]! - t[0]!;
    for (let i = 1; i < t.length; i++) {
      expect(t[i]! - t[i - 1]!).toBeCloseTo(step, 9);
    }
    expect(estPasRond(step)).toBe(true);
  });

  it("inclut 0 quand 0 ∈ [min, max]", () => {
    expect(genTicks(-0.02, 0.02, 5).some((v) => Math.abs(v) < 1e-12)).toBe(true);
    expect(genTicks(-6, 6, 5).some((v) => v === 0)).toBe(true);
  });

  it("cible 4-6 valeurs sur des domaines usuels (funding & ΔOI winsorisés)", () => {
    const tF = genTicks(-0.02, 0.02, 5);
    expect(tF.length).toBeGreaterThanOrEqual(4);
    expect(tF.length).toBeLessThanOrEqual(6);
    const tO = genTicks(-25, 25, 5);
    expect(tO.length).toBeGreaterThanOrEqual(4);
    expect(tO.length).toBeLessThanOrEqual(6);
  });

  it("plancher funding ±0.02 (domaine le plus fréquent) : crans symétriques exacts", () => {
    // Cas de garde contre le bruit flottant sur ceil(min/pas) : le domaine calme le plus
    // courant doit produire exactement 5 crans symétriques incluant les deux bornes.
    expect(genTicks(-0.02, 0.02, 5)).toEqual([-0.02, -0.01, 0, 0.01, 0.02]);
  });

  it("couvre [min, max] : premier ≥ min, dernier ≤ max, à moins d'un pas des bornes", () => {
    const t = genTicks(-0.05, 0.05, 5);
    const step = t[1]! - t[0]!;
    expect(t[0]!).toBeGreaterThanOrEqual(-0.05);
    expect(t[t.length - 1]!).toBeLessThanOrEqual(0.05);
    expect(t[0]! - -0.05).toBeLessThan(step);
    expect(0.05 - t[t.length - 1]!).toBeLessThan(step);
  });
});

describe("estEcrete", () => {
  const d = { fMax: 0.1, oMax: 10 };

  it("point dans le domaine → false", () => {
    expect(estEcrete(pt(0.05, 5), d)).toBe(false);
  });

  it("hors domaine sur l'axe funding → true", () => {
    expect(estEcrete(pt(0.2, 0), d)).toBe(true);
  });

  it("hors domaine sur l'axe ΔOI → true", () => {
    expect(estEcrete(pt(0, 50), d)).toBe(true);
  });

  it("exactement sur la borne → false (comparaison stricte)", () => {
    expect(estEcrete(pt(0.1, 10), d)).toBe(false);
  });
});
