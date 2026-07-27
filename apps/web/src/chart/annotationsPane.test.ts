/**
 * dessinerAnnotationsPane — testé avec un contexte canvas FACTICE qui enregistre
 * les opérations (pattern vi.mock des tests chart existants) et des axes idx*10 /
 * valeur*2. On vérifie le tri par cible, le culling par visibleRange, le pointillé
 * (setLineDash [4,4]) et le polygone fermé du ruban.
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
  it("segment plein cible prix : tracé aux pixels convertis, sans setLineDash", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      segments: [{ deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 7, trait: "plein", couleur: "--up", cible: "prix" }],
    };
    dessinerAnnotationsPane(ctx, a, "prix", AXES, FENETRE);
    expect(ctx.ops).toContain("moveTo(20,16)");
    expect(ctx.ops).toContain("lineTo(60,14)");
    expect(ctx.ops).toContain("stroke");
    expect(ctx.ops.some((o) => o.startsWith("setLineDash"))).toBe(false);
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
});
