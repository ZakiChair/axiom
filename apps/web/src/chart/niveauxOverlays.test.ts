/**
 * Tests du socle des overlays de niveaux (chart/niveauxOverlays.ts) : bascules persistables
 * (défaut OFF), familles des niveaux clés (jamais vides, ordre canonique), commandes de
 * palette et enveloppe PARESSEUSE du fournisseur (le code des sources n'est chargé qu'à la
 * première activation ; un désabonnement avant le chargement n'abonne jamais la source).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  FAMILLES_NIVEAUX_CLES,
  commandesNiveauxOverlays,
  creerFournisseurNiveauxSlot,
  niveauxOverlaysStore,
  overlaysNiveauxActifs,
  type ContexteNiveaux,
} from "./niveauxOverlays";
import type { FournisseurLignes, LigneNiveau } from "./niveauxLignes";

beforeEach(() => {
  niveauxOverlaysStore.getState().setActif("niveauxCles", false);
  niveauxOverlaysStore.getState().setActif("niveauxOptions", false);
  niveauxOverlaysStore.getState().setFamilles(["J", "S"]);
});

describe("niveauxOverlaysStore — bascules et familles", () => {
  it("défaut OFF, familles J + S", () => {
    const s = niveauxOverlaysStore.getState();
    expect(s.niveauxCles).toBe(false);
    expect(s.niveauxOptions).toBe(false);
    expect(s.familles).toEqual(["J", "S"]);
    expect(overlaysNiveauxActifs(s)).toBe(false);
  });

  it("basculer / setActif pilotent la bascule et overlaysNiveauxActifs", () => {
    niveauxOverlaysStore.getState().basculer("niveauxCles");
    expect(niveauxOverlaysStore.getState().niveauxCles).toBe(true);
    expect(overlaysNiveauxActifs(niveauxOverlaysStore.getState())).toBe(true);
    niveauxOverlaysStore.getState().setActif("niveauxCles", false);
    expect(overlaysNiveauxActifs(niveauxOverlaysStore.getState())).toBe(false);
  });

  it("les niveaux d'options suffisent à activer l'overlay, indépendamment des niveaux clés", () => {
    niveauxOverlaysStore.getState().basculer("niveauxOptions");
    const s = niveauxOverlaysStore.getState();
    expect(s.niveauxOptions).toBe(true);
    expect(s.niveauxCles).toBe(false);
    expect(overlaysNiveauxActifs(s)).toBe(true);
  });

  it("basculerFamille ajoute en ordre canonique et allume les niveaux clés", () => {
    niveauxOverlaysStore.getState().basculerFamille("T");
    niveauxOverlaysStore.getState().basculerFamille("M");
    const s = niveauxOverlaysStore.getState();
    expect(s.familles).toEqual(["J", "S", "M", "T"]);
    expect(s.niveauxCles).toBe(true);
  });

  it("basculerFamille retire une famille mais refuse de vider la liste", () => {
    niveauxOverlaysStore.getState().basculerFamille("J");
    expect(niveauxOverlaysStore.getState().familles).toEqual(["S"]);
    niveauxOverlaysStore.getState().basculerFamille("S");
    expect(niveauxOverlaysStore.getState().familles).toEqual(["S"]);
  });

  it("setFamilles filtre les inconnues, réordonne et ignore une liste vide", () => {
    niveauxOverlaysStore.getState().setFamilles(["T", "X" as never, "J"]);
    expect(niveauxOverlaysStore.getState().familles).toEqual(["J", "T"]);
    niveauxOverlaysStore.getState().setFamilles([]);
    expect(niveauxOverlaysStore.getState().familles).toEqual(["J", "T"]);
    niveauxOverlaysStore.getState().setFamilles(["Z" as never]);
    expect(niveauxOverlaysStore.getState().familles).toEqual(["J", "T"]);
  });
});

describe("commandesNiveauxOverlays", () => {
  it("NIVCLE, une commande par famille et OPTNIV, ids et mnémoniques uniques", () => {
    const mnemos = commandesNiveauxOverlays.map((c) => c.mnemonique);
    expect(mnemos).toEqual(["NIVCLE", ...FAMILLES_NIVEAUX_CLES.map((f) => `NIVCLE-${f}`), "OPTNIV"]);
    expect(new Set(commandesNiveauxOverlays.map((c) => c.id)).size).toBe(commandesNiveauxOverlays.length);
  });

  it("NIVCLE bascule l'overlay, NIVCLE-M bascule la famille mois", () => {
    const parMnemo = (m: string) => commandesNiveauxOverlays.find((c) => c.mnemonique === m)!;
    parMnemo("NIVCLE").action();
    expect(niveauxOverlaysStore.getState().niveauxCles).toBe(true);
    parMnemo("NIVCLE").action();
    expect(niveauxOverlaysStore.getState().niveauxCles).toBe(false);
    parMnemo("NIVCLE-M").action();
    expect(niveauxOverlaysStore.getState().familles).toEqual(["J", "S", "M"]);
    expect(niveauxOverlaysStore.getState().niveauxCles).toBe(true);
  });

  it("OPTNIV bascule les niveaux d'options et rappelle la convention de signe", () => {
    const optniv = commandesNiveauxOverlays.find((c) => c.mnemonique === "OPTNIV")!;
    expect(optniv.apercu).toContain("calls + / puts −");
    optniv.action();
    expect(niveauxOverlaysStore.getState().niveauxOptions).toBe(true);
    expect(niveauxOverlaysStore.getState().niveauxCles).toBe(false);
    optniv.action();
    expect(niveauxOverlaysStore.getState().niveauxOptions).toBe(false);
  });
});

describe("creerFournisseurNiveauxSlot — enveloppe paresseuse", () => {
  const CTX: ContexteNiveaux = { exchange: "binance", symbol: "BTCUSDT" };
  const LIGNE: LigneNiveau = { price: 100, label: "PDH", couleur: "--text-dim", emphase: "forte" };

  /** Chargeur contrôlé : la promesse ne se résout que sur `resoudre()`. */
  function chargeurControle() {
    const compteurs = { chargements: 0, fabrications: 0, abonnements: 0, desabonnements: 0 };
    let notifierReel: (() => void) | null = null;
    const reel: FournisseurLignes = {
      getLignes: () => [LIGNE],
      subscribe(onChange) {
        compteurs.abonnements += 1;
        notifierReel = onChange;
        return () => {
          compteurs.desabonnements += 1;
        };
      },
    };
    let resoudre: () => void = () => {};
    const promesse = new Promise<(ctx: ContexteNiveaux) => FournisseurLignes>((res) => {
      resoudre = () =>
        res((ctx) => {
          expect(ctx).toEqual(CTX);
          compteurs.fabrications += 1;
          return reel;
        });
    });
    const charger = () => {
      compteurs.chargements += 1;
      return promesse;
    };
    return { compteurs, charger, resoudre: () => resoudre(), notifier: () => notifierReel?.() };
  }

  it("ne charge rien avant le premier abonnement et renvoie [] tant que non chargé", async () => {
    const c = chargeurControle();
    const f = creerFournisseurNiveauxSlot(CTX, c.charger);
    expect(c.compteurs.chargements).toBe(0);
    expect(f.getLignes()).toEqual([]);

    let notifications = 0;
    const unsub = f.subscribe(() => {
      notifications += 1;
    });
    expect(c.compteurs.chargements).toBe(1);
    expect(f.getLignes()).toEqual([]);

    c.resoudre();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.compteurs.fabrications).toBe(1);
    expect(c.compteurs.abonnements).toBe(1);
    expect(notifications).toBeGreaterThanOrEqual(1);
    expect(f.getLignes()).toEqual([LIGNE]);

    const avant = notifications;
    c.notifier();
    expect(notifications).toBe(avant + 1);

    unsub();
    expect(c.compteurs.desabonnements).toBe(1);
  });

  it("désabonnement AVANT résolution : jamais d'abonnement au fournisseur réel", async () => {
    const c = chargeurControle();
    const f = creerFournisseurNiveauxSlot(CTX, c.charger);
    let notifications = 0;
    const unsub = f.subscribe(() => {
      notifications += 1;
    });
    unsub();
    c.resoudre();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.compteurs.abonnements).toBe(0);
    expect(notifications).toBe(0);
  });

  it("réabonnement : le fournisseur réel est fabriqué une seule fois", async () => {
    const c = chargeurControle();
    const f = creerFournisseurNiveauxSlot(CTX, c.charger);
    c.resoudre();
    const u1 = f.subscribe(() => {});
    await Promise.resolve();
    await Promise.resolve();
    u1();
    const u2 = f.subscribe(() => {});
    await Promise.resolve();
    await Promise.resolve();
    u2();
    expect(c.compteurs.fabrications).toBe(1);
    expect(c.compteurs.abonnements).toBe(2);
    expect(c.compteurs.desabonnements).toBe(2);
  });
});
