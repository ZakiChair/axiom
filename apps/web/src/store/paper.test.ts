/**
 * Tests du store + moteur paper trading (logique NON-réseau uniquement).
 *
 * Couvre : la logique d'ENSEMBLE de symboles actifs (pure), les mutations (placer/annuler/
 * modifier TP-SL/clôturer/setSolde), la persistance round-trip (écriture du sous-ensemble
 * persisté, `derniersPrix` exclu, lecture tolérante), et le PONT EXPY testé avec le VRAI
 * `expyStore` réinitialisé (clôture manuelle + clôture tp déclenchée par un fill).
 *
 * Env Node : `localStorage` absent → mock mémoire (patron expy.test.ts / onboarding.test.ts).
 * Le moteur temps réel (`subscribeTickers`) n'est PAS démarré ici (aucun réseau) : on injecte
 * les prix via `derniersPrix` et on exerce le chemin de fill opportuniste de `placerOrdre`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chargerPaper,
  PAPER_STORAGE_KEY,
  paperStore,
  SOLDE_INITIAL,
  symbolesActifs,
} from "./paper";
import { expyStore } from "./expy";
import type { EtatPaper, OrdrePaper, PositionPaper } from "../data/paper";

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

function ordre(p: Partial<OrdrePaper>): OrdrePaper {
  return {
    id: p.id ?? "o1",
    symbol: p.symbol ?? "BTCUSDT",
    direction: p.direction ?? "long",
    type: p.type ?? "market",
    prixLimite: "prixLimite" in p ? (p.prixLimite ?? null) : null,
    prixStop: "prixStop" in p ? (p.prixStop ?? null) : null,
    taille: p.taille ?? 1,
    tp: "tp" in p ? (p.tp ?? null) : null,
    sl: "sl" in p ? (p.sl ?? null) : null,
    creeTs: p.creeTs ?? 1_000,
  };
}

function position(p: Partial<PositionPaper>): PositionPaper {
  return {
    id: p.id ?? "p1",
    symbol: p.symbol ?? "BTCUSDT",
    direction: p.direction ?? "long",
    taille: p.taille ?? 1,
    prixEntree: p.prixEntree ?? 100,
    tp: "tp" in p ? (p.tp ?? null) : null,
    sl: "sl" in p ? (p.sl ?? null) : null,
    ouvertTs: p.ouvertTs ?? 1_000,
  };
}

/** Remet le store paper à l'état neutre (les singletons sont hydratés à l'import). */
function resetPaper(): void {
  paperStore.setState({
    solde: SOLDE_INITIAL,
    ordres: [],
    positions: [],
    executions: [],
    derniersPrix: {},
  });
}

let storage: Storage;

beforeEach(() => {
  storage = installMockLocalStorage();
  resetPaper();
  expyStore.setState({ trades: [] });
  storage.clear(); // repart d'un localStorage propre (le reset ci-dessus a pu écrire)
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("symbolesActifs (ensemble des symboles à souscrire) — PURE", () => {
  function etat(over: Partial<EtatPaper>): EtatPaper {
    return { solde: 0, ordres: over.ordres ?? [], positions: over.positions ?? [], executions: [] };
  }

  it("union des symboles des ordres ET des positions, dédupliquée et triée", () => {
    const e = etat({
      ordres: [ordre({ symbol: "ETHUSDT" }), ordre({ symbol: "BTCUSDT" })],
      positions: [position({ symbol: "BTCUSDT" }), position({ symbol: "SOLUSDT" })],
    });
    expect(symbolesActifs(e)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  });

  it("vide quand aucun ordre ni position", () => {
    expect(symbolesActifs(etat({}))).toEqual([]);
  });
});

describe("placerOrdre", () => {
  it("ajoute un ordre avec id + creeTs générés (dort si le prix est inconnu)", () => {
    paperStore.getState().placerOrdre({
      symbol: "BTCUSDT", direction: "long", type: "limit",
      prixLimite: 100, prixStop: null, taille: 1, tp: null, sl: null,
    });
    const { ordres, positions } = paperStore.getState();
    expect(ordres).toHaveLength(1);
    expect(ordres[0]!.id).toBeTruthy();
    expect(ordres[0]!.creeTs).toBeGreaterThan(0);
    expect(positions).toHaveLength(0); // prix inconnu → aucun fill
  });

  it("fill opportuniste immédiat d'un market quand le prix du symbole est déjà connu", () => {
    paperStore.setState({ derniersPrix: { BTCUSDT: 100 } });
    paperStore.getState().placerOrdre({
      symbol: "BTCUSDT", direction: "long", type: "market",
      prixLimite: null, prixStop: null, taille: 2, tp: null, sl: null,
    });
    const { ordres, positions, solde } = paperStore.getState();
    expect(ordres).toHaveLength(0); // consommé
    expect(positions).toHaveLength(1);
    expect(positions[0]!.prixEntree).toBe(100);
    expect(positions[0]!.taille).toBe(2);
    // Frais entrée = 2×100×0.0005 = 0.10 → solde 100000 → 99999.90.
    expect(solde).toBeCloseTo(SOLDE_INITIAL - 0.1, 10);
  });
});

describe("annulerOrdre", () => {
  it("retire l'ordre EN ATTENTE ; no-op si id inconnu", () => {
    paperStore.setState({ ordres: [ordre({ id: "oA" }), ordre({ id: "oB" })] });
    paperStore.getState().annulerOrdre("oA");
    expect(paperStore.getState().ordres.map((o) => o.id)).toEqual(["oB"]);
    paperStore.getState().annulerOrdre("inconnu"); // no-op
    expect(paperStore.getState().ordres).toHaveLength(1);
  });
});

describe("modifierTpSl", () => {
  it("redéfinit tp/sl d'une position (null retire le niveau) ; no-op si id inconnu", () => {
    paperStore.setState({ positions: [position({ id: "pX", tp: 110, sl: 90 })] });
    paperStore.getState().modifierTpSl("pX", 120, null);
    const p = paperStore.getState().positions[0]!;
    expect(p.tp).toBe(120);
    expect(p.sl).toBeNull();
    paperStore.getState().modifierTpSl("inconnu", 1, 1); // no-op
    expect(paperStore.getState().positions[0]!.tp).toBe(120);
  });
});

describe("cloturer (au dernier prix connu) + pont EXPY", () => {
  it("clôture au dernier prix connu : position retirée, solde crédité, trade EXPY ajouté", () => {
    // Position 2@100, dernier prix 120 → brut (120−100)×2 = 40 ; frais 2×120×0.0005 = 0.12 ; pnl 39.88.
    paperStore.setState({
      positions: [position({ id: "pC", direction: "long", taille: 2, prixEntree: 100, sl: 95 })],
      derniersPrix: { BTCUSDT: 120 },
    });
    paperStore.getState().cloturer("pC");

    const { positions, solde } = paperStore.getState();
    expect(positions).toHaveLength(0);
    expect(solde).toBeCloseTo(SOLDE_INITIAL + 39.88, 10);

    // Pont EXPY : un trade fermé, tag paper, note cloture-manuelle, stopInitial = sl.
    const trades = expyStore.getState().trades;
    expect(trades).toHaveLength(1);
    expect(trades[0]!.tags).toEqual(["paper"]);
    expect(trades[0]!.note).toBe("cloture-manuelle");
    expect(trades[0]!.sortie).toBe(120);
    expect(trades[0]!.stopInitial).toBe(95);
  });

  it("no-op (sans trade EXPY) si le prix du symbole est inconnu", () => {
    paperStore.setState({ positions: [position({ id: "pC" })], derniersPrix: {} });
    paperStore.getState().cloturer("pC");
    expect(paperStore.getState().positions).toHaveLength(1); // intacte
    expect(expyStore.getState().trades).toHaveLength(0);
  });

  it("no-op si id inconnu", () => {
    paperStore.setState({ positions: [position({ id: "pC" })], derniersPrix: { BTCUSDT: 100 } });
    paperStore.getState().cloturer("inconnu");
    expect(paperStore.getState().positions).toHaveLength(1);
    expect(expyStore.getState().trades).toHaveLength(0);
  });
});

describe("pont EXPY sur clôture tp déclenchée par un tick (fill opportuniste)", () => {
  it("un fill qui touche immédiatement le tp → clôture tp journalisée dans EXPY", () => {
    // Prix connu 110, market long tp=105 : le fill ouvre à 110 puis tp long (110 ≥ 105) clôture à 105.
    paperStore.setState({ derniersPrix: { BTCUSDT: 110 } });
    paperStore.getState().placerOrdre({
      symbol: "BTCUSDT", direction: "long", type: "market",
      prixLimite: null, prixStop: null, taille: 1, tp: 105, sl: null,
    });
    // Ni ordre ni position ne subsistent (ouvert puis clôturé dans le même tick).
    expect(paperStore.getState().ordres).toHaveLength(0);
    expect(paperStore.getState().positions).toHaveLength(0);
    const trades = expyStore.getState().trades;
    expect(trades).toHaveLength(1);
    expect(trades[0]!.note).toBe("tp");
    expect(trades[0]!.tags).toEqual(["paper"]);
    expect(trades[0]!.sortie).toBe(105);
  });
});

describe("setSolde", () => {
  it("redéfinit le solde", () => {
    paperStore.getState().setSolde(50_000);
    expect(paperStore.getState().solde).toBe(50_000);
  });
});

describe("persistance", () => {
  it("écrit le sous-ensemble persisté à chaque mutation (round-trip via chargerPaper)", () => {
    paperStore.getState().setSolde(25_000);
    paperStore.setState({ positions: [position({ id: "pR", prixEntree: 42 })] });

    const raw = storage.getItem(PAPER_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const relu = chargerPaper();
    expect(relu.solde).toBe(25_000);
    expect(relu.positions).toHaveLength(1);
    expect(relu.positions[0]!.prixEntree).toBe(42);
  });

  it("un changement de `derniersPrix` SEUL n'écrit PAS localStorage (éphémère)", () => {
    // localStorage propre (beforeEach l'a vidé après le reset).
    expect(storage.getItem(PAPER_STORAGE_KEY)).toBeNull();
    paperStore.setState({ derniersPrix: { BTCUSDT: 100 } });
    expect(storage.getItem(PAPER_STORAGE_KEY)).toBeNull(); // toujours rien écrit
  });

  it("chargerPaper : défauts tolérants quand la clé est absente / corrompue", () => {
    expect(chargerPaper()).toEqual({ solde: SOLDE_INITIAL, ordres: [], positions: [], executions: [] });
    storage.setItem(PAPER_STORAGE_KEY, "{pas du json");
    expect(chargerPaper().solde).toBe(SOLDE_INITIAL);
  });
});
