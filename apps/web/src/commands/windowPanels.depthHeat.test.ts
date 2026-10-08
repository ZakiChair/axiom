/**
 * Commande ⌘K BOOK (heatmap de liquidité du carnet) : `chart/depthHeat` est un module
 * DIFFÉRÉ (garde-fou : chargementInitial.test.ts) — la commande le charge par `import()`
 * puis bascule son store. On vérifie ici l'ordre (module chargé AVANT la bascule, pour que
 * le contrôleur de souscription, démarré à l'import, écoute la bascule) et que les appels
 * suivants ne font que basculer (module déjà évalué).
 *
 * Environnement vitest node : `chart/depthHeat` remplacé par un espion (le vrai tire
 * klinecharts et le thème) ; `windowManagerStore` neutralisé comme dans les tests voisins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { basculerSpy, evaluations } = vi.hoisted(() => ({
  basculerSpy: vi.fn(),
  evaluations: { depthHeat: 0 },
}));

vi.mock("../chart/depthHeat", () => {
  evaluations.depthHeat += 1;
  return { depthHeatStore: { getState: () => ({ actif: false, rev: 0, basculer: basculerSpy }) } };
});

vi.mock("../store/windowManager", async (importOriginal) => {
  const reel = await importOriginal<typeof import("../store/windowManager")>();
  return {
    ...reel,
    windowManagerStore: {
      getState: () => ({
        openWindow: () => {},
        toggleWindow: () => {},
        minimizeAll: () => {},
        restoreAll: () => {},
        tileOpenWindows: () => {},
        cascadeAll: () => {},
        closeAll: () => {},
      }),
    },
  };
});

import { commandesDepthHeat } from "./windowPanels";

function commandeBook() {
  const cmd = commandesDepthHeat.find((c) => c.id === "action:depth-heat");
  if (!cmd) throw new Error("commande action:depth-heat absente de commandesDepthHeat");
  return cmd;
}

describe("palette ⌘K : BOOK charge chart/depthHeat à la demande", () => {
  beforeEach(() => {
    basculerSpy.mockClear();
  });

  it("BOOK : mnémonique, catégorie et mots-clés", () => {
    const cmd = commandeBook();
    expect(cmd.mnemonique).toBe("BOOK");
    expect(cmd.categorie).toBe("action");
    expect(cmd.motsCles).toEqual(expect.arrayContaining(["book", "carnet", "orderbook", "bookmap"]));
  });

  it("importer windowPanels ne charge PAS chart/depthHeat (module différé)", () => {
    expect(evaluations.depthHeat).toBe(0);
  });

  it("l'action charge le module PUIS bascule le store", async () => {
    commandeBook().action();
    // Bascule asynchrone : rien avant la résolution de l'import().
    expect(basculerSpy).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(basculerSpy).toHaveBeenCalledTimes(1));
    expect(evaluations.depthHeat).toBe(1);
  });

  it("les appels suivants ne font que basculer (module déjà évalué)", async () => {
    commandeBook().action();
    await vi.waitFor(() => expect(basculerSpy).toHaveBeenCalledTimes(1));
    commandeBook().action();
    await vi.waitFor(() => expect(basculerSpy).toHaveBeenCalledTimes(2));
    expect(evaluations.depthHeat).toBe(1);
  });
});
