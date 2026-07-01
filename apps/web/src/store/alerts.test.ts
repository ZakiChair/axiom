/**
 * Tests de alertsStore — logique de conteneur (création, bascule, suppression,
 * FUSION par id des mises à jour du moteur, journal borné). S'exécute en env node :
 * `localStorage` est absent → la persistance interne est un no-op silencieux (couvert
 * par les try/catch du store), ce qui n'affecte pas la logique testée ici.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AlertDef, Declenchement } from "@axiom/alerts";
import { alertsStore, type NouvelleAlerte } from "./alerts";

const NOUVELLE: NouvelleAlerte = {
  symbol: "btcusdt",
  source: "binance",
  condition: { type: "prix-croise", niveau: 100, sens: "hausse" },
};

beforeEach(() => {
  alertsStore.setState({ defs: [], journal: [] });
});

describe("ajouter", () => {
  it("crée une def active, non calibrée, avec symbole normalisé et id", () => {
    alertsStore.getState().ajouter(NOUVELLE);
    const d = alertsStore.getState().defs[0];
    expect(d?.symbol).toBe("BTCUSDT");
    expect(d?.actif).toBe(true);
    expect(d?.arme).toBeUndefined(); // calibrage à la première évaluation
    expect(d?.declenchements).toEqual([]);
    expect(typeof d?.id).toBe("string");
  });
});

describe("basculerActif / supprimer", () => {
  it("bascule l'état actif d'une def par id", () => {
    alertsStore.getState().ajouter(NOUVELLE);
    const id = alertsStore.getState().defs[0]?.id ?? "";
    alertsStore.getState().basculerActif(id);
    expect(alertsStore.getState().defs[0]?.actif).toBe(false);
    alertsStore.getState().basculerActif(id);
    expect(alertsStore.getState().defs[0]?.actif).toBe(true);
  });

  it("supprime une def par id", () => {
    alertsStore.getState().ajouter(NOUVELLE);
    const id = alertsStore.getState().defs[0]?.id ?? "";
    alertsStore.getState().supprimer(id);
    expect(alertsStore.getState().defs).toHaveLength(0);
  });
});

describe("appliquerMisesAJour (fusion par id)", () => {
  it("remplace les defs de même id et n'en ressuscite aucune supprimée", () => {
    const a: AlertDef = {
      id: "x",
      symbol: "BTCUSDT",
      source: "binance",
      condition: { type: "prix-croise", niveau: 100, sens: "hausse" },
      actif: true,
      declenchements: [],
    };
    alertsStore.setState({ defs: [a], journal: [] });

    // Le moteur renvoie une version armée + une def d'id inconnu (déjà supprimée).
    const majPresente: AlertDef = { ...a, arme: false, declenchements: [1000] };
    const majFantome: AlertDef = { ...a, id: "supprimee" };
    alertsStore.getState().appliquerMisesAJour([majPresente, majFantome]);

    const defs = alertsStore.getState().defs;
    expect(defs).toHaveLength(1); // le fantôme n'est PAS ajouté
    expect(defs[0]?.arme).toBe(false);
    expect(defs[0]?.declenchements).toEqual([1000]);
  });
});

describe("journal", () => {
  it("empile en tête et borne à 100 entrées", () => {
    for (let i = 0; i < 105; i++) {
      const d: Declenchement = { alertId: "x", ts: i, valeur: i, message: `m${i}` };
      alertsStore.getState().ajouterJournal(d);
    }
    const j = alertsStore.getState().journal;
    expect(j).toHaveLength(100);
    expect(j[0]?.ts).toBe(104); // plus récent en tête
    alertsStore.getState().viderJournal();
    expect(alertsStore.getState().journal).toHaveLength(0);
  });
});
