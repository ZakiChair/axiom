/**
 * Frontière entre l'extension d'historique du graphe et l'évaluation d'une alerte.
 *
 * Une alerte dont l'indicateur déclare une amorce (AXIS 1 500 bougies, AXIS S/R 3 000) n'est
 * évaluée que si le tampon du graphe la compte (`amorceAtteinte`). Le graphe, lui, cesse d'étendre
 * son historique dès que `doitEtendreHistorique` rend faux. Les deux doivent compter pareil — le
 * tampon entier, bougie en formation comprise — sinon une alerte dont l'indicateur est affiché
 * pourrait ne jamais être évaluée : le graphe s'arrêterait à A bougies (A − 1 closes) et l'alerte
 * en attendrait une de plus. Ce test appelle la vraie fonction du graphe.
 *
 * NOTE environnement : même préambule que `chart/extensionSession.test.ts` — le graphe d'import
 * de `ChartInstance.tsx` touche `document` et enregistre des overlays klinecharts dès l'import.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const noop = (): void => {};
  const faireElement = (): Record<string, unknown> => ({
    style: {},
    classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    setAttribute: noop,
    getAttribute: () => null,
    removeAttribute: noop,
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    getContext: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: faireElement(),
    body: faireElement(),
    head: faireElement(),
    createElement: faireElement,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
  };
  g.window = globalThis;
  g.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = noop;
  g.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

vi.mock("klinecharts", () => ({
  init: () => null,
  dispose: () => {},
  registerIndicator: () => {},
  registerOverlay: () => {},
  ActionType: {
    OnCrosshairChange: "onCrosshairChange",
    OnDataReady: "onDataReady",
    OnPaneDrag: "onPaneDrag",
    OnScroll: "onScroll",
    OnVisibleRangeChange: "onVisibleRangeChange",
    OnZoom: "onZoom",
  },
  DomPosition: { Main: "main", Root: "root", YAxis: "yAxis" },
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
  LoadDataType: { Forward: "forward", Backward: "backward", Init: "init" },
  TooltipShowRule: { Always: "always", None: "none", FollowCross: "follow_cross" },
  YAxisType: { Normal: "normal", Log: "log", Percentage: "percentage" },
  OverlayFigureIgnoreEventType: { None: "none" },
  PolygonType: { Fill: "fill", Stroke: "stroke" },
  LineType: { Solid: "solid", Dashed: "dashed" },
}));

import type { Condition } from "@axiom/alerts";
import { INDICATORS } from "@axiom/indicators";
import { amorceMinimale, doitEtendreHistorique } from "../chart/ChartInstance";
import { amorceAlerte, amorceAtteinte } from "./alertsPanel.util";

const seuil = (indicateurId: string): Condition =>
  ({ type: "indicateur-seuil", indicateurId, params: {}, output: "etat", comparateur: ">=", valeur: 1 });

/** Une bougie de 4h par indice : le tampon de `nombre` bougies finit à `dernier`. */
const QUATRE_HEURES = 14_400_000;
const dernier = 20_000 * 86_400_000;
const premier = (nombre: number): number => dernier - (nombre - 1) * QUATRE_HEURES;

describe("amorce d'une alerte : même décompte que l'extension d'historique du graphe", () => {
  const AVEC_AMORCE = INDICATORS.filter((d) => (d.amorceBougies ?? 0) > 0);

  it("témoin : AXIS et AXIS S/R déclarent une amorce, et l'alerte lit la même que le graphe", () => {
    expect(AVEC_AMORCE.map((d) => [d.id, d.amorceBougies])).toEqual([["stratAxis", 1500], ["stratAxisSr", 3000]]);
    for (const d of AVEC_AMORCE) expect(amorceAlerte({ condition: seuil(d.id) })).toBe(amorceMinimale([d.id]));
  });

  it("indicateur affiché : l'alerte est évaluable exactement quand le graphe cesse d'étendre l'historique", () => {
    for (const d of AVEC_AMORCE) {
      const amorce = d.amorceBougies!;
      for (const nombre of [2, 500, amorce - 2, amorce - 1, amorce, amorce + 1, amorce + 500]) {
        const grapheEtend = doitEtendreHistorique([d.id], premier(nombre), dernier, nombre);
        expect(amorceAtteinte({ condition: seuil(d.id) }, nombre), `${d.id} à ${nombre} bougies`).toBe(!grapheEtend);
      }
      // La frontière : à A − 1 bougies le graphe étend encore et l'alerte attend ; à A, il s'arrête et elle est évaluée.
      expect(doitEtendreHistorique([d.id], premier(amorce - 1), dernier, amorce - 1)).toBe(true);
      expect(amorceAtteinte({ condition: seuil(d.id) }, amorce - 1)).toBe(false);
      expect(doitEtendreHistorique([d.id], premier(amorce), dernier, amorce)).toBe(false);
      expect(amorceAtteinte({ condition: seuil(d.id) }, amorce)).toBe(true);
    }
  });

  it("AXIS seul affiché, alerte AXIS S/R : le graphe s'arrête à 1 500 bougies, l'alerte reste sans évaluation", () => {
    expect(doitEtendreHistorique(["stratAxis"], premier(1500), dernier, 1500)).toBe(false);
    expect(amorceAtteinte({ condition: seuil("stratAxisSr") }, 1500)).toBe(false);
    // Les deux affichés : le graphe remonte à 3 000, les deux alertes sont évaluables.
    expect(doitEtendreHistorique(["stratAxis", "stratAxisSr"], premier(1500), dernier, 1500)).toBe(true);
    expect(doitEtendreHistorique(["stratAxis", "stratAxisSr"], premier(3000), dernier, 3000)).toBe(false);
    expect(amorceAtteinte({ condition: seuil("stratAxisSr") }, 3000)).toBe(true);
  });
});
