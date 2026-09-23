import { describe, expect, it, vi } from "vitest";
import type { DeclenchementEnrichi } from "../data/decisionDossier";
import { CLE_DOSSIERS_DECISION, creerStoreDossiersDecision } from "./decisionDossiers";

const signal: DeclenchementEnrichi = { alertId: "a", ts: 1234, valeur: 101, message: "Signal", preuve: {
  origine: { alertId: "a", ts: 1234, symbol: "BTCUSDT", source: "binance", timeframe: "1h",
    condition: { type: "prix-croise", niveau: 100, sens: "hausse" }, valeur: 101, message: "Signal" },
  contexte: { dernierPrix: 101 },
} };

function stockage() {
  const valeurs = new Map<string, string>();
  return { getItem: vi.fn((key: string) => valeurs.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { valeurs.set(key, value); }) };
}

describe("dossiers de décision", () => {
  it("est idempotent pour le même déclenchement et garde la source après suppression de l'alerte", () => {
    const storage = stockage();
    const store = creerStoreDossiersDecision(storage);
    const id = store.getState().creerDepuisJournal(signal);
    expect(store.getState().creerDepuisJournal(signal)).toBe(id);
    expect(store.getState().dossiers).toHaveLength(1);
    store.getState().modifier(id!, { these: "Hausse" });
    const recharge = creerStoreDossiersDecision(storage);
    expect(recharge.getState().dossiers[0]).toMatchObject({ origine: { symbol: "BTCUSDT", source: "binance", ts: 1234 }, these: "Hausse" });
  });

  it("bloque le 101e dossier sans éviction et permet suppression/export", () => {
    const store = creerStoreDossiersDecision(stockage());
    for (let i = 0; i < 100; i++) expect(store.getState().creerDepuisJournal({ ...signal, ts: i, preuve: undefined })).toBeTruthy();
    expect(store.getState().creerDepuisJournal({ ...signal, ts: 101, preuve: undefined })).toBeNull();
    expect(store.getState().dossiers).toHaveLength(100);
    expect(store.getState().erreurSauvegarde).toMatch(/100/);
    const id = store.getState().dossiers[0]!.id;
    store.getState().supprimer(id);
    expect(store.getState().dossiers).toHaveLength(99);
    expect(JSON.parse(store.getState().exporterJSON()).dossiers).toHaveLength(99);
  });

  it("conserve en mémoire si localStorage échoue, puis réessaie sans doublon", () => {
    const storage = stockage();
    storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    const store = creerStoreDossiersDecision(storage);
    store.getState().creerDepuisJournal(signal);
    expect(store.getState().dossiers).toHaveLength(1);
    expect(store.getState().erreurSauvegarde).toMatch(/quota/);
    expect(store.getState().reessayerSauvegarde()).toBe(true);
    expect(creerStoreDossiersDecision(storage).getState().dossiers).toHaveLength(1);
  });

  it("hydrate les entrées valides, rejette les invalides sans planter", () => {
    const storage = stockage();
    const store = creerStoreDossiersDecision(storage);
    store.getState().creerDepuisJournal(signal);
    const raw = JSON.parse(storage.getItem(CLE_DOSSIERS_DECISION)!);
    storage.setItem(CLE_DOSSIERS_DECISION, JSON.stringify({ ...raw, dossiers: [raw.dossiers[0], { id: "malforme" }] }));
    const recharge = creerStoreDossiersDecision(storage);
    expect(recharge.getState().dossiers).toHaveLength(1);
    expect(recharge.getState().erreurSauvegarde).toMatch(/invalide/);
  });

  it("rejette un bloc analyse futur même dans un dossier partiel et garde l'archive originale", () => {
    const storage = stockage();
    const store = creerStoreDossiersDecision(storage);
    store.getState().creerDepuisJournal({ ...signal, preuve: undefined });
    const ancien = JSON.parse(storage.getItem(CLE_DOSSIERS_DECISION)!).dossiers[0];
    const corrompu = JSON.stringify({ schemaVersion: 1, dossiers: [{ ...ancien,
      analyse: { schemaVersion: 1, captureLe: 1235, lectures: [] } }] });
    storage.setItem(CLE_DOSSIERS_DECISION, corrompu);
    const recharge = creerStoreDossiersDecision(storage);
    expect(recharge.getState().dossiers).toHaveLength(0);
    expect(recharge.getState().exporterOriginalJSON()).toBe(corrompu);
  });

  it("écarte une source inventée ou une preuve future et garde le brut récupérable avant écriture", () => {
    const storage = stockage();
    const store = creerStoreDossiersDecision(storage);
    store.getState().creerDepuisJournal(signal);
    const bon = JSON.parse(storage.getItem(CLE_DOSSIERS_DECISION)!).dossiers[0];
    const corrompu = JSON.stringify({ schemaVersion: 1, dossiers: [bon,
      { ...bon, id: "source", origine: { ...bon.origine, source: "venue-inconnue" } },
      { ...bon, id: "futur", contexte: { derniereBougie: { time: 2000, open: 1, high: 1, low: 1, close: 1, volume: 1 } } },
    ] });
    storage.setItem(CLE_DOSSIERS_DECISION, corrompu);
    const recharge = creerStoreDossiersDecision(storage);
    expect(recharge.getState().dossiers.map((d) => d.id)).toEqual([bon.id]);
    expect(recharge.getState().exporterOriginalJSON()).toBe(corrompu);
    recharge.getState().modifier(bon.id, { these: "ne pas écraser" });
    expect(storage.getItem(CLE_DOSSIERS_DECISION)).toBe(corrompu);
    recharge.getState().confirmerExportOriginal();
    recharge.getState().modifier(bon.id, { these: "récupéré" });
    expect(JSON.parse(storage.getItem(CLE_DOSSIERS_DECISION)!).dossiers).toHaveLength(1);
    expect(recharge.getState().exporterOriginalJSON()).toBe(corrompu);
  });

  it("la création directe n'archive pas une preuve composite invalide comme complète", () => {
    const store = creerStoreDossiersDecision(stockage());
    const mauvais = { ...signal, preuve: { ...signal.preuve!, origine: {
      ...signal.preuve!.origine, condition: { type: "composite", conditions: null },
    } } } as unknown as DeclenchementEnrichi;
    const id = store.getState().creerDepuisJournal(mauvais);
    expect(store.getState().dossiers.find((d) => d.id === id)).toMatchObject({
      qualite: "partielle", origine: { source: null, condition: null }, contexte: {},
    });
  });
});
