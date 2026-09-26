/**
 * SIG et MACRO chargent leur store par import() (hors du chargement initial). Un chunk
 * introuvable (déploiement entre-temps, coupure réseau) ne doit jamais rendre la commande
 * muette : la fenêtre s'ouvre quand même, l'échec est signalé en console.
 */
import { describe, it, expect, vi } from "vitest";

// Mêmes neutralisations que registry.test.ts (modules à effet de bord hors navigateur).
vi.mock("../store/theme", () => ({
  THEMES: ["dark", "bloomberg", "matrix", "cute", "aurora"] as const,
  themeStore: { getState: () => ({ theme: "dark", setTheme: () => {} }), subscribe: () => () => {} },
}));
vi.mock("../chart/drawing", () => ({ exportChartImage: () => {}, clearAllOverlays: () => {}, getActiveChart: () => null, setFocusChart: () => {} }));
vi.mock("klinecharts", () => ({ registerOverlay: () => {}, ActionType: {}, DomPosition: {} }));
// Chunks introuvables : l'import dynamique rejette.
vi.mock("../store/signaux", () => { throw new Error("chunk introuvable"); });
vi.mock("../store/macroRatesView", () => { throw new Error("chunk introuvable"); });

import { windowManagerStore } from "../store/windowManager";
import { commandesSignaux } from "./windowPanels";
import { construireRegistre } from "./registry";

describe("commandes à store différé : chunk introuvable", () => {
  it.each([
    ["SIG", () => commandesSignaux.find((c) => c.id === "panneau:signaux"), "screener"],
    ["MACRO", () => construireRegistre().find((c) => c.id === "panneau:macro"), "macroRates"],
  ] as const)("%s ouvre quand même sa fenêtre et signale l'échec", async (_nom, commande, fenetre) => {
    const ouvrir = vi.spyOn(windowManagerStore.getState(), "openWindow").mockImplementation(() => {});
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    commande()?.action();
    await vi.waitFor(() => expect(ouvrir).toHaveBeenCalledWith(fenetre));
    expect(avertir).toHaveBeenCalled();
    ouvrir.mockRestore();
    avertir.mockRestore();
  });
});
