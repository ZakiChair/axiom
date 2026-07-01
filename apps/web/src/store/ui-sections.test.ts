/**
 * Tests du store d'état replié des sections de la sidebar. Logique pure (pas de DOM) :
 * on vérifie le repli/dépli à partir du `defaultOpen` fourni, le forçage, et le
 * remplacement intégral de la carte (application de workspace / restauration).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { uiSectionsStore } from "./ui-sections";

beforeEach(() => {
  uiSectionsStore.setState({ open: {} });
});

describe("uiSectionsStore", () => {
  it("toggle part du défaut fourni quand la section n'a jamais été (dé)pliée", () => {
    // Section jamais touchée, défaut = replié (false) -> toggle => ouvert (true).
    uiSectionsStore.getState().toggle("Alertes", false);
    expect(uiSectionsStore.getState().open.Alertes).toBe(true);
    // Re-toggle depuis l'état mémorisé -> revient à false.
    uiSectionsStore.getState().toggle("Alertes", false);
    expect(uiSectionsStore.getState().open.Alertes).toBe(false);
  });

  it("toggle depuis un défaut ouvert (true) referme d'abord", () => {
    // Watchlist ouverte par défaut : un premier toggle doit la refermer.
    uiSectionsStore.getState().toggle("Watchlist", true);
    expect(uiSectionsStore.getState().open.Watchlist).toBe(false);
  });

  it("setOpen force l'état d'une section", () => {
    uiSectionsStore.getState().setOpen("Macro", true);
    expect(uiSectionsStore.getState().open.Macro).toBe(true);
    uiSectionsStore.getState().setOpen("Macro", false);
    expect(uiSectionsStore.getState().open.Macro).toBe(false);
  });

  it("setAll REMPLACE toute la carte (les clés absentes disparaissent)", () => {
    uiSectionsStore.getState().setOpen("A", true);
    uiSectionsStore.getState().setAll({ B: false });
    expect(uiSectionsStore.getState().open).toEqual({ B: false }); // A évincée
  });
});
