/**
 * dessinerAnnotationsPane — testé avec un contexte canvas FACTICE qui enregistre
 * les opérations (pattern vi.mock des tests chart existants) et des axes idx*10 /
 * valeur*2. On vérifie le tri par cible, le culling par visibleRange, le pointillé
 * (setLineDash [4,4]) et sa remise à zéro avant chaque trait plein, le polygone
 * fermé du ruban et son découpage à la fenêtre, le triangle creux et les
 * étiquettes ancrées à droite.
 *
 * `canvasTokens` est mocké sur son repli : les tests tournent en environnement
 * node (pas de `getComputedStyle`/`document`) — même pattern que position.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import type { AnnotationsIndicateur } from "@axiom/types";

vi.mock("../lib/canvasTokens", () => ({
  lireTokenCanvas: (_t: string, d: string) => d,
  rgbaTokenCanvas: (_t: string, _a: number, d: string) => d,
}));

import { dessinerAnnotationsPane } from "./annotationsPane";

function fauxCtx() {
  const ops: string[] = [];
  const ctx = {
    ops,
    beginPath: () => ops.push("beginPath"),
    moveTo: (x: number, y: number) => ops.push(`moveTo(${x},${y})`),
    lineTo: (x: number, y: number) => ops.push(`lineTo(${x},${y})`),
    closePath: () => ops.push("closePath"),
    stroke: () => ops.push("stroke"),
    fill: () => ops.push("fill"),
    fillText: (t: string, x: number, y: number) => ops.push(`fillText(${t},${x},${y})`),
    setLineDash: (d: number[]) => ops.push(`setLineDash(${d.join(",")})`),
    save: () => ops.push("save"),
    restore: () => ops.push("restore"),
    strokeStyle: "", fillStyle: "", lineWidth: 0, font: "", textAlign: "", textBaseline: "",
  };
  return ctx as unknown as CanvasRenderingContext2D & { ops: string[] };
}

const AXES = { convertirX: (i: number) => i * 10, convertirY: (v: number) => v * 2 };
const FENETRE = { de: 0, a: 100 };

describe("dessinerAnnotationsPane", () => {
  it("segment plein cible prix : tracé aux pixels convertis, pointillé hérité remis à zéro", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      segments: [{ deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 7, trait: "plein", couleur: "--up", cible: "prix" }],
    };
    dessinerAnnotationsPane(ctx, a, "prix", AXES, FENETRE);
    expect(ctx.ops).toContain("moveTo(20,16)");
    expect(ctx.ops).toContain("lineTo(60,14)");
    expect(ctx.ops).toContain("stroke");
    // Juste après save : le [4, 4] de la ligne du dernier prix (KLineChart) ne doit pas déborder.
    expect(ctx.ops.slice(0, 2)).toEqual(["save", "setLineDash()"]);
  });

  it("segment pointillé : setLineDash(4,4) entre save/restore", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      segments: [{ deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 8.5, trait: "pointille", couleur: "--up", cible: "pane" }],
    };
    dessinerAnnotationsPane(ctx, a, "pane", AXES, FENETRE);
    expect(ctx.ops).toContain("setLineDash(4,4)");
  });

  it("cible non correspondante et hors visibleRange : rien n'est dessiné", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      segments: [
        { deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 7, trait: "plein", couleur: "--up", cible: "pane" }, // mauvaise cible
        { deIdx: 200, deValeur: 8, aIdx: 210, aValeur: 7, trait: "plein", couleur: "--up", cible: "prix" }, // hors fenêtre
      ],
      labels: [{ idx: 300, valeur: 5, texte: "Div ▲", couleur: "--up", cible: "prix" }], // hors fenêtre
    };
    dessinerAnnotationsPane(ctx, a, "prix", AXES, FENETRE);
    expect(ctx.ops).toEqual([]);
  });

  it("ruban : polygone fermé (aller hauts + retour bas) rempli, cible prix seulement", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      rubans: [{ deIdx: 3, hauts: [10, 11], bas: [9, 9.5], couleur: "--up", alpha: 0.15 }],
    };
    dessinerAnnotationsPane(ctx, a, "prix", AXES, FENETRE);
    expect(ctx.ops).toEqual([
      "beginPath",
      "moveTo(30,20)", "lineTo(40,22)",   // hauts, aller
      "lineTo(40,19)", "lineTo(30,18)",   // bas, retour
      "closePath", "fill",
    ]);
    const ctx2 = fauxCtx();
    dessinerAnnotationsPane(ctx2, a, "pane", AXES, FENETRE);
    expect(ctx2.ops).toEqual([]); // jamais de ruban sur un pane séparé
  });

  it("marqueur et label : triangle rempli, texte décalé selon position", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      marqueurs: [{ idx: 4, valeur: 5, forme: "triangleHaut", couleur: "--up", cible: "pane" }],
      labels: [{ idx: 6, valeur: 7, texte: "Div ▲", couleur: "--up", cible: "pane", position: "dessous" }],
    };
    dessinerAnnotationsPane(ctx, a, "pane", AXES, FENETRE);
    expect(ctx.ops).toContain("moveTo(40,4)");        // sommet du triangleHaut : y=10-6
    expect(ctx.ops).toContain("fillText(Div ▲,60,22)"); // label dessous : y=14+8
  });

  it("label de couverture en haut du pane : coordonnée fixe sans conversion financière", () => {
    const ctx = fauxCtx();
    const convertirY = vi.fn(() => 110);
    dessinerAnnotationsPane(ctx, { labels: [{ idx: 6, valeur: 0, texte: "0/4 venues", couleur: "--text-dim", cible: "pane", ancrageY: "haut-pane" }] },
      "pane", { convertirX: AXES.convertirX, convertirY }, FENETRE);
    expect(convertirY).not.toHaveBeenCalled();
    expect(ctx.ops).toContain("fillText(0/4 venues,60,32)");
    expect(ctx.textBaseline).toBe("top");
  });

  it("marqueur creux : contour plein (pointillé hérité remis à zéro), demi-base 4, jamais rempli", () => {
    const ctx = fauxCtx();
    dessinerAnnotationsPane(ctx, { marqueurs: [
      { idx: 3, valeur: 50, forme: "triangleHaut", couleur: "--up", cible: "prix", creux: true },
      { idx: 5, valeur: 50, forme: "triangleBas", couleur: "--down", cible: "prix", creux: true },
    ] }, "prix", AXES, FENETRE);
    expect(ctx.ops).toEqual([
      "setLineDash()", "beginPath", "moveTo(30,96)", "lineTo(26,104)", "lineTo(34,104)", "closePath", "stroke",
      "setLineDash()", "beginPath", "moveTo(50,104)", "lineTo(46,96)", "lineTo(54,96)", "closePath", "stroke",
    ]);
    expect(ctx.lineWidth).toBe(1.5);
    expect(ctx.strokeStyle).toBe("#ef4444"); // repli de --down, dernier marqueur dessiné
  });

  it("étiquettes ancrées à droite : à x + 8, centrées sur la valeur, écartées d'au moins 11 px", () => {
    const ctx = fauxCtx();
    dessinerAnnotationsPane(ctx, { labels: [
      { idx: 9, valeur: 52, texte: "R forte · 8", couleur: "--down", cible: "prix", ancrageX: "droite" },
      { idx: 9, valeur: 50, texte: "R forte · 12", couleur: "--down", cible: "prix", ancrageX: "droite" },
      { idx: 9, valeur: 80, texte: "S fort · 5", couleur: "--up", cible: "prix", ancrageX: "droite" },
    ] }, "prix", AXES, FENETRE);
    expect(ctx.ops).toEqual(["fillText(R forte · 12,98,100)", "fillText(R forte · 8,98,111)", "fillText(S fort · 5,98,160)"]);
    expect(ctx.textAlign).toBe("left");
    expect(ctx.textBaseline).toBe("middle");
  });

  it("étiquette ancrée à droite : dessinée après les étiquettes centrées, `position` ignorée", () => {
    const ctx = fauxCtx();
    dessinerAnnotationsPane(ctx, { labels: [
      { idx: 9, valeur: 50, texte: "R forte · 12", couleur: "--down", cible: "prix", ancrageX: "droite", position: "dessous" },
      { idx: 4, valeur: 5, texte: "Div ▲", couleur: "--up", cible: "prix" },
    ] }, "prix", AXES, FENETRE);
    // Centrée : y = 10 - 8 (dessus par défaut). À droite : y = 100, sans décalage « dessous ».
    expect(ctx.ops).toEqual(["fillText(Div ▲,40,2)", "fillText(R forte · 12,98,100)"]);
  });

  it("ruban long : seuls les points de la fenêtre visible (± 1 bougie) sont parcourus", () => {
    const ctx = fauxCtx();
    const n = 3000;
    dessinerAnnotationsPane(ctx, { rubans: [
      { deIdx: 0, hauts: new Array<number>(n).fill(60), bas: new Array<number>(n).fill(50), couleur: "--up", alpha: 0.2 },
    ] }, "prix", AXES, { de: 1000, a: 1010 });
    // 12 indices (999 à 1010) à l'aller et au retour : 1 moveTo + 23 lineTo, jamais 6 000.
    expect(ctx.ops.filter((o) => o.startsWith("moveTo")).length).toBe(1);
    expect(ctx.ops.filter((o) => o.startsWith("lineTo")).length).toBe(23);
    expect(ctx.ops[1]).toBe("moveTo(9990,120)");
  });
});
