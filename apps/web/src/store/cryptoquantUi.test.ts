/**
 * Magasin d'INTENTION des deux sections CryptoQuant (CQTAKR / CQMINE) — décision du
 * propriétaire du 2026-09-18 : deux entrées de NAVIGATION vers des sections déjà livrées,
 * aucune fenêtre nouvelle.
 *
 * Environnement vitest node : localStorage bouchonné en mémoire (patron
 * store/cryptoquant.test.ts) pour observer le marquage « vue » du badge. Le gestionnaire de
 * fenêtres est remplacé par un espion sur `openWindow` — le magasin ne doit toucher que lui
 * (aucun DOM, aucun composant).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fenetresOuvertes } = vi.hoisted(() => ({ fenetresOuvertes: [] as string[] }));

vi.mock("./windowManager", async (importOriginal) => {
  const reel = await importOriginal<typeof import("./windowManager")>();
  return {
    ...reel,
    windowManagerStore: {
      getState: () => ({
        openWindow: (id: string) => {
          fenetresOuvertes.push(id);
        },
      }),
    },
  };
});

function stockage(): Storage {
  const valeurs = new Map<string, string>();
  return {
    getItem: (k) => valeurs.get(k) ?? null,
    setItem: (k, v) => void valeurs.set(k, v),
    removeItem: (k) => void valeurs.delete(k),
    clear: () => valeurs.clear(),
    key: (i) => [...valeurs.keys()][i] ?? null,
    get length() {
      return valeurs.size;
    },
  };
}

describe("magasin d'intention CryptoQuant", () => {
  beforeEach(() => {
    fenetresOuvertes.length = 0;
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("démarre sans cible", async () => {
    const { cryptoquantUiStore } = await import("./cryptoquantUi");
    expect(cryptoquantUiStore.getState().cible).toBeNull();
  });

  it("demander(« takers ») ouvre DES et pose la cible", async () => {
    const { cryptoquantUiStore } = await import("./cryptoquantUi");
    cryptoquantUiStore.getState().demander("takers");
    expect(fenetresOuvertes).toEqual(["derivatives"]);
    expect(cryptoquantUiStore.getState().cible).toBe("takers");
  });

  it("demander(« mineurs ») ouvre CHAIN et pose la cible", async () => {
    const { cryptoquantUiStore } = await import("./cryptoquantUi");
    cryptoquantUiStore.getState().demander("mineurs");
    expect(fenetresOuvertes).toEqual(["onchain"]);
    expect(cryptoquantUiStore.getState().cible).toBe("mineurs");
  });

  it("demander marque la section VUE : le badge « nouveau » disparaît", async () => {
    const { cryptoquantUiStore, ENTREES_CQ } = await import("./cryptoquantUi");
    const { estNouvelle } = await import("./windowManager");
    expect(estNouvelle(ENTREES_CQ.takers.badge)).toBe(true);
    expect(estNouvelle(ENTREES_CQ.mineurs.badge)).toBe(true);
    cryptoquantUiStore.getState().demander("takers");
    expect(estNouvelle(ENTREES_CQ.takers.badge)).toBe(false);
    // Une demande ne marque QUE sa section : l'autre badge reste.
    expect(estNouvelle(ENTREES_CQ.mineurs.badge)).toBe(true);
  });

  it("source unique des deux entrées : mnémonique, libellé, clé de badge et fenêtre hôte", async () => {
    const { ENTREES_CQ } = await import("./cryptoquantUi");
    expect(ENTREES_CQ).toEqual({
      takers: {
        mnemonique: "CQTAKR",
        libelle: "Flux takers toutes places (CryptoQuant)",
        // Préfixe « section: » : aucune fenêtre du registre ne porte cette clé de badge.
        badge: "section:cq-takers",
        fenetre: "derivatives",
      },
      mineurs: {
        mnemonique: "CQMINE",
        libelle: "Production des mineurs cotés (CryptoQuant)",
        badge: "section:cq-mineurs",
        fenetre: "onchain",
      },
    });
  });

  it("consommer efface sa propre cible", async () => {
    const { cryptoquantUiStore } = await import("./cryptoquantUi");
    cryptoquantUiStore.getState().demander("takers");
    cryptoquantUiStore.getState().consommer("takers");
    expect(cryptoquantUiStore.getState().cible).toBeNull();
  });

  it("consommer n'efface PAS la demande d'une autre section", async () => {
    const { cryptoquantUiStore } = await import("./cryptoquantUi");
    cryptoquantUiStore.getState().demander("mineurs");
    // DES resté ouvert consomme au montage : la demande CHAIN doit survivre.
    cryptoquantUiStore.getState().consommer("takers");
    expect(cryptoquantUiStore.getState().cible).toBe("mineurs");
  });

  it("consommer sans demande en cours ne lève pas et laisse la cible nulle", async () => {
    const { cryptoquantUiStore } = await import("./cryptoquantUi");
    cryptoquantUiStore.getState().consommer("takers");
    expect(cryptoquantUiStore.getState().cible).toBeNull();
  });

  it("stockage indisponible : demander ouvre quand même la fenêtre", async () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new DOMException("refusé", "SecurityError");
      },
      getItem: () => null,
    });
    const { cryptoquantUiStore } = await import("./cryptoquantUi");
    expect(() => cryptoquantUiStore.getState().demander("mineurs")).not.toThrow();
    expect(fenetresOuvertes).toEqual(["onchain"]);
    expect(cryptoquantUiStore.getState().cible).toBe("mineurs");
  });
});
