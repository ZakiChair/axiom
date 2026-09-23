/** Le constructeur explicite garde un défaut tradfi reconnu ; gestes réels en E2E. */
import { describe, expect, it } from "vitest";
import { JAMBE_B_TRADFI_DEFAUT } from "./PairSearch";
import { TWELVEDATA_SYMBOLS } from "../data/pairs";

describe("constructeur SYN — jambe B par défaut", () => {
  it("le défaut de la jambe B est un actif tradfi reconnu pour le routage automatique", () => {
    expect(TWELVEDATA_SYMBOLS).toContain(JAMBE_B_TRADFI_DEFAUT);
  });
});
