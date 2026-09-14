/**
 * Tests du fournisseur COMPOSITE des overlays de niveaux (chart/niveaux/composite.ts) :
 * abonnement des seules sources dont la bascule est ON, réutilisation de l'instance d'une
 * source après OFF → ON (son mémo survit), agrégation des lignes des sources actives,
 * libération complète au désabonnement, et fusion PURE des niveaux de même prix.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { creerFournisseurComposite, fusionnerLignes, type FabriqueSource } from "./composite";
import type { NiveauxOverlaysState } from "../niveauxOverlays";
import type { LigneNiveau } from "../niveauxLignes";

const CTX = { exchange: "binance" as const, symbol: "BTCUSDT" };

function ligne(price: number, label: string, emphase: LigneNiveau["emphase"] = "forte", couleur = "--text-dim"): LigneNiveau {
  return { price, label, couleur, emphase };
}

/** Store isolé de même forme que le store réel (les familles ne sont pas testées ici). */
function storeIsole(): StoreApi<NiveauxOverlaysState> {
  return createStore<NiveauxOverlaysState>((set, get) => ({
    niveauxCles: false,
    familles: ["J", "S"],
    basculer: (cle) => set({ [cle]: !get()[cle] } as Partial<NiveauxOverlaysState>),
    setActif: (cle, actif) => set({ [cle]: actif } as Partial<NiveauxOverlaysState>),
    basculerFamille: () => {},
    setFamilles: (familles) => set({ familles: [...familles] }),
  }));
}

/** Source factice instrumentée. */
function sourceFactice(lignes: LigneNiveau[]) {
  const c = { creations: 0, abonnements: 0, desabonnements: 0 };
  const fabrique: FabriqueSource = () => {
    c.creations += 1;
    return {
      getLignes: () => lignes,
      subscribe: () => {
        c.abonnements += 1;
        return () => {
          c.desabonnements += 1;
        };
      },
    };
  };
  return { c, fabrique };
}

let store: StoreApi<NiveauxOverlaysState>;
beforeEach(() => {
  store = storeIsole();
});

describe("creerFournisseurComposite", () => {
  it("OFF : aucune source créée ni abonnée ; ON : abonnement et agrégation", () => {
    const src = sourceFactice([ligne(10, "PDH")]);
    const f = creerFournisseurComposite(CTX, { niveauxCles: src.fabrique }, store);
    let notifs = 0;
    const unsub = f.subscribe(() => {
      notifs += 1;
    });
    expect(src.c.creations).toBe(0);
    expect(f.getLignes()).toEqual([]);

    store.getState().setActif("niveauxCles", true);
    expect(src.c.creations).toBe(1);
    expect(src.c.abonnements).toBe(1);
    expect(notifs).toBeGreaterThanOrEqual(2);
    expect(f.getLignes()).toEqual([ligne(10, "PDH")]);
    unsub();
    expect(src.c.desabonnements).toBe(1);
  });

  it("OFF désabonne, ré-ON réutilise la même instance", () => {
    const src = sourceFactice([ligne(10, "PDH")]);
    store.getState().setActif("niveauxCles", true);
    const f = creerFournisseurComposite(CTX, { niveauxCles: src.fabrique }, store);
    const unsub = f.subscribe(() => {});
    expect(src.c.abonnements).toBe(1);

    store.getState().setActif("niveauxCles", false);
    expect(src.c.desabonnements).toBe(1);
    expect(f.getLignes()).toEqual([]);

    store.getState().setActif("niveauxCles", true);
    expect(src.c.creations).toBe(1);
    expect(src.c.abonnements).toBe(2);
    unsub();
    expect(src.c.desabonnements).toBe(2);
  });

  it("un changement de familles notifie sans réabonner la source", () => {
    const src = sourceFactice([ligne(10, "PDH")]);
    store.getState().setActif("niveauxCles", true);
    const f = creerFournisseurComposite(CTX, { niveauxCles: src.fabrique }, store);
    let notifs = 0;
    const unsub = f.subscribe(() => {
      notifs += 1;
    });
    const avant = notifs;
    store.getState().setFamilles(["J", "S", "M"]);
    expect(notifs).toBe(avant + 1);
    expect(src.c.abonnements).toBe(1);
    unsub();
  });

  it("le désabonnement global libère aussi l'écoute du store", () => {
    const src = sourceFactice([ligne(10, "PDH")]);
    const f = creerFournisseurComposite(CTX, { niveauxCles: src.fabrique }, store);
    let notifs = 0;
    const unsub = f.subscribe(() => {
      notifs += 1;
    });
    unsub();
    const avant = notifs;
    store.getState().setActif("niveauxCles", true);
    expect(notifs).toBe(avant);
    expect(src.c.abonnements).toBe(0);
  });
});

describe("fusionnerLignes", () => {
  it("fusionne les niveaux de même prix : « PDC·OJ·OS », forte prioritaire, couleur de la première", () => {
    const fusion = fusionnerLignes([
      ligne(76842.01, "PDC", "faible", "--text-dim"),
      ligne(76842.01, "OJ", "faible", "--accent"),
      ligne(77450, "PDH"),
      ligne(76842.01, "OS", "forte", "--accent"),
    ]);
    expect(fusion).toEqual([
      { price: 76842.01, label: "PDC·OJ·OS", couleur: "--text-dim", emphase: "forte" },
      ligne(77450, "PDH"),
    ]);
  });

  it("laisse intacts les prix distincts et écarte les prix non finis ou ≤ 0", () => {
    expect(
      fusionnerLignes([
        ligne(100, "A"),
        ligne(100.01, "B"),
        ligne(Number.NaN, "C"),
        ligne(Number.POSITIVE_INFINITY, "D"),
        ligne(0, "E"),
      ]),
    ).toEqual([ligne(100, "A"), ligne(100.01, "B")]);
  });

  it("liste vide → []", () => {
    expect(fusionnerLignes([])).toEqual([]);
  });
});
