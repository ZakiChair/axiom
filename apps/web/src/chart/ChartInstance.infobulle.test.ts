/**
 * Ordonnée de l'infobulle d'indicateur du pane des prix au téléphone (`hautInfobullePrix`).
 *
 * Défaut couvert (limite laissée ouverte à la fusion du 10 novembre 2026) : `candle.tooltip.offsetTop`
 * valait la constante 36, calée sur le bandeau du bureau. Au téléphone le bandeau du symbole descend
 * à 50 px du haut du pane (mesuré sur Chromium téléphone, 390 × 844) : la première rangée de
 * l'infobulle, écrite de 40 à 51 px, passait dessous. Les cas ci-dessous reprennent les mesures du
 * parcours `e2e/mobile-axis-sr.e2e.ts`, qui prouve le câblage sur le vrai graphe.
 *
 * Bureau (phase 2 d'AXIS, 12 novembre 2026) : la même formule y vaut désormais. Le bandeau du
 * symbole y descend à 44 px (64 px sur deux rangées en vue étroite) : à 36 px, il entamait la
 * première rangée de l'infobulle, celle d'un signal ou du pré-signal. 36 px reste le plancher.
 *
 * NOTE environnement : même préambule que `backfillDelai.test.ts` — le graphe d'import de
 * `ChartInstance.tsx` touche `document` et enregistre des overlays klinecharts dès l'import.
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

import { hautInfobullePrix } from "./ChartInstance";

/** Valeur du bureau : plancher de l'ordonnée, et repli quand rien n'est mesurable. */
const BUREAU = 36;

/** « Détails » fermé, ou en-tête sans panneau : la part repliée est l'en-tête entier. */
const replie = (bas: number, pane: number): number => hautInfobullePrix(bas, bas, pane);
/** Haut du panneau « Détails » ouvert, mesuré 3 px sous le bas du bandeau replié. */
const PANNEAU = 53;

describe("hautInfobullePrix — l'infobulle du pane des prix passe sous le bas réel de l'en-tête", () => {
  it("bandeau du téléphone replié (bas à 50 px) : 2 px dessous, en portrait comme en paysage", () => {
    expect(replie(50, 584)).toBe(52);
    expect(replie(50, 480)).toBe(52);
    expect(replie(50, 219)).toBe(52);
  });

  // Revue du 11 novembre 2026 : le plafond du tiers jouait aussi « Détails » fermé. En paysage
  // 844 × 390 avec un pane d'indicateur, le pane des prix fait 118 px : l'infobulle remontait à
  // 39 px, sous le bandeau (bas à 50 px). La version précédente de ce fichier épinglait le
  // défaut : un bas à 50 px sur un pane de 90 px y valait 36.
  it("« Détails » fermé : la hauteur du pane ne compte pas, même sur un pane très court", () => {
    for (const pane of [0, 40, 90, 118, 155, 156, 219, 584]) expect(replie(50, pane)).toBe(52);
  });

  it("en-tête d'une vue secondaire au téléphone (bas à 52 px) : 54", () => {
    expect(replie(52, 584)).toBe(54);
  });

  it("un bas fractionnaire est arrondi au pixel du dessous : l'infobulle ne mord jamais sur l'en-tête", () => {
    expect(replie(49.2, 584)).toBe(52);
    expect(replie(50.01, 584)).toBe(53);
  });

  it("en-tête plus court que celui du bureau : la valeur du bureau reste le plancher", () => {
    expect(replie(27, 584)).toBe(BUREAU);
    expect(replie(34, 584)).toBe(BUREAU);
    expect(replie(35, 584)).toBe(37);
  });

  it("bandeau du bureau (bas à 44 px, 64 px sur deux rangées en vue étroite) : 2 px dessous, quelle que soit la hauteur du pane", () => {
    for (const pane of [120, 300, 560, 820]) {
      expect(replie(44, pane)).toBe(46);
      expect(replie(64, pane)).toBe(66);
    }
  });

  it("en-tête d'une vue secondaire au bureau, plus court que 34 px : le plancher de 36 px", () => {
    for (const bas of [0, 20, 28, 33.2, 34]) expect(replie(bas, 400)).toBe(BUREAU);
  });

  it("« Détails » ouvert dans le tiers haut du pane : l'infobulle suit le panneau", () => {
    expect(hautInfobullePrix(PANNEAU, 135, 584)).toBe(137);
    expect(hautInfobullePrix(PANNEAU, 135, 480)).toBe(137);
  });

  it("« Détails » ouvert au-delà du tiers haut : l'infobulle s'arrête au tiers du pane", () => {
    expect(hautInfobullePrix(PANNEAU, 111, 219)).toBe(73);
    expect(hautInfobullePrix(PANNEAU, 135, 308)).toBe(102);
    // Bloc de détails à sa hauteur maximale (35 % de 844 px) : jamais 300 px plus bas.
    expect(hautInfobullePrix(PANNEAU, 50 + 295, 584)).toBe(194);
  });

  it("« Détails » ouvert, tiers du pane au-dessus de la part repliée : l'infobulle s'arrête sous elle, jamais sous le bandeau", () => {
    // Paysage 844 × 390 avec un pane d'indicateur (mesuré) : tiers à 39 px, panneau de 53 à 111 px.
    expect(hautInfobullePrix(PANNEAU, 111, 118)).toBe(55);
    expect(hautInfobullePrix(PANNEAU, 111, 0)).toBe(55);
  });

  it("slot masqué (tout à zéro, en-tête au-dessus du pane) : valeur du bureau", () => {
    expect(replie(0, 0)).toBe(BUREAU);
    expect(replie(-183, 0)).toBe(BUREAU);
  });

  it("mesure non finie : valeur du bureau, jamais NaN", () => {
    expect(hautInfobullePrix(Number.NaN, 50, 584)).toBe(BUREAU);
    expect(hautInfobullePrix(50, Number.NaN, 584)).toBe(BUREAU);
    expect(hautInfobullePrix(50, 50, Number.NaN)).toBe(BUREAU);
    expect(hautInfobullePrix(50, Number.POSITIVE_INFINITY, 584)).toBe(BUREAU);
  });

  it("jamais sous la part repliée, jamais plus bas que le bas de l'en-tête, plafonnée au tiers entre les deux", () => {
    for (const pane of [0, 90, 118, 204, 219, 308, 480, 584, 900]) {
      const tiers = Math.floor(pane / 3);
      for (let basReplie = -50; basReplie <= 200; basReplie += 7) {
        for (let panneau = 0; panneau <= 420; panneau += 35) {
          const bas = basReplie + panneau;
          const haut = hautInfobullePrix(basReplie, bas, pane);
          expect(haut).toBeGreaterThanOrEqual(BUREAU);
          // La part repliée ne cache jamais la première rangée.
          expect(haut).toBeGreaterThanOrEqual(basReplie + 2);
          // Jamais plus bas que sous l'en-tête entier ; au-delà du tiers, seulement faute de place.
          expect(haut).toBeLessThanOrEqual(Math.max(BUREAU, Math.ceil(bas) + 2));
          expect(haut).toBeLessThanOrEqual(Math.max(BUREAU, basReplie + 2, tiers));
        }
      }
    }
  });
});
