/**
 * Tests des helpers PURES de navigation au clavier (watchlist, timeframe, historique).
 *
 * Aucun mock nécessaire : le module est 100 % pur (aucun store, aucun DOM).
 */
import { describe, expect, it } from "vitest";

import {
  avancer,
  HISTORIQUE_VIDE,
  peutAvancer,
  peutReculer,
  pousserSymbole,
  reculer,
  symboleVoisin,
  timeframeVoisin,
  type EtatHistorique,
} from "./navigationClavier";

describe("symboleVoisin", () => {
  const liste = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

  it("descend d'un cran", () => {
    expect(symboleVoisin(liste, "BTCUSDT", 1)).toBe("ETHUSDT");
  });

  it("monte d'un cran", () => {
    expect(symboleVoisin(liste, "SOLUSDT", -1)).toBe("ETHUSDT");
  });

  it("boucle en fin de liste", () => {
    expect(symboleVoisin(liste, "SOLUSDT", 1)).toBe("BTCUSDT");
  });

  it("boucle en début de liste", () => {
    expect(symboleVoisin(liste, "BTCUSDT", -1)).toBe("SOLUSDT");
  });

  it("sélectionne le premier si le symbole courant est hors watchlist (descente)", () => {
    expect(symboleVoisin(liste, "XRPUSDT", 1)).toBe("BTCUSDT");
  });

  it("sélectionne le dernier si le symbole courant est hors watchlist (montée)", () => {
    expect(symboleVoisin(liste, "XRPUSDT", -1)).toBe("SOLUSDT");
  });

  it("null sur liste vide", () => {
    expect(symboleVoisin([], "BTCUSDT", 1)).toBeNull();
  });

  it("null si la liste ne contient qu'un seul symbole, déjà courant (pas de saut inutile)", () => {
    expect(symboleVoisin(["BTCUSDT"], "BTCUSDT", 1)).toBeNull();
  });

  it("est insensible à la casse du symbole courant", () => {
    expect(symboleVoisin(liste, "btcusdt", 1)).toBe("ETHUSDT");
  });
});

describe("timeframeVoisin", () => {
  const supportes = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

  it("avance au timeframe supérieur", () => {
    expect(timeframeVoisin(supportes, "5m", 1)).toBe("15m");
  });

  it("recule au timeframe inférieur", () => {
    expect(timeframeVoisin(supportes, "1h", -1)).toBe("15m");
  });

  it("ne boucle PAS aux bornes (un TF est ordonné, pas cyclique)", () => {
    expect(timeframeVoisin(supportes, "1d", 1)).toBeNull();
    expect(timeframeVoisin(supportes, "1m", -1)).toBeNull();
  });

  it("null si le timeframe courant n'est pas supporté", () => {
    expect(timeframeVoisin(supportes, "3M", 1)).toBeNull();
  });

  it("null sur liste vide", () => {
    expect(timeframeVoisin([], "1h", 1)).toBeNull();
  });
});

describe("historique de symboles", () => {
  it("part d'un historique vide, sans navigation possible", () => {
    expect(peutReculer(HISTORIQUE_VIDE)).toBe(false);
    expect(peutAvancer(HISTORIQUE_VIDE)).toBe(false);
  });

  it("empile les symboles visités", () => {
    let h: EtatHistorique = HISTORIQUE_VIDE;
    h = pousserSymbole(h, "BTCUSDT");
    h = pousserSymbole(h, "ETHUSDT");
    expect(h.pile).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(h.index).toBe(1);
    expect(peutReculer(h)).toBe(true);
    expect(peutAvancer(h)).toBe(false);
  });

  it("ignore un symbole identique au courant (pas de doublon consécutif)", () => {
    let h = pousserSymbole(HISTORIQUE_VIDE, "BTCUSDT");
    h = pousserSymbole(h, "BTCUSDT");
    expect(h.pile).toEqual(["BTCUSDT"]);
  });

  it("recule puis avance en restituant les symboles", () => {
    let h: EtatHistorique = HISTORIQUE_VIDE;
    h = pousserSymbole(h, "BTCUSDT");
    h = pousserSymbole(h, "ETHUSDT");
    h = pousserSymbole(h, "SOLUSDT");

    const r1 = reculer(h);
    expect(r1.symbole).toBe("ETHUSDT");
    const r2 = reculer(r1.etat);
    expect(r2.symbole).toBe("BTCUSDT");
    expect(peutReculer(r2.etat)).toBe(false);

    const a1 = avancer(r2.etat);
    expect(a1.symbole).toBe("ETHUSDT");
  });

  it("reculer au-delà du début est un no-op", () => {
    const h = pousserSymbole(HISTORIQUE_VIDE, "BTCUSDT");
    const r = reculer(h);
    expect(r.symbole).toBeNull();
    expect(r.etat).toEqual(h);
  });

  it("avancer au-delà de la fin est un no-op", () => {
    const h = pousserSymbole(HISTORIQUE_VIDE, "BTCUSDT");
    const a = avancer(h);
    expect(a.symbole).toBeNull();
    expect(a.etat).toEqual(h);
  });

  it("empiler après un retour arrière TRONQUE la branche avant (sémantique navigateur)", () => {
    let h: EtatHistorique = HISTORIQUE_VIDE;
    h = pousserSymbole(h, "BTCUSDT");
    h = pousserSymbole(h, "ETHUSDT");
    h = pousserSymbole(h, "SOLUSDT");
    const r = reculer(h); // index sur ETHUSDT
    const suite = pousserSymbole(r.etat, "XRPUSDT");
    expect(suite.pile).toEqual(["BTCUSDT", "ETHUSDT", "XRPUSDT"]);
    expect(peutAvancer(suite)).toBe(false);
  });

  it("borne la pile pour ne pas croître indéfiniment", () => {
    let h: EtatHistorique = HISTORIQUE_VIDE;
    for (let i = 0; i < 80; i += 1) h = pousserSymbole(h, `SYM${i}`);
    expect(h.pile.length).toBeLessThanOrEqual(50);
    // Le plus récent reste le courant.
    expect(h.pile[h.index]).toBe("SYM79");
  });
});
