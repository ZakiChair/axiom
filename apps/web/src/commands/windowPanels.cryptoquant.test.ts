/**
 * Commandes ⌘K des deux entrées de NAVIGATION CryptoQuant (décision du 2026-09-18) :
 * CQTAKR → section « Flux takers » de DES, CQMINE → sous-section « Production des mineurs
 * cotés » de CHAIN. Aucune fenêtre nouvelle : les commandes posent une cible dans le
 * magasin d'intention, qui ouvre la fenêtre hôte.
 *
 * Environnement vitest node : `windowManagerStore` remplacé par un espion (`openWindow`
 * lirait `window.innerWidth`). Le magasin d'intention, lui, est le vrai.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fenetresOuvertes } = vi.hoisted(() => ({ fenetresOuvertes: [] as string[] }));

vi.mock("../store/windowManager", async (importOriginal) => {
  const reel = await importOriginal<typeof import("../store/windowManager")>();
  return {
    ...reel,
    windowManagerStore: {
      getState: () => ({
        openWindow: (id: string) => {
          fenetresOuvertes.push(id);
        },
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

import { cryptoquantUiStore } from "../store/cryptoquantUi";
import { windowPanelCommands } from "./windowPanels";

function commande(id: string) {
  const cmd = windowPanelCommands.find((c) => c.id === id);
  if (!cmd) throw new Error(`commande ${id} absente de windowPanelCommands`);
  return cmd;
}

describe("palette ⌘K : navigation vers les sections CryptoQuant", () => {
  beforeEach(() => {
    fenetresOuvertes.length = 0;
    cryptoquantUiStore.setState({ cible: null });
  });

  it("CQTAKR : mnémonique, libellé et aperçu de l'action", () => {
    const cmd = commande("panneau:cq-takers");
    expect(cmd.mnemonique).toBe("CQTAKR");
    expect(cmd.libelle).toBe("Flux takers toutes places (CryptoQuant)");
    expect(cmd.categorie).toBe("panneau");
    expect(cmd.apercu ?? "").toMatch(/DES/);
    expect(cmd.motsCles).toEqual(expect.arrayContaining(["takers", "flux", "cryptoquant", "vwap"]));
  });

  it("CQMINE : mnémonique, libellé et aperçu de l'action", () => {
    const cmd = commande("panneau:cq-mineurs");
    expect(cmd.mnemonique).toBe("CQMINE");
    expect(cmd.libelle).toBe("Production des mineurs cotés (CryptoQuant)");
    expect(cmd.categorie).toBe("panneau");
    expect(cmd.apercu ?? "").toMatch(/CHAIN/);
    expect(cmd.motsCles).toEqual(expect.arrayContaining(["mineurs", "cotes", "mara", "riot", "cryptoquant"]));
  });

  it("mnémoniques de six caractères au plus (largeur du token de la palette)", () => {
    for (const id of ["panneau:cq-takers", "panneau:cq-mineurs"]) {
      const mnemo = commande(id).mnemonique ?? "";
      expect(mnemo.length, mnemo).toBeLessThanOrEqual(6);
    }
  });

  it("CQTAKR ouvre DES et pose la cible « takers »", () => {
    commande("panneau:cq-takers").action();
    expect(fenetresOuvertes).toEqual(["derivatives"]);
    expect(cryptoquantUiStore.getState().cible).toBe("takers");
  });

  it("CQMINE ouvre CHAIN et pose la cible « mineurs »", () => {
    commande("panneau:cq-mineurs").action();
    expect(fenetresOuvertes).toEqual(["onchain"]);
    expect(cryptoquantUiStore.getState().cible).toBe("mineurs");
  });
});
