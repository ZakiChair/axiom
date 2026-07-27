/**
 * AnnotationsPrix — chart FACTICE enregistrant createOverlay/removeOverlay
 * (pattern des tests chart existants, vi.mock de klinecharts pour registerOverlay).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));

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

  it("def overlay : AUCUN overlay (le draw du candle_pane s'en charge)", () => {
    ann.appliquer("inst1", defOverlay, ANNOTS as never, candles);
    expect(chart.crees.length).toBe(0);
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
