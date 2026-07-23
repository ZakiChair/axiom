/**
 * Tests des utilitaires PURS de projection du radar de squeeze : domaine d'axes
 * (bornes symétriques autour de 0, 0 toujours visible, padding) et projection
 * données→pixels (aller-retour cohérent). Les valeurs attendues sont justifiées.
 */
import { describe, it, expect } from "vitest";
import { domaineAxes, projeterEnPixels } from "./squeezeWindow.util";

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
