/**
 * Tests de alertsStore — logique de conteneur (création, bascule, suppression,
 * FUSION par id des mises à jour du moteur, journal borné). S'exécute en env node :
 * `localStorage` est absent → la persistance interne est un no-op silencieux (couvert
 * par les try/catch du store), ce qui n'affecte pas la logique testée ici.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AlertDef, Declenchement } from "@axiom/alerts";
import {
  alertePrixAuNiveau,
  alertsStore,
  arrondirNiveauAlerte,
  type NouvelleAlerte,
} from "./alerts";

const NOUVELLE: NouvelleAlerte = {
  symbol: "btcusdt",
  source: "binance",
  condition: { type: "prix-croise", niveau: 100, sens: "hausse" },
};

beforeEach(() => {
  alertsStore.setState({ defs: [], journal: [] });
});

describe("alertePrixAuNiveau (pur)", () => {
  it("construit une condition prix-croise normalisée", () => {
    const a = alertePrixAuNiveau("btcusdt", "binance", 42_150.5, "hausse");
    expect(a.symbol).toBe("BTCUSDT");
    expect(a.source).toBe("binance");
    expect(a.condition).toEqual({ type: "prix-croise", niveau: 42_150.5, sens: "hausse" });
    expect(a.message).toBeUndefined();
  });

  it("accepte sens baisse / les-deux et message optionnel", () => {
    const b = alertePrixAuNiveau("ethusdt", "coinbase", 3_200, "baisse", "SR");
    expect(b.condition).toEqual({ type: "prix-croise", niveau: 3_200, sens: "baisse" });
    expect(b.message).toBe("SR");
    const c = alertePrixAuNiveau("SOLUSDT", "binance", 100, "les-deux");
    expect(c.condition.type).toBe("prix-croise");
    if (c.condition.type === "prix-croise") expect(c.condition.sens).toBe("les-deux");
  });

  it("est consommable par alertsStore.ajouter", () => {
    alertsStore.getState().ajouter(alertePrixAuNiveau("btc", "binance", 99, "les-deux"));
    const d = alertsStore.getState().defs[0];
    expect(d?.symbol).toBe("BTC");
    expect(d?.condition).toEqual({ type: "prix-croise", niveau: 99, sens: "les-deux" });
    expect(d?.actif).toBe(true);
  });
});

describe("arrondirNiveauAlerte (pur)", () => {
  it("arrondit selon la magnitude (~5 sig, 2–8 décimales)", () => {
    expect(arrondirNiveauAlerte(42150.123456)).toBe(42150.12); // 2 déc. (~42k)
    expect(arrondirNiveauAlerte(1.234567)).toBe(1.2346); // 4 déc. (~1)
    // 0.00123456 → log10≈-2.91 → floor -3 → 7 décimales
    expect(arrondirNiveauAlerte(0.00123456)).toBe(0.0012346);
  });

  it("gère zéro et non-finis", () => {
    expect(arrondirNiveauAlerte(0)).toBe(0);
    expect(Number.isNaN(arrondirNiveauAlerte(Number.NaN))).toBe(true);
  });
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
