/**
 * Filet de hauteur (equilibrerHauteurs) : les panes créés HORS du contrôleur
 * d'indicateurs (CVD, CVD S/P, OI, funding, comparaison — ids déterministes) doivent
 * entrer dans le budget, sinon 5 panes annexes écrasent le pane prix sans que le filet
 * ne voie rien (même symptôme que le « pane prix à 4 px » de la revue § 3.4). Harnais
 * calqué sur indicators.symbolSwitch.test.ts (chart mocké, aucun DOM).
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
});
