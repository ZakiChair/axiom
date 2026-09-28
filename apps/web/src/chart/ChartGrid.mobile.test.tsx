import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { chartLayoutStore } from "../store/chart-layout";
import { ChartGrid } from "./ChartGrid";

const mode = vi.hoisted(() => ({ mobile: true }));
vi.mock("../hooks/useMobileLayout", () => ({ useMobileLayout: () => mode.mobile }));
// Le canvas et BroadcastChannel exigent un navigateur ; la navigation et les
// conteneurs accessibles restent ceux du vrai composant ChartGrid.
vi.mock("./Chart", () => ({ Chart: () => null }));
vi.mock("./ChartInstance", () => ({ ChartInstance: () => null }));
vi.mock("./drawing", () => ({ setFocusChart: () => {} }));
vi.mock("../store/sync", () => ({ demarrerSyncFenetres: () => () => {} }));

beforeEach(() => {
  mode.mobile = true;
  chartLayoutStore.setState({ layout: "2x2", focus: 2, linked: false });
  // Le rendu serveur lit le snapshot initial ; simule une grille déjà restaurée.
  vi.spyOn(chartLayoutStore, "getInitialState").mockImplementation(chartLayoutStore.getState);
});
afterEach(() => vi.restoreAllMocks());

describe("grille téléphone", () => {
  it("rend accessible seulement le graphe focalisé tout en conservant les quatre instances et la disposition", () => {
    const html = renderToStaticMarkup(<ChartGrid />);
    expect(html.match(/data-chart-slot="\d"/g)).toHaveLength(4);
    expect(html.match(/data-chart-slot="\d"[^>]*aria-hidden="true"/g)).toHaveLength(3);
    expect(html).toMatch(/data-chart-slot="2"[^>]*aria-hidden="false"/);
    expect(html).toContain('aria-label="Vues du graphique"');
    expect(chartLayoutStore.getState().layout).toBe("2x2");
    expect(chartLayoutStore.getState().focus).toBe(2);
  });

  it("rend toutes les vues accessibles sur bureau, sans navigation mobile", () => {
    mode.mobile = false;
    const html = renderToStaticMarkup(<ChartGrid />);
    expect(html.match(/data-chart-slot="\d"[^>]*aria-hidden="false"/g)).toHaveLength(4);
    expect(html).not.toContain('aria-label="Vues du graphique"');
  });
});
