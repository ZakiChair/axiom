/**
 * Tests du store du journal EXPY : conteneur (ajouter / clôturer / supprimer),
 * persistance tolérante (round-trip d'écriture + lecture, corruption → vide), et
 * import/export JSON (validation par ligne, fusion par id, comptes, re-import).
 *
 * Env Node : `localStorage` est absent par défaut → on installe un mock mémoire
 * (même patron que onboarding.test.ts / etherscan.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TradeJournal } from "../data/expy";
import { chargerTrades, EXPY_STORAGE_KEY, expyStore } from "./expy";

/** Mock localStorage en mémoire (env Node). */
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

/** Fabrique un trade complet (id inclus) pour les tests d'import/persistance. */
function trade(over: Partial<TradeJournal>): TradeJournal {
  return {
    id: over.id ?? "t1",
    symbol: over.symbol ?? "BTCUSDT",
    direction: over.direction ?? "long",
    entree: over.entree ?? 100,
    stopInitial: over.stopInitial ?? 90,
    taille: over.taille ?? 1,
    sortie: over.sortie ?? null,
    ouvertTs: over.ouvertTs ?? 1000,
    fermeTs: over.fermeTs ?? null,
    note: over.note,
    tags: over.tags ?? [],
  };
}

let storage: Storage;

beforeEach(() => {
  storage = installMockLocalStorage();
  // L'hydratation initiale a déjà eu lieu à l'import (localStorage absent) — on force l'état.
  expyStore.setState({ trades: [] });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("ajouter", () => {
  it("crée un trade avec un id généré et le persiste", () => {
    expyStore.getState().ajouter({
      symbol: "ETHUSDT",
      direction: "short",
      entree: 200,
      stopInitial: 210,
      taille: 2,
      sortie: null,
      ouvertTs: 5000,
      fermeTs: null,
      tags: ["breakout"],
    });
    const trades = expyStore.getState().trades;
    expect(trades).toHaveLength(1);
    expect(trades[0]?.id).toBeTruthy();
    expect(trades[0]?.symbol).toBe("ETHUSDT");
    // Persistance : le JSON est écrit dans localStorage à la mutation.
    const raw = storage.getItem(EXPY_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? "[]")).toEqual(trades);
  });

  it("génère des ids distincts", () => {
    const s = expyStore.getState();
    s.ajouter({ ...trade({}), symbol: "A" } as Omit<TradeJournal, "id">);
    s.ajouter({ ...trade({}), symbol: "B" } as Omit<TradeJournal, "id">);
    const [a, b] = expyStore.getState().trades;
    expect(a?.id).not.toBe(b?.id);
  });
});

describe("cloturer", () => {
  it("pose sortie ET fermeTs sur le trade ciblé, persiste", () => {
    expyStore.setState({ trades: [trade({ id: "x", sortie: null, fermeTs: null })] });
    expyStore.getState().cloturer("x", 130, 9000);
    const t = expyStore.getState().trades[0];
    expect(t?.sortie).toBe(130);
    expect(t?.fermeTs).toBe(9000);
    expect(JSON.parse(storage.getItem(EXPY_STORAGE_KEY) ?? "[]")[0].sortie).toBe(130);
  });

  it("id inconnu : aucun changement", () => {
    expyStore.setState({ trades: [trade({ id: "x" })] });
    expyStore.getState().cloturer("absent", 130, 9000);
    expect(expyStore.getState().trades[0]?.sortie).toBeNull();
  });
});

describe("supprimer", () => {
  it("retire le trade par id et persiste", () => {
    expyStore.setState({ trades: [trade({ id: "a" }), trade({ id: "b" })] });
    expyStore.getState().supprimer("a");
    const trades = expyStore.getState().trades;
    expect(trades.map((t) => t.id)).toEqual(["b"]);
    expect(JSON.parse(storage.getItem(EXPY_STORAGE_KEY) ?? "[]")).toEqual(trades);
  });
});

describe("chargerTrades (lecture tolérante)", () => {
  it("localStorage absent → []", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(chargerTrades()).toEqual([]);
  });

  it("JSON corrompu → []", () => {
    storage.setItem(EXPY_STORAGE_KEY, "{ pas du json");
    expect(chargerTrades()).toEqual([]);
  });

  it("non-tableau → []", () => {
    storage.setItem(EXPY_STORAGE_KEY, JSON.stringify({ foo: 1 }));
    expect(chargerTrades()).toEqual([]);
  });

  it("round-trip : ce qu'une mutation écrit est relu à l'identique", () => {
    expyStore.setState({ trades: [trade({ id: "r" })] });
    expyStore.getState().ajouter({
      symbol: "SOLUSDT",
      direction: "long",
      entree: 20,
      stopInitial: 18,
      taille: 3,
      sortie: 26,
      ouvertTs: 1,
      fermeTs: 2,
      tags: [],
    });
    expect(chargerTrades()).toEqual(expyStore.getState().trades);
  });
});

describe("importer", () => {
  it("JSON valide : ajoute toutes les lignes bien formées", () => {
    const payload = JSON.stringify([
      trade({ id: "i1", symbol: "AAA" }),
      trade({ id: "i2", symbol: "BBB", sortie: 120, fermeTs: 3000 }),
    ]);
    const res = expyStore.getState().importer(payload);
    expect(res).toEqual({ ajoutes: 2, ignores: 0 });
    expect(expyStore.getState().trades.map((t) => t.id)).toEqual(["i1", "i2"]);
  });

  it("JSON globalement corrompu → {0, 0} sans casse", () => {
    expyStore.setState({ trades: [trade({ id: "keep" })] });
    expect(expyStore.getState().importer("{ nope")).toEqual({ ajoutes: 0, ignores: 0 });
    // L'état existant est intact.
    expect(expyStore.getState().trades.map((t) => t.id)).toEqual(["keep"]);
  });

  it("racine non-tableau → {0, 0}", () => {
    expect(expyStore.getState().importer(JSON.stringify({ a: 1 }))).toEqual({
      ajoutes: 0,
      ignores: 0,
    });
  });

  it("ligne invalide écartée et comptée dans ignores", () => {
    const payload = JSON.stringify([
      trade({ id: "ok" }),
      { id: "bad", symbol: 42 }, // symbol non-string + champs manquants
      { symbol: "AAA", direction: "long" }, // id manquant
      trade({ id: "ok2" }),
    ]);
    const res = expyStore.getState().importer(payload);
    expect(res).toEqual({ ajoutes: 2, ignores: 2 });
    expect(expyStore.getState().trades.map((t) => t.id)).toEqual(["ok", "ok2"]);
  });

  it("id déjà présent : conservé tel quel (pas écrasé), compté dans ignores", () => {
    expyStore.setState({ trades: [trade({ id: "dup", symbol: "ORIG", sortie: null })] });
    const payload = JSON.stringify([
      trade({ id: "dup", symbol: "REMPLACE", sortie: 999, fermeTs: 42 }),
      trade({ id: "new", symbol: "NOUVEAU" }),
    ]);
    const res = expyStore.getState().importer(payload);
    expect(res).toEqual({ ajoutes: 1, ignores: 1 });
    const dup = expyStore.getState().trades.find((t) => t.id === "dup");
    expect(dup?.symbol).toBe("ORIG"); // pas écrasé
    expect(dup?.sortie).toBeNull();
    expect(expyStore.getState().trades.map((t) => t.id)).toContain("new");
  });

  it("doublon d'id intra-lot : première ligne gagne, seconde comptée dans ignores", () => {
    const payload = JSON.stringify([
      trade({ id: "same", symbol: "PREMIER" }),
      trade({ id: "same", symbol: "SECOND" }),
    ]);
    const res = expyStore.getState().importer(payload);
    expect(res).toEqual({ ajoutes: 1, ignores: 1 });
    expect(expyStore.getState().trades.find((t) => t.id === "same")?.symbol).toBe("PREMIER");
  });
});

describe("exporter", () => {
  it("produit un JSON re-importable dans un store vide", () => {
    const original = [
      trade({ id: "e1", symbol: "AAA", tags: ["a"] }),
      trade({ id: "e2", symbol: "BBB", sortie: 150, fermeTs: 7000, note: "gagnant" }),
    ];
    expyStore.setState({ trades: original });
    const json = expyStore.getState().exporter();

    // Vide le store puis ré-importe → doit retrouver l'original à l'identique.
    expyStore.setState({ trades: [] });
    const res = expyStore.getState().importer(json);
    expect(res).toEqual({ ajoutes: 2, ignores: 0 });
    expect(expyStore.getState().trades).toEqual(original);
  });

  it("JSON lisible (pretty-print)", () => {
    expyStore.setState({ trades: [trade({ id: "p" })] });
    expect(expyStore.getState().exporter()).toContain("\n");
  });
});
