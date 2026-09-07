import { beforeEach, describe, expect, it } from "vitest";
import { macroRatesViewStore } from "./macroRatesView";

// `demanderCourbe` (CRVF) et `demanderIndicateurs` (bouton « série » d'ECO) pilotent tous
// deux le même `onglet` de MacroRatesWindow via deux compteurs MUTUELLEMENT EXCLUSIFS — cf.
// le commentaire du fichier source. Ces tests épinglent l'exclusion mutuelle : sans elle,
// un compteur resté non nul d'une commande ancienne redevient actif au remontage suivant
// de MacroRatesWindow (elle est démontée à la fermeture), en concurrence avec la commande
// la plus récente.
describe("macroRatesViewStore", () => {
  beforeEach(() => {
    macroRatesViewStore.setState({ vue: "tableau", requete: 0, requeteIndicateurs: 0 });
  });

  it("demanderCourbe() bascule en vue courbe, incrémente requete, laisse requeteIndicateurs à 0", () => {
    macroRatesViewStore.getState().demanderCourbe();
    const s = macroRatesViewStore.getState();
    expect(s.vue).toBe("courbe");
    expect(s.requete).toBe(1);
    expect(s.requeteIndicateurs).toBe(0);
  });

  it("demanderIndicateurs() incrémente requeteIndicateurs et remet requete à 0", () => {
    macroRatesViewStore.getState().demanderCourbe(); // requete = 1, pour vérifier la remise à zéro
    macroRatesViewStore.getState().demanderIndicateurs();
    const s = macroRatesViewStore.getState();
    expect(s.requeteIndicateurs).toBe(1);
    expect(s.requete).toBe(0);
  });

  it("demanderIndicateurs() puis demanderCourbe() laisse requeteIndicateurs à 0 (interleaving du défaut)", () => {
    macroRatesViewStore.getState().demanderIndicateurs();
    macroRatesViewStore.getState().demanderCourbe();
    const s = macroRatesViewStore.getState();
    expect(s.requeteIndicateurs).toBe(0);
    expect(s.requete).toBe(1);
    expect(s.vue).toBe("courbe");
  });

  it("demanderCourbe() puis demanderIndicateurs() laisse requete à 0 (ordre inverse)", () => {
    macroRatesViewStore.getState().demanderCourbe();
    macroRatesViewStore.getState().demanderIndicateurs();
    const s = macroRatesViewStore.getState();
    expect(s.requete).toBe(0);
    expect(s.requeteIndicateurs).toBe(1);
  });
});
