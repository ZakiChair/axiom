/**
 * Tests des fonctions PURES de la fenêtre BPL. Le rendu React et le canvas ne sont pas
 * testés ici : on couvre la validation de l'horizon saisi librement et le libellé des
 * repères d'axe — le second porte une régression silencieuse possible (un fuseau local
 * décalerait d'un jour des repères calculés en UTC).
 * Les maths du modèle et des axes vivent dans data/btcPowerLaw.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

// `../store/theme` pose un attribut sur `document` dès son import (boot du thème) : stubé
// pour que l'import du module composant reste possible en environnement Node.
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));

import { HORIZON_MAX_ANNEES, horizonValide, libelleAxe } from "./BtcPowerLawWindow";

describe("horizonValide", () => {
  it("borne la saisie à des années entières entre 0 et le maximum", () => {
    expect(horizonValide(37)).toBe(37);
    expect(horizonValide(0)).toBe(0);
    expect(horizonValide(HORIZON_MAX_ANNEES)).toBe(HORIZON_MAX_ANNEES);
    expect(horizonValide(120)).toBe(HORIZON_MAX_ANNEES);
    expect(horizonValide(-5)).toBe(0);
    expect(horizonValide(2.4)).toBe(2);
    expect(horizonValide(2.6)).toBe(3);
  });

  it("retombe sur 0 pour une saisie vide ou non numérique", () => {
    expect(horizonValide(Number("")))
      .toBe(0);
    expect(horizonValide(Number.NaN)).toBe(0);
    expect(horizonValide(Infinity)).toBe(0);
  });
});

describe("libelleAxe", () => {
  it("libelle chaque granularité sans jamais perdre l'année", () => {
    const jourDeLAn = Date.UTC(2013, 0, 1);
    expect(libelleAxe(jourDeLAn, "annee")).toBe("2013");
    expect(libelleAxe(jourDeLAn, "mois")).toContain("13");
    expect(libelleAxe(Date.UTC(2013, 2, 10), "jour")).toBe("10/03/13");
  });

  it("reste en UTC : un instant de fin de journée ne bascule pas au jour suivant", () => {
    const finDeJournee = Date.UTC(2013, 2, 10, 23, 30);
    expect(libelleAxe(finDeJournee, "jour")).toBe("10/03/13");
    expect(libelleAxe(Date.UTC(2012, 11, 31, 23, 59), "annee")).toBe("2012");
  });
});
