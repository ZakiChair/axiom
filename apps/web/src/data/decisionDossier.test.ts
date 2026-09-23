import { describe, expect, it } from "vitest";
import type { AlertDef, ContexteAlerte, Declenchement } from "@axiom/alerts";
import { creerDossierDepuisJournal, enrichirDeclenchement } from "./decisionDossier";

const def: AlertDef = {
  id: "alerte-1", symbol: "BTCUSDT", source: "binance", timeframe: "1h", actif: true,
  condition: { type: "prix-croise", niveau: 100, sens: "hausse" }, declenchements: [],
};
const declenchement: Declenchement = { alertId: "alerte-1", ts: 2000, valeur: 101, message: "Franchissement" };

describe("preuve de décision", () => {
  it("capture uniquement le contexte connu au déclenchement, sans série ni futur", () => {
    const ctx: ContexteAlerte = {
      maintenant: 2000, dernierPrix: 101, prixPrecedent: 99, fundingRate: 0.0001,
      candles: [
        { time: 1000, open: 98, high: 102, low: 97, close: 100, volume: 2, closed: true },
        { time: 3000, open: 100, high: 120, low: 90, close: 110, volume: 3, closed: true },
      ],
    };
    const journal = enrichirDeclenchement(declenchement, def, ctx);
    const dossier = creerDossierDepuisJournal("d1", journal);
    expect(dossier.origine).toMatchObject({ alertId: "alerte-1", ts: 2000, symbol: "BTCUSDT", source: "binance", valeur: 101 });
    expect(dossier.contexte).toMatchObject({ dernierPrix: 101, prixPrecedent: 99, fundingRate: 0.0001,
      derniereBougie: { time: 1000, close: 100 } });
    expect(JSON.stringify(dossier)).not.toContain("3000");
    expect(journal.preuve?.contexte).not.toHaveProperty("candles");
  });

  it("garde l'origine après suppression de la définition, mais marque un vieux journal partiel", () => {
    const enrichi = enrichirDeclenchement(declenchement, def, { maintenant: 2000, dernierPrix: 101 });
    def.condition = { type: "prix-croise", niveau: 999, sens: "baisse" };
    expect(creerDossierDepuisJournal("d2", enrichi).origine.condition).toMatchObject({ niveau: 100 });
    const ancien = creerDossierDepuisJournal("d3", declenchement);
    expect(ancien.qualite).toBe("partielle");
    expect(ancien.origine.symbol).toBeNull();
    expect(ancien.contexte).toEqual({});
  });

  it("dégrade une preuve importée malformée ou future en contexte partiel sans lire le marché courant", () => {
    const bonne = enrichirDeclenchement(declenchement, def, { maintenant: 2000, dernierPrix: 101 });
    const cas = [
      { ...bonne.preuve!, origine: { ...bonne.preuve!.origine, condition: { type: "composite", conditions: null } } },
      { ...bonne.preuve!, origine: { ...bonne.preuve!.origine, source: "venue-inconnue" } },
      { ...bonne.preuve!, contexte: { derniereBougie: { time: 3000, open: 1, high: 2, low: 1, close: 2, volume: 1 } } },
    ];
    for (const preuve of cas) {
      const dossier = creerDossierDepuisJournal("bad", { ...bonne, preuve } as unknown as typeof bonne);
      expect(dossier.qualite).toBe("partielle");
      expect(dossier.origine).toMatchObject({ alertId: declenchement.alertId, ts: 2000, source: null, condition: null });
      expect(dossier.contexte).toEqual({});
    }
  });
});
