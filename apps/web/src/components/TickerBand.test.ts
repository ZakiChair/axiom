/**
 * Tests des fonctions PURES du bandeau ticker (TickerBand). Le rendu React n'est pas
 * testé (pas d'environnement DOM ici) : on couvre la durée de défilement par paliers
 * (stabilité entre cycles → pas de saut de piste) et la détection « aucun flux actif »
 * (état « Actualités indisponibles » vs « Chargement… »).
 */
import { describe, expect, it } from "vitest";
import { aucunFluxActif, dureeDefilementS } from "./TickerBand";
import type { NewsSourceId } from "../data/news";

/** Fabrique un item minimal (seul `title` compte pour la durée). */
function item(title: string): { title: string } {
  return { title };
}

describe("dureeDefilementS", () => {
  it("borne basse : jamais sous un palier (30 s), même piste vide", () => {
    expect(dureeDefilementS([])).toBe(30);
    expect(dureeDefilementS([item("x")])).toBe(30);
  });

  it("multiple exact du palier (arrondi au supérieur)", () => {
    const d = dureeDefilementS(Array.from({ length: 30 }, () => item("Bitcoin franchit un nouveau seuil")));
    expect(d % 30).toBe(0);
    expect(d).toBeGreaterThanOrEqual(30);
  });

  it("stable pour des contenus proches (même palier) — la piste ne saute pas entre cycles", () => {
    const base = Array.from({ length: 10 }, (_, i) => item(`Headline numéro ${i} du cycle`));
    const variante = [...base.slice(0, 9), item("Headline numéro 9 du cycle bis")]; // ± quelques caractères
    expect(dureeDefilementS(variante)).toBe(dureeDefilementS(base));
  });

  it("croît avec le contenu (plus de texte → durée supérieure ou égale)", () => {
    const court = [item("a")];
    const long = Array.from({ length: 30 }, () => item("Une très longue headline macroéconomique détaillée"));
    expect(dureeDefilementS(long)).toBeGreaterThan(dureeDefilementS(court));
  });
});

describe("aucunFluxActif", () => {
  const ids: readonly NewsSourceId[] = ["coindesk", "cointelegraph", "theblock"];

  it("statuts vides (premier cycle en cours) → false : encore de l'espoir, « Chargement… »", () => {
    expect(aucunFluxActif(ids, {})).toBe(false);
  });

  it("tous en erreur → true", () => {
    expect(aucunFluxActif(ids, { coindesk: "erreur", cointelegraph: "erreur", theblock: "erreur" })).toBe(true);
  });

  it("mélange erreur/vide (tous terminés, rien à afficher) → true", () => {
    expect(aucunFluxActif(ids, { coindesk: "erreur", cointelegraph: "vide", theblock: "vide" })).toBe(true);
  });

  it("un seul flux ok → false", () => {
    expect(aucunFluxActif(ids, { coindesk: "erreur", cointelegraph: "ok", theblock: "erreur" })).toBe(false);
  });

  it("un flux encore en attente (statut absent) parmi des erreurs → false", () => {
    expect(aucunFluxActif(ids, { coindesk: "erreur", cointelegraph: "erreur" })).toBe(false);
  });

  it("ignore les statuts de sources hors liste (gdelt)", () => {
    expect(aucunFluxActif(ids, { coindesk: "erreur", cointelegraph: "erreur", theblock: "erreur", gdelt: "ok" })).toBe(
      true
    );
  });
});
