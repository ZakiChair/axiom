/**
 * Filet de hauteur (equilibrerHauteurs) : les panes créés HORS du contrôleur
 * d'indicateurs (CVD, CVD S/P, OI, funding, comparaison, revenus, macro — ids
 * déterministes) doivent entrer dans le budget, sinon des panes annexes écrasent le
 * pane prix sans que le filet ne voie rien (même symptôme que le « pane prix à 4 px »
 * de la revue § 3.4). Harnais calqué sur indicators.symbolSwitch.test.ts (chart
 * mocké, aucun DOM).
 */
import { describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import { ChartIndicators } from "./indicators";

vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));

describe("equilibrerHauteurs — panes hors contrôleur", () => {
  it("rogne les panes annexes (CVD/OI/funding/…) quand le pane prix est étouffé", () => {
    // 5 panes annexes à 100 px + prix à 100 px : utile 600, budget 330 → rognage attendu.
    const tailles: Record<string, { height: number }> = {
      candle_pane: { height: 100 },
      axiom_orderflow_cvd: { height: 100 },
      axiom_orderflow_cvd_sp: { height: 100 },
      axiom_deriv_oi: { height: 100 },
      axiom_deriv_funding: { height: 100 },
      axiom_compare: { height: 100 },
    };
    const chart = {
      createIndicator: vi.fn(() => null),
      overrideIndicator: vi.fn(),
      removeIndicator: vi.fn(),
      getSize: vi.fn((paneId: string) => tailles[paneId] ?? null),
      setPaneOptions: vi.fn(),
    };
    const indicators = new ChartIndicators(chart as unknown as Chart);

    indicators.rafraichirHauteurs();

    // AVANT correctif : aucune instance @axiom active → hauteurs=[] → filet aveugle.
    expect(chart.setPaneOptions).toHaveBeenCalled();
    for (const call of chart.setPaneOptions.mock.calls) {
      const opts = call[0] as { id: string; height: number };
      expect(Object.keys(tailles)).toContain(opts.id);
      expect(opts.height).toBeLessThan(100); // rogné
      expect(opts.height).toBeGreaterThanOrEqual(60); // jamais sous le plancher
    }
  });

  it("ne touche à rien quand aucun pane annexe n'existe (getSize → null)", () => {
    const chart = {
      createIndicator: vi.fn(() => null),
      overrideIndicator: vi.fn(),
      removeIndicator: vi.fn(),
      getSize: vi.fn((paneId: string) => (paneId === "candle_pane" ? { height: 400 } : null)),
      setPaneOptions: vi.fn(),
    };
    const indicators = new ChartIndicators(chart as unknown as Chart);
    indicators.rafraichirHauteurs();
    expect(chart.setPaneOptions).not.toHaveBeenCalled();
  });

  it("compte aussi Revenu protocole et Macro (RevenueController/MacroController — hors des 5 précédents)", () => {
    // Prix + revenus + macro seuls, sans les 5 panes précédents : utile 300, budget
    // 165 (300*0,55), total des annexes 200 > 165 → rognage attendu sur ces 2 panes.
    const tailles: Record<string, { height: number }> = {
      candle_pane: { height: 100 },
      axiom_revenue: { height: 100 },
      axiom_macro: { height: 100 },
    };
    const chart = {
      createIndicator: vi.fn(() => null),
      overrideIndicator: vi.fn(),
      removeIndicator: vi.fn(),
      getSize: vi.fn((paneId: string) => tailles[paneId] ?? null),
      setPaneOptions: vi.fn(),
    };
    const indicators = new ChartIndicators(chart as unknown as Chart);

    indicators.rafraichirHauteurs();

    expect(chart.setPaneOptions).toHaveBeenCalled();
    const idsRognes = chart.setPaneOptions.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(idsRognes).toContain("axiom_revenue");
    expect(idsRognes).toContain("axiom_macro");
    for (const call of chart.setPaneOptions.mock.calls) {
      const opts = call[0] as { id: string; height: number };
      expect(opts.height).toBeLessThan(100);
      expect(opts.height).toBeGreaterThanOrEqual(60);
    }
  });

  it("ne touche à rien quand un pane annexe existe mais que le prix n'est pas étouffé (filet passif)", () => {
    // Prix largement doté (800) + un seul pane annexe (100) : utile 900, budget 495
    // (900*0,55), total des annexes 100 ≤ 495 → rien à corriger, aucune écriture.
    const tailles: Record<string, { height: number }> = {
      candle_pane: { height: 800 },
      axiom_revenue: { height: 100 },
    };
    const chart = {
      createIndicator: vi.fn(() => null),
      overrideIndicator: vi.fn(),
      removeIndicator: vi.fn(),
      getSize: vi.fn((paneId: string) => tailles[paneId] ?? null),
      setPaneOptions: vi.fn(),
    };
    const indicators = new ChartIndicators(chart as unknown as Chart);

    indicators.rafraichirHauteurs();

    expect(chart.setPaneOptions).not.toHaveBeenCalled();
  });
});
