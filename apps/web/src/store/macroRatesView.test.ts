import { beforeEach, describe, expect, it } from "vitest";
import { macroRatesViewStore } from "./macroRatesView";

beforeEach(() => {
  macroRatesViewStore.setState({ vue: "tableau", requete: 0, requeteIndicateurs: 0, indicateur: "cpi-aa", regions: ["US"], horizonAnnees: 5, connuLe: null });
});

// `demanderCourbe` (CRVF) et `demanderIndicateurs` (bouton « série » d'ECO) pilotent tous
// deux le même `onglet` de MacroRatesWindow via deux compteurs MUTUELLEMENT EXCLUSIFS — cf.
// le commentaire du fichier source. Ces tests épinglent l'exclusion mutuelle : sans elle,
// un compteur resté non nul d'une commande ancienne redevient actif au remontage suivant
// de MacroRatesWindow (elle est démontée à la fermeture), en concurrence avec la commande
// la plus récente.
describe("macroRatesViewStore", () => {
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

describe("sélection macro depuis ECO ou palette", () => {
  it("ouvre la famille et région demandées sans perdre l'horizon", () => {
    macroRatesViewStore.getState().selectionnerHorizon(10);
    macroRatesViewStore.getState().demanderIndicateurs({ indicateur: "pib-aa", region: "CA" });
    expect(macroRatesViewStore.getState()).toMatchObject({ indicateur: "pib-aa", regions: ["CA"], horizonAnnees: 10, requete: 0 });
  });
  it("normalise les zones du filtre en ordre stable, sans doublon", () => {
    macroRatesViewStore.getState().selectionnerRegions(["CH", "US", "CH"]);
    expect(macroRatesViewStore.getState().regions).toEqual(["US", "CH"]);
  });
});

it("sélectionne US pour une famille US quand la sélection précédente l'exclut", () => {
  macroRatesViewStore.getState().selectionnerRegions(["CA"]);
  macroRatesViewStore.getState().selectionnerIndicateur("nfci");
  expect(macroRatesViewStore.getState().regions).toEqual(["US"]);
});

describe.each(["selectionnerIndicateur", "demanderIndicateurs"] as const)("horizon dette via %s", (action) => {
  const selectionner = (indicateur: "dette-pib" | "cpi-aa") => {
    if (action === "selectionnerIndicateur") macroRatesViewStore.getState().selectionnerIndicateur(indicateur);
    else macroRatesViewStore.getState().demanderIndicateurs({ indicateur });
  };

  it("ouvre l'historique maximal à l'entrée dans la famille dette", () => {
    macroRatesViewStore.getState().selectionnerHorizon(10);
    selectionner("dette-pib");
    expect(macroRatesViewStore.getState()).toMatchObject({ indicateur: "dette-pib", horizonAnnees: "max" });
  });

  it.each([30, 60, "max"] as const)("ramène l'horizon %s à 5 ans en quittant la dette", (horizonAnnees) => {
    macroRatesViewStore.setState({ indicateur: "dette-pib", horizonAnnees });
    selectionner("cpi-aa");
    expect(macroRatesViewStore.getState()).toMatchObject({ indicateur: "cpi-aa", horizonAnnees: 5 });
  });

  it.each([1, 5, 10] as const)("conserve l'horizon %s en quittant la dette", (horizonAnnees) => {
    macroRatesViewStore.setState({ indicateur: "dette-pib", horizonAnnees });
    selectionner("cpi-aa");
    expect(macroRatesViewStore.getState().horizonAnnees).toBe(horizonAnnees);
  });

  it("ne réinitialise pas l'horizon quand la même famille dette est redemandée", () => {
    macroRatesViewStore.setState({ indicateur: "dette-pib", horizonAnnees: 60 });
    selectionner("dette-pib");
    expect(macroRatesViewStore.getState().horizonAnnees).toBe(60);
  });
});

it("une commande sans nouvelle famille conserve l'horizon de dette", () => {
  macroRatesViewStore.setState({ indicateur: "dette-pib", horizonAnnees: 30 });
  macroRatesViewStore.getState().demanderIndicateurs({ region: "CA" });
  expect(macroRatesViewStore.getState()).toMatchObject({ indicateur: "dette-pib", horizonAnnees: 30, regions: ["CA"], requeteIndicateurs: 1 });
});
