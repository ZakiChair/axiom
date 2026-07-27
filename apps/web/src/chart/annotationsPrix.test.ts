/**
 * AnnotationsPrix — chart FACTICE enregistrant createOverlay/removeOverlay
 * (pattern des tests chart existants, vi.mock de klinecharts pour registerOverlay).
 *
 * Le TEMPLATE d'overlay est capturé au vol par le mock (`vi.hoisted`, patron
 * d'indicators.tooltip.test.ts) : c'est ce qui verrouille `totalStep: 1`, dont
 * dépend l'arité VARIABLE des points (1 pour marqueurs/labels, 2 pour segments).
 * Régression couverte : avec `totalStep: 3`, `setPoints` laisse tout overlay à 1
 * point en `isDrawing()` — il n'entre jamais dans `_instances` (donc non retirable
 * au rejeu) et bloque le survol de TOUTES les annotations via `_progressInstanceInfo`.
 *
 * `canvasTokens` est mocké sur son repli : `createPointFigures` est appelé
 * DIRECTEMENT ici et les tests tournent en environnement node (pas de
 * `getComputedStyle`/`document`) — même pattern qu'annotationsPane.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayCreateFiguresCallbackParams, OverlayFigure, OverlayTemplate } from "klinecharts";

const capture = vi.hoisted(() => ({ template: null as OverlayTemplate | null }));

vi.mock("klinecharts", () => ({
  registerOverlay: (t: OverlayTemplate) => {
    capture.template = t;
  },
}));

vi.mock("../lib/canvasTokens", () => ({
  lireTokenCanvas: (_t: string, d: string) => d,
}));

import type { Candle, IndicatorDef } from "@axiom/types";
import { AnnotationsPrix } from "./annotationsPrix";

const candles: Candle[] = Array.from({ length: 10 }, (_v, i) => ({
  time: 1_700_000_000_000 + i * 60_000,
  open: 10, high: 12, low: 9, close: 11, volume: 1,
}));

const defSepare = { pane: "separate" } as IndicatorDef;
const defOverlay = { pane: "overlay" } as IndicatorDef;

const ANNOTS = {
  segments: [
    { deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 7, trait: "plein", couleur: "--up", cible: "prix", info: "i1" },
    { deIdx: 2, deValeur: 3, aIdx: 6, aValeur: 3.5, trait: "plein", couleur: "--up", cible: "pane", info: "i1" },
  ],
  labels: [{ idx: 6, valeur: 7, texte: "Div ▲", couleur: "--up", cible: "prix", position: "dessous", info: "i1" }],
} as const;

function fauxChart() {
  let seq = 0;
  const crees: Array<Record<string, unknown>> = [];
  const retires: string[] = [];
  return {
    crees,
    retires,
    createOverlay: (o: Record<string, unknown>) => { crees.push(o); return `ov-${seq++}`; },
    removeOverlay: (f: { id: string }) => { retires.push(f.id); },
  };
}

describe("AnnotationsPrix", () => {
  let chart: ReturnType<typeof fauxChart>;
  let ann: AnnotationsPrix;
  beforeEach(() => {
    chart = fauxChart();
    ann = new AnnotationsPrix(chart as never);
  });

  it("def séparé : pose les annotations cible prix (segment 2 points + label), pas celles du pane", () => {
    ann.appliquer("inst1", defSepare, ANNOTS as never, candles);
    expect(chart.crees.length).toBe(2); // 1 segment prix + 1 label (le segment pane est exclu)
    const seg = chart.crees[0] as { points: Array<{ timestamp: number; value: number }> };
    expect(seg.points).toEqual([
      { timestamp: candles[2]!.time, value: 8 },
      { timestamp: candles[6]!.time, value: 7 },
    ]);
  });

  it("rejeu : re-appliquer retire les anciens ids avant de recréer", () => {
    ann.appliquer("inst1", defSepare, ANNOTS as never, candles);
    ann.appliquer("inst1", defSepare, ANNOTS as never, candles);
    expect(chart.retires).toEqual(["ov-0", "ov-1"]);
    expect(chart.crees.length).toBe(4);
  });

  it("retirer : nettoie les ids suivis ; annotations undefined : rien de posé", () => {
    ann.appliquer("inst1", defSepare, ANNOTS as never, candles);
    ann.retirer("inst1");
    expect(chart.retires).toEqual(["ov-0", "ov-1"]);
    ann.appliquer("inst2", defSepare, undefined, candles);
    expect(chart.crees.length).toBe(2); // rien de nouveau
  });

  it("retirerTout : retire les overlays de TOUTES les instances suivies (démontage du chart)", () => {
    ann.appliquer("inst1", defSepare, ANNOTS as never, candles);
    ann.appliquer("inst2", defSepare, ANNOTS as never, candles);
    ann.retirerTout();
    expect(chart.retires).toEqual(["ov-0", "ov-1", "ov-2", "ov-3"]);
    // Suivi vidé : un second appel ne retente rien (chart potentiellement détruit).
    ann.retirerTout();
    expect(chart.retires.length).toBe(4);
  });

  it("def overlay : AUCUN overlay (le draw du candle_pane s'en charge)", () => {
    ann.appliquer("inst1", defOverlay, ANNOTS as never, candles);
    expect(chart.crees.length).toBe(0);
  });

  it("template : totalStep 1 (overlays pré-créés, jamais dessinés à la souris)", () => {
    // > 1 laisserait les overlays à UN point en cours de dessin (cf. docblock du module).
    expect(capture.template?.totalStep).toBe(1);
  });

  it("figure label : fond TRANSPARENT (le défaut KLineChart peint une pastille bleue)", () => {
    // Sans cette ligne de styles, `getDefaultOverlayStyle().text().backgroundColor`
    // (#1677FF) est mergé à la figure : un aplat bleu INVARIANT AU THÈME sous chaque
    // « Div ▲ » (défaut relevé au gate visuel du lot v2.1).
    const figures = capture.template?.createPointFigures?.({
      overlay: { extendData: { genre: "label", texte: "Div ▲", couleur: "--up", dessous: true } },
      coordinates: [{ x: 10, y: 20 }],
    } as unknown as OverlayCreateFiguresCallbackParams);
    const [figure] = figures as OverlayFigure[];
    expect(figure?.type).toBe("text");
    expect(figure?.styles.backgroundColor).toBe("transparent");
  });

  it("arité des points : 2 pour un segment, 1 pour un marqueur et un label", () => {
    const mixte = {
      segments: [{ deIdx: 1, deValeur: 8, aIdx: 5, aValeur: 7, trait: "plein", couleur: "--up", cible: "prix" }],
      marqueurs: [{ idx: 5, valeur: 7, forme: "triangleHaut", couleur: "--up", cible: "prix" }],
      labels: [{ idx: 5, valeur: 7, texte: "Div ▲", couleur: "--up", cible: "prix" }],
    };
    ann.appliquer("inst1", defSepare, mixte as never, candles);
    const arites = chart.crees.map((o) => (o.points as unknown[]).length);
    expect(arites).toEqual([2, 1, 1]); // ordre de pose : segments, marqueurs, labels
  });

  it("cap 150 : seules les annotations les plus récentes sont posées", () => {
    const beaucoup = {
      labels: Array.from({ length: 200 }, (_v, i) => ({
        idx: i % 10, valeur: 7, texte: "Div ▲", couleur: "--up", cible: "prix" as const,
      })),
    };
    ann.appliquer("inst1", defSepare, beaucoup as never, candles);
    expect(chart.crees.length).toBe(150);
  });
});
