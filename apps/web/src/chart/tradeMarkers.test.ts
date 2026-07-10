/**
 * Tests des fonctions PURES des marqueurs trades & notes (tradeMarkers.ts) : projection
 * des positions + notes en marqueurs pour le SYMBOLE affiché (scoping exchange:symbole,
 * cap antichrono, ancrage prix obligatoire) et formatage des étiquettes (PnL, aperçu note).
 * Le couplage KLineChart n'est PAS testé (rendu impératif, comme ecoMarkers/fibonacci).
 *
 * tradeMarkers.ts appelle `registerOverlay`, importe `./drawing` (klinecharts) et
 * `../store/theme` (pose [data-theme] sur <html> au chargement) ; on les stub pour
 * importer le module en environnement Node.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("./drawing", () => ({ getActiveChart: () => null }));
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));

import {
  projeterMarqueurs,
  etiquettePnl,
  apercuNote,
  retirerMarqueursSuivis,
  type Marqueur,
  type PerimetreSymbole,
  type CibleMarqueurs,
} from "./tradeMarkers";
import type { Position } from "../store/portfolio";
import type { Note } from "../store/notes";

/** Périmètre par défaut : Binance BTCUSDT. */
const BINANCE_BTC: PerimetreSymbole = { exchange: "binance", symbole: "BTCUSDT" };

/** Fabrique une position de test avec des défauts raisonnables. */
function pos(over: Partial<Position>): Position {
  return {
    id: over.id ?? "p1",
    symbole: over.symbole ?? "BTCUSDT",
    source: over.source ?? "binance",
    direction: over.direction ?? "long",
    taille: over.taille ?? 1,
    prixEntree: over.prixEntree ?? 100,
    fraisPct: over.fraisPct,
    dateEntree: over.dateEntree ?? 0,
    note: over.note,
    statut: over.statut ?? "ouvert",
    prixSortie: over.prixSortie,
    dateSortie: over.dateSortie,
  };
}

/** Fabrique une note de test. */
function note(over: Partial<Note>): Note {
  return {
    id: over.id ?? "n1",
    symbole: over.symbole ?? "BTCUSDT",
    source: over.source ?? "binance",
    timestamp: over.timestamp ?? 0,
    prix: over.prix,
    texte: over.texte ?? "note",
    tags: over.tags ?? [],
  };
}

/** Retrouve un marqueur par sa clé (aide à la lecture des assertions). */
function parCle(ms: Marqueur[], cle: string): Marqueur | undefined {
  return ms.find((m) => m.cle === cle);
}

describe("projeterMarqueurs — position ouverte", () => {
  it("long : 1 marqueur d'entrée, flèche haut, couleur up, sans étiquette", () => {
    const ms = projeterMarqueurs([pos({ id: "a", direction: "long", prixEntree: 100, dateEntree: 5 })], [], BINANCE_BTC);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({
      cle: "e:a",
      type: "entree",
      timestamp: 5,
      prix: 100,
      fleche: "haut",
      couleur: "up",
      label: "",
    });
  });

  it("short : flèche bas, couleur down", () => {
    const ms = projeterMarqueurs([pos({ id: "b", direction: "short" })], [], BINANCE_BTC);
    expect(ms[0]).toMatchObject({ type: "entree", fleche: "bas", couleur: "down" });
  });

  it("écarte l'entrée dont le prix d'entrée est invalide (≤ 0 / non fini)", () => {
    expect(projeterMarqueurs([pos({ prixEntree: 0 })], [], BINANCE_BTC)).toHaveLength(0);
    expect(projeterMarqueurs([pos({ prixEntree: Number.NaN })], [], BINANCE_BTC)).toHaveLength(0);
  });
});

describe("projeterMarqueurs — clôture", () => {
  it("long gagnant : entrée + clôture (flèche bas, couleur up, étiquette PnL signée)", () => {
    const p = pos({ id: "c", direction: "long", prixEntree: 100, taille: 10, statut: "clos", prixSortie: 120, dateSortie: 9 });
    const ms = projeterMarqueurs([p], [], BINANCE_BTC);
    expect(ms).toHaveLength(2);
    const cloture = parCle(ms, "x:c");
    expect(cloture).toMatchObject({
      type: "cloture",
      timestamp: 9,
      prix: 120,
      fleche: "bas",
      couleur: "up",
      label: "+$200.00", // (120-100)*10 = 200, sans frais
    });
  });

  it("long perdant : couleur down et étiquette négative", () => {
    const p = pos({ id: "d", direction: "long", prixEntree: 100, taille: 10, statut: "clos", prixSortie: 90, dateSortie: 3 });
    const cloture = parCle(projeterMarqueurs([p], [], BINANCE_BTC), "x:d");
    expect(cloture).toMatchObject({ couleur: "down", label: "−$100.00" });
  });

  it("short clôturé : flèche haut (rachat)", () => {
    const p = pos({ id: "s", direction: "short", statut: "clos", prixSortie: 90, dateSortie: 2 });
    expect(parCle(projeterMarqueurs([p], [], BINANCE_BTC), "x:s")).toMatchObject({ fleche: "haut" });
  });

  it("ne produit PAS de clôture si le prix de sortie est absent ou invalide", () => {
    const p = pos({ id: "z", statut: "clos", prixSortie: undefined, dateSortie: 4 });
    const ms = projeterMarqueurs([p], [], BINANCE_BTC);
    expect(ms).toHaveLength(1); // seule l'entrée subsiste
    expect(ms[0]?.type).toBe("entree");
  });
});

describe("projeterMarqueurs — notes ancrées", () => {
  it("note du périmètre AVEC prix : 1 marqueur note (couleur note, aperçu tronqué)", () => {
    const ms = projeterMarqueurs([], [note({ id: "n", prix: 105, timestamp: 7, texte: "cassure de range" })], BINANCE_BTC);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ cle: "n:n", type: "note", timestamp: 7, prix: 105, couleur: "note", label: "cassure de range" });
  });

  it("note SANS prix : ignorée (non plaçable en Y)", () => {
    expect(projeterMarqueurs([], [note({ prix: undefined })], BINANCE_BTC)).toHaveLength(0);
  });
});

describe("projeterMarqueurs — scoping exchange:symbole", () => {
  it("exclut un autre symbole", () => {
    expect(projeterMarqueurs([pos({ symbole: "ETHUSDT" })], [], BINANCE_BTC)).toHaveLength(0);
  });

  it("exclut le MÊME symbole sur un autre exchange (collision Binance/Coinbase)", () => {
    const p = pos({ symbole: "BTCUSDT", source: "coinbase" });
    expect(projeterMarqueurs([p], [], BINANCE_BTC)).toHaveLength(0);
  });

  it("compare le symbole insensiblement à la casse", () => {
    const ms = projeterMarqueurs([pos({ symbole: "btcusdt" })], [], BINANCE_BTC);
    expect(ms).toHaveLength(1);
  });
});

describe("projeterMarqueurs — tri antichrono et cap", () => {
  it("trie les marqueurs du plus récent au plus ancien", () => {
    const ms = projeterMarqueurs(
      [pos({ id: "vieux", dateEntree: 1 }), pos({ id: "recent", dateEntree: 100 })],
      [note({ id: "milieu", prix: 100, timestamp: 50 })],
      BINANCE_BTC,
    );
    expect(ms.map((m) => m.cle)).toEqual(["e:recent", "n:milieu", "e:vieux"]);
  });

  it("borne au nombre max en gardant les plus récents", () => {
    const notes = Array.from({ length: 10 }, (_, i) => note({ id: `n${i}`, prix: 100, timestamp: i }));
    const ms = projeterMarqueurs([], notes, BINANCE_BTC, 3);
    expect(ms).toHaveLength(3);
    expect(ms.map((m) => m.cle)).toEqual(["n:n9", "n:n8", "n:n7"]);
  });
});

describe("etiquettePnl", () => {
  it("préfixe « + » les gains, garde le « − » des pertes, « $0.00 » pour zéro", () => {
    expect(etiquettePnl(1200)).toBe("+$1.20K");
    expect(etiquettePnl(-500)).toBe("−$500.00");
    expect(etiquettePnl(0)).toBe("$0.00");
  });
});

describe("apercuNote", () => {
  it("aplatit les espaces/retours à la ligne", () => {
    expect(apercuNote("ligne 1\n  ligne 2")).toBe("ligne 1 ligne 2");
  });

  it("tronque avec … au-delà de la limite, laisse le texte court intact", () => {
    expect(apercuNote("court")).toBe("court");
    expect(apercuNote("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("retirerMarqueursSuivis — nettoyage multi-instances", () => {
  /** Chart factice : enregistre les ids retirés ; `detruit` simule une instance disposée. */
  function chartFactice(detruit = false): CibleMarqueurs & { retires: string[] } {
    const retires: string[] = [];
    return {
      retires,
      removeOverlay({ id }: { id: string }): void {
        if (detruit) throw new Error("instance détruite");
        retires.push(id);
      },
    };
  }

  it("retire chaque id sur CHAQUE instance suivie puis vide le registre", () => {
    const a = chartFactice();
    const b = chartFactice();
    const suivis = new Map<CibleMarqueurs, string[]>([
      [a, ["a1", "a2"]],
      [b, ["b1"]],
    ]);
    retirerMarqueursSuivis(suivis);
    expect(a.retires).toEqual(["a1", "a2"]);
    expect(b.retires).toEqual(["b1"]); // instance NON-focus nettoyée aussi (le défaut corrigé)
    expect(suivis.size).toBe(0);
  });

  it("tolère une instance détruite (removeOverlay lève) et nettoie quand même les autres", () => {
    const morte = chartFactice(true);
    const vivante = chartFactice();
    const suivis = new Map<CibleMarqueurs, string[]>([
      [morte, ["m1", "m2"]],
      [vivante, ["v1"]],
    ]);
    expect(() => retirerMarqueursSuivis(suivis)).not.toThrow();
    expect(vivante.retires).toEqual(["v1"]);
    expect(suivis.size).toBe(0);
  });
});
