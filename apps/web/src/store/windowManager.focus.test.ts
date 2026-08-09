/**
 * Sémantique « focus d'abord » des mnémoniques (revue du 2026-08-01 § 3.6).
 *
 * Contrat Bloomberg : taper une fonction, c'est Y ALLER. Or `toggleWindow` fermait
 * toute fenêtre ouverte sans regarder son z — avec trois fenêtres empilées, taper CORR
 * dans ⌘K pour REVENIR à la matrice enfouie la faisait disparaître. Le menu Fonctions,
 * lui, appelle `openWindow` et la remonte : même mnémonique, deux effets opposés selon
 * le point d'entrée, alors que la barre d'outils annonce « mêmes mnémoniques dans ⌘K ».
 *
 * 28 commandes de la palette passent par `basculer()` → `toggleWindow`, plus une
 * dizaine de `toggleX` de stores : corriger la sémantique ICI les couvre toutes.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { windowManagerStore } from "./windowManager";

const etat = () => windowManagerStore.getState();
const fenetre = (id: string) => etat().windows[id];
// L'API du STORE, pas une copie locale de son implémentation : un helper recopié
// resterait vert même si `fenetreFocalisee` régressait (revue adversariale BCD).
const focalisee = (): string | null => etat().fenetreFocalisee();

beforeEach(() => {
  windowManagerStore.setState({ windows: {}, nextZ: 1 });
});

describe("toggleWindow — focus d'abord", () => {
  it("ouvre une fenêtre fermée", () => {
    etat().toggleWindow("corr");
    expect(fenetre("corr")?.open).toBe(true);
  });

  it("RESTAURE une fenêtre minimisée (ne la ferme pas)", () => {
    etat().toggleWindow("corr");
    etat().minimizeWindow("corr");
    etat().toggleWindow("corr");
    expect(fenetre("corr")?.open).toBe(true);
    expect(fenetre("corr")?.minimized).toBe(false);
  });

  it("FOCALISE une fenêtre ouverte mais ENFOUIE — c'est le cœur du correctif", () => {
    etat().toggleWindow("corr");
    etat().toggleWindow("eco");
    etat().toggleWindow("news"); // news au premier plan, corr enfouie
    expect(focalisee()).toBe("news");

    etat().toggleWindow("corr");
    expect(fenetre("corr")?.open).toBe(true); // pas fermée…
    expect(focalisee()).toBe("corr"); // …mais remontée
  });

  it("ne ferme QUE la fenêtre déjà au premier plan", () => {
    etat().toggleWindow("corr");
    etat().toggleWindow("eco");
    expect(focalisee()).toBe("eco");
    etat().toggleWindow("eco");
    expect(fenetre("eco")?.open).toBe(false);
    expect(fenetre("corr")?.open).toBe(true);
  });

  it("aller-retour complet : ouvrir, enfouir, revenir, fermer", () => {
    etat().toggleWindow("corr");
    etat().toggleWindow("eco");
    etat().toggleWindow("corr"); // remonte corr
    expect(focalisee()).toBe("corr");
    etat().toggleWindow("corr"); // maintenant au premier plan → ferme
    expect(fenetre("corr")?.open).toBe(false);
  });

  it("une seule fenêtre ouverte : le second appel la ferme (pas de blocage)", () => {
    etat().toggleWindow("corr");
    etat().toggleWindow("corr");
    expect(fenetre("corr")?.open).toBe(false);
  });

  it("ignore un id absent du registre", () => {
    expect(() => etat().toggleWindow("inexistant")).not.toThrow();
  });
});

describe("cycleFocus — rotation clavier entre fenêtres", () => {
  it("ne fait rien sans fenêtre ouverte", () => {
    expect(() => etat().cycleFocus()).not.toThrow();
    expect(focalisee()).toBeNull();
  });

  it("passe à la fenêtre suivante par z croissant, puis boucle", () => {
    etat().toggleWindow("corr");
    etat().toggleWindow("eco");
    etat().toggleWindow("news"); // z : corr < eco < news
    expect(focalisee()).toBe("news");
    etat().cycleFocus();
    expect(focalisee()).toBe("corr"); // la plus enfouie remonte
    etat().cycleFocus();
    expect(focalisee()).toBe("eco");
  });

  it("saute les fenêtres minimisées", () => {
    etat().toggleWindow("corr");
    etat().toggleWindow("eco");
    etat().toggleWindow("news");
    etat().minimizeWindow("eco");
    etat().cycleFocus();
    expect(focalisee()).toBe("corr");
    etat().cycleFocus();
    expect(focalisee()).toBe("news"); // eco est réduite : ignorée
  });
});
