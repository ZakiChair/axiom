import { describe, expect, it } from "vitest";
import { avisAlertesInactives, compterAlertesActives } from "./SessionStrip";
import { AVIS_ALERTES_INACTIVES, SOURCE_SANTE_ALERTES } from "../alerts/demarrageDiffere";
import type { SanteSource } from "../store/health";

describe("compteur du bandeau", () => {
  it("retire à l'échéance exacte sans masquer les alertes permanentes ou encore valides", () => {
    const fin = 1_000;
    const defs = [
      { actif: true },
      { actif: true, expireTs: fin },
      { actif: true, expireTs: fin + 1 },
      { actif: false },
    ];
    expect(compterAlertesActives(defs, fin - 1)).toBe(3);
    expect(compterAlertesActives(defs, fin)).toBe(2);
    expect(compterAlertesActives(defs, fin + 1)).toBe(1);
  });
});

describe("alertes inactives au bandeau", () => {
  const ligne = (source: string, patch: Partial<SanteSource>): SanteSource => ({ source, etat: "connected", dernierMessageTs: 0, ...patch });

  it("rend l'avis posé par le démarrage différé tant que la ligne « alertes » est en erreur", () => {
    const sources = { [SOURCE_SANTE_ALERTES]: ligne(SOURCE_SANTE_ALERTES, { etat: "error", derniereErreur: AVIS_ALERTES_INACTIVES }) };
    expect(avisAlertesInactives(sources)).toBe("Alertes inactives : module non chargé");
  });

  it("ne dit rien en nominal, ni quand une AUTRE source est en erreur", () => {
    expect(avisAlertesInactives({})).toBeUndefined();
    expect(avisAlertesInactives({ binance: ligne("binance", { etat: "error", derniereErreur: "503" }) })).toBeUndefined();
  });

  it("ligne en erreur sans texte : avis générique, jamais un compteur", () => {
    expect(avisAlertesInactives({ [SOURCE_SANTE_ALERTES]: ligne(SOURCE_SANTE_ALERTES, { etat: "error" }) })).toBe("Alertes inactives");
  });
});
