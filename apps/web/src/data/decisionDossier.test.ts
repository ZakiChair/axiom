import { describe, expect, it } from "vitest";
import type { LectureAnalyse } from "./analyseMultidomaine";
import type { AlertDef, ContexteAlerte, Declenchement } from "@axiom/alerts";
import { creerDossierDepuisJournal, enrichirDeclenchement } from "./decisionDossier";

const def: AlertDef = {
  id: "alerte-1", symbol: "BTCUSDT", source: "binance", timeframe: "1h", actif: true,
  condition: { type: "prix-croise", niveau: 100, sens: "hausse" }, declenchements: [],
};
const declenchement: Declenchement = { alertId: "alerte-1", ts: 2000, valeur: 101, message: "Franchissement" };
const lecture: LectureAnalyse = { id: "q-us", domaine: "quadrant", nature: "observation", conclusion: "expansion",
  tags: [{ cle: "quadrant", valeur: "expansion" }], instrument: null, horizon: { depuis: 100, jusqua: 1000 },
  unite: null, valeur: null, source: "FRED", observeLe: 1000, recupereLe: 1500, validiteJusqua: 3000,
  statut: "frais", couverture: null, limites: [], preuve: { fenetre: "RATE", reference: "US" } };

describe("preuve de décision", () => {
  it("fige l'analyse au signal et la recopie sans lire un état tardif", () => {
    const original = structuredClone(lecture);
    const mutable = structuredClone(lecture);
    const journal = enrichirDeclenchement(declenchement, def, { maintenant: 2000, dernierPrix: 101 }, [mutable]);
    mutable.tags[0]!.valeur = "récession";
    const dossier = creerDossierDepuisJournal("capture", journal, 4000);
    expect(journal.preuve?.analyse).toEqual({ schemaVersion: 1, captureLe: 2000, lectures: [original] });
    expect(dossier.analyse).toEqual(journal.preuve?.analyse);
    expect(dossier.creeMs).toBe(4000);
  });

  it("rejette les captures futures et toutes les bornes de lecture après le signal", () => {
    const bon = enrichirDeclenchement(declenchement, def, { maintenant: 2000, dernierPrix: 101 }, [lecture]);
    for (const analyse of [
      { ...bon.preuve!.analyse!, captureLe: 2001 },
      { ...bon.preuve!.analyse!, lectures: [{ ...lecture, recupereLe: 2001 }] },
      { ...bon.preuve!.analyse!, lectures: [{ ...lecture, observeLe: 2001 }] },
      { ...bon.preuve!.analyse!, lectures: [{ ...lecture, horizon: { depuis: 100, jusqua: 2001 } }] },
      { ...bon.preuve!.analyse!, lectures: [{ ...lecture, valeur: Infinity }] },
      { ...bon.preuve!.analyse!, lectures: [{ ...lecture, horizon: { depuis: 100, jusqua: 1e20 } }] },
      { ...bon.preuve!.analyse!, lectures: [{ ...lecture, validiteJusqua: 1900, statut: "frais" }] },
      { ...bon.preuve!.analyse!, lectures: [lecture, lecture] },
      { ...bon.preuve!.analyse!, lectures: Array.from({ length: 51 }, (_, i) => ({ ...lecture, id: String(i) })) },
      { ...bon.preuve!.analyse!, inconnu: true },
    ]) {
      expect(creerDossierDepuisJournal("bad", { ...bon, preuve: { ...bon.preuve!, analyse } } as typeof bon).qualite).toBe("partielle");
    }
  });
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
