/**
 * Tests de presetAlerts — fonctions PURES (diffEntrants, filtrerCooldown) et logique du
 * store (dérivation periodeMin, limite d'alertes actives, bascule/retrait, persistance
 * tolérante). Le runtime réseau (timers + scan) n'est PAS testé ici (convention repo).
 *
 * Env Node : `localStorage` absent par défaut → mock mémoire (même patron que finnhub.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Timeframe } from "@axiom/types";
import {
  diffEntrants,
  filtrerCooldown,
  lirePresetAlerts,
  presetAlertsStore,
  type DepuisBuilderAlerte,
} from "./presetAlerts";

const STORAGE_KEY = "axiom:presetAlerts:v1";

function installMockLocalStorage(): Storage {
  const data = new Map<string, string>();
  const mock: Storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = mock;
  return mock;
}

/** Builder minimal (sans filtre indicateur → scan léger, periodeMin 15). */
function builder(nom: string, avecIndicateur = false): DepuisBuilderAlerte {
  return {
    presetId: `preset:${nom}`,
    nom,
    tf: "4h" as Timeframe,
    baseConditions: [{ kind: "base", field: "volumeUsd24h", op: ">", value: 10_000_000 }],
    indicatorConditions: avecIndicateur
      ? [{ kind: "indicator", fieldId: "rsi", param: 14, op: "<", value: 30 }]
      : [],
  };
}

describe("diffEntrants (pur)", () => {
  it("amorce (precedent null) → aucun entrant", () => {
    expect(diffEntrants(null, ["BTCUSDT", "ETHUSDT"])).toEqual([]);
  });

  it("renvoie les symboles présents dans courant et absents de precedent", () => {
    const prec = new Set(["BTCUSDT", "ETHUSDT"]);
    expect(diffEntrants(prec, ["ETHUSDT", "SOLUSDT", "BTCUSDT", "XRPUSDT"])).toEqual([
      "SOLUSDT",
      "XRPUSDT",
    ]);
  });

  it("ensemble identique → aucun entrant", () => {
    const prec = new Set(["BTCUSDT", "ETHUSDT"]);
    expect(diffEntrants(prec, ["ETHUSDT", "BTCUSDT"])).toEqual([]);
  });

  it("un symbole SORTANT n'apparaît pas (on ne rapporte que les entrants)", () => {
    const prec = new Set(["BTCUSDT", "ETHUSDT"]);
    expect(diffEntrants(prec, ["BTCUSDT"])).toEqual([]);
  });

  it("écarte les doublons de courant en préservant l'ordre", () => {
    expect(diffEntrants(new Set(), ["A", "B", "A"])).toEqual(["A", "B"]);
  });
});

describe("filtrerCooldown (pur)", () => {
  it("un symbole jamais déclenché passe toujours", () => {
    expect(filtrerCooldown(["BTCUSDT"], new Map(), 1_000, 100)).toEqual(["BTCUSDT"]);
  });

  it("borne INCLUSIVE : now - dernier === cooldownMs passe", () => {
    const cd = new Map([["BTCUSDT", 0]]);
    expect(filtrerCooldown(["BTCUSDT"], cd, 100, 100)).toEqual(["BTCUSDT"]);
  });

  it("encore en cooldown : now - dernier === cooldownMs - 1 est filtré", () => {
    const cd = new Map([["BTCUSDT", 0]]);
    expect(filtrerCooldown(["BTCUSDT"], cd, 99, 100)).toEqual([]);
  });

  it("filtre seulement les symboles encore en cooldown", () => {
    const cd = new Map([
      ["BTCUSDT", 0], // 200 - 0 = 200 >= 100 → passe
      ["ETHUSDT", 150], // 200 - 150 = 50 < 100 → filtré
    ]);
    expect(filtrerCooldown(["BTCUSDT", "ETHUSDT", "SOLUSDT"], cd, 200, 100)).toEqual([
      "BTCUSDT",
      "SOLUSDT",
    ]);
  });
});

describe("presetAlertsStore", () => {
  beforeEach(() => {
    installMockLocalStorage();
    presetAlertsStore.setState({ alertes: [] });
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("ajouter dérive periodeMin 15 sans filtre indicateur, 60 avec", () => {
    presetAlertsStore.getState().ajouter(builder("leger"));
    presetAlertsStore.getState().ajouter(builder("lourd", true));
    const [a, b] = presetAlertsStore.getState().alertes;
    expect(a?.periodeMin).toBe(15);
    expect(b?.periodeMin).toBe(60);
  });

  it("ajouter crée une alerte ACTIVE et renvoie 'ok'", () => {
    expect(presetAlertsStore.getState().ajouter(builder("x"))).toBe("ok");
    expect(presetAlertsStore.getState().alertes[0]?.actif).toBe(true);
  });

  it("le snapshot des conditions est une copie profonde (immunité aux mutations du builder)", () => {
    const b = builder("copie");
    presetAlertsStore.getState().ajouter(b);
    b.baseConditions[0]!.value = 999;
    expect(presetAlertsStore.getState().alertes[0]?.baseConditions[0]?.value).toBe(10_000_000);
  });

  it("refuse au-delà de 4 alertes ACTIVES → 'limite'", () => {
    for (let i = 0; i < 4; i++) {
      expect(presetAlertsStore.getState().ajouter(builder(`a${i}`))).toBe("ok");
    }
    expect(presetAlertsStore.getState().ajouter(builder("a5"))).toBe("limite");
    expect(presetAlertsStore.getState().alertes).toHaveLength(4);
  });

  it("une alerte désactivée libère un emplacement actif", () => {
    for (let i = 0; i < 4; i++) presetAlertsStore.getState().ajouter(builder(`a${i}`));
    const premier = presetAlertsStore.getState().alertes[0]!;
    presetAlertsStore.getState().basculer(premier.id);
    expect(presetAlertsStore.getState().ajouter(builder("a5"))).toBe("ok");
    expect(presetAlertsStore.getState().alertes).toHaveLength(5);
  });

  it("ré-activer via basculer est refusé au-delà de 4 actives → 'limite'", () => {
    // 4 actives + 1 désactivée : ré-activer la 5e doit être refusé (limite déjà atteinte).
    for (let i = 0; i < 4; i++) presetAlertsStore.getState().ajouter(builder(`a${i}`));
    const premier = presetAlertsStore.getState().alertes[0]!;
    presetAlertsStore.getState().basculer(premier.id); // désactive → 3 actives
    presetAlertsStore.getState().ajouter(builder("a5")); // → 4 actives, 1 inactive (premier)
    expect(presetAlertsStore.getState().basculer(premier.id)).toBe("limite");
    expect(presetAlertsStore.getState().alertes.find((a) => a.id === premier.id)?.actif).toBe(false);
  });

  it("basculer inverse l'état actif", () => {
    presetAlertsStore.getState().ajouter(builder("x"));
    const id = presetAlertsStore.getState().alertes[0]!.id;
    presetAlertsStore.getState().basculer(id);
    expect(presetAlertsStore.getState().alertes[0]?.actif).toBe(false);
    presetAlertsStore.getState().basculer(id);
    expect(presetAlertsStore.getState().alertes[0]?.actif).toBe(true);
  });

  it("retirer supprime l'alerte", () => {
    presetAlertsStore.getState().ajouter(builder("x"));
    const id = presetAlertsStore.getState().alertes[0]!.id;
    presetAlertsStore.getState().retirer(id);
    expect(presetAlertsStore.getState().alertes).toHaveLength(0);
  });

  it("persiste dans localStorage (round-trip via lirePresetAlerts)", () => {
    presetAlertsStore.getState().ajouter(builder("persiste"));
    const relu = lirePresetAlerts();
    expect(relu).toHaveLength(1);
    expect(relu[0]?.nom).toBe("persiste");
    expect(relu[0]?.periodeMin).toBe(15);
  });

  it("lecture tolérante : JSON corrompu → []", () => {
    localStorage.setItem(STORAGE_KEY, "{pas du json");
    expect(lirePresetAlerts()).toEqual([]);
  });

  it("lecture tolérante : contenu non-tableau → []", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 1 }));
    expect(lirePresetAlerts()).toEqual([]);
  });

  it("lirePresetAlerts écarte un item sans champs requis au lieu de le charger (resyncPreset lit a.actif/a.periodeMin)", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        null,
        { id: "corrompu" }, // sans periodeMin/actif/conditions
        {
          id: "ok",
          presetId: "p1",
          nom: "Momentum",
          tf: "1h",
          baseConditions: [],
          indicatorConditions: [],
          periodeMin: 15,
          actif: true,
          creeTs: 1,
        },
      ])
    );

    expect(lirePresetAlerts().map((a) => a.id)).toEqual(["ok"]);
  });
});

describe("marquerScan — état de scan de SESSION (jamais persisté)", () => {
  beforeEach(() => {
    installMockLocalStorage();
    presetAlertsStore.setState({ alertes: [] });
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("publie l'horodatage puis l'erreur, et l'efface au scan suivant qui réussit", () => {
    presetAlertsStore.getState().ajouter(builder("Momentum"));
    const id = presetAlertsStore.getState().alertes[0]?.id ?? "";

    presetAlertsStore.getState().marquerScan(id, 1_000, "réseau HS");
    expect(presetAlertsStore.getState().alertes[0]?.dernierScanTs).toBe(1_000);
    expect(presetAlertsStore.getState().alertes[0]?.derniereErreur).toBe("réseau HS");

    presetAlertsStore.getState().marquerScan(id, 2_000);
    expect(presetAlertsStore.getState().alertes[0]?.dernierScanTs).toBe(2_000);
    expect(presetAlertsStore.getState().alertes[0]?.derniereErreur).toBeUndefined();
  });

  it("l'état de scan ne survit PAS à un rechargement (retiré de la persistance)", () => {
    presetAlertsStore.getState().ajouter(builder("Momentum"));
    const id = presetAlertsStore.getState().alertes[0]?.id ?? "";
    presetAlertsStore.getState().marquerScan(id, 1_000, "réseau HS");
    // Une mutation persistée (bascule) réécrit la clé : les champs de session en sont exclus.
    presetAlertsStore.getState().basculer(id);

    const relu = lirePresetAlerts();
    expect(relu[0]?.dernierScanTs).toBeUndefined();
    expect(relu[0]?.derniereErreur).toBeUndefined();
  });
});
