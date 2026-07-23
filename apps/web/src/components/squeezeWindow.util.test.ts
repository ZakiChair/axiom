/**
 * Tests des utilitaires PURS de projection du radar de squeeze : domaine d'axes
 * (bornes symétriques autour de 0, 0 toujours visible, padding) et projection
 * données→pixels (aller-retour cohérent). Les valeurs attendues sont justifiées.
 */
import { describe, it, expect } from "vitest";
import { domaineAxes, placerLabels, projeterEnPixels } from "./squeezeWindow.util";

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
