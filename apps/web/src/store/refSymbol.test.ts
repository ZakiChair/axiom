import { afterEach, describe, expect, it } from "vitest";
import { refSymbolStore, REF_SYMBOL_DEFAUT } from "./refSymbol";

/**
 * Le store refSymbol est session-only (persistance déléguée à persist.ts) :
 * on remet la valeur au défaut après chaque test pour l'isolation.
 */
describe("refSymbolStore — symbole de référence des indicateurs croisés", () => {
  afterEach(() => {
    refSymbolStore.getState().setRefSymbol(REF_SYMBOL_DEFAUT);
  });

  it("vaut BTCUSDT par défaut", () => {
    expect(refSymbolStore.getState().refSymbol).toBe("BTCUSDT");
  });

  it("setRefSymbol met à jour la valeur", () => {
    refSymbolStore.getState().setRefSymbol("ETHUSDT");
    expect(refSymbolStore.getState().refSymbol).toBe("ETHUSDT");
  });

  it("normalise en MAJUSCULES et retire les espaces de bord", () => {
    refSymbolStore.getState().setRefSymbol("  ethusdt  ");
    expect(refSymbolStore.getState().refSymbol).toBe("ETHUSDT");
  });

  it("ignore une valeur vide (ou uniquement des espaces) — garde la valeur courante", () => {
    refSymbolStore.getState().setRefSymbol("SOLUSDT");
    refSymbolStore.getState().setRefSymbol("   ");
    expect(refSymbolStore.getState().refSymbol).toBe("SOLUSDT");
  });
});
