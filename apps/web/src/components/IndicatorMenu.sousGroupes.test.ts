/**
 * Sous-groupes d'affichage de la catégorie Dérivés (lot A v2.6) : la table
 * SOUS_GROUPES_DERIVES doit rester EXHAUSTIVE — un def `derivatives` câblé sans
 * classement ferait retomber l'entrée dans « Dérivés perp » en silence ; ce test
 * force à classer avant de câbler. Env vitest node → helpers purs.
 */
import { describe, expect, it } from "vitest";
import { INDICATORS } from "@axiom/indicators";
import { groupesAffichage, INDICATEURS_ANALYSE, SOUS_GROUPES_DERIVES } from "./IndicatorMenu";

describe("SOUS_GROUPES_DERIVES (exhaustivité)", () => {
  it("classe TOUS les defs de catégorie derivatives, sans entrée orpheline", () => {
    const derives = INDICATORS.filter((d) => d.category === "derivatives").map((d) => d.id);
    for (const id of derives) {
      expect(SOUS_GROUPES_DERIVES[id], `def derivatives non classé : ${id}`).toBeDefined();
    }
    // Aucune clé de la table ne pointe vers un def disparu ou reclassé.
    const connus = new Set(derives);
    for (const id of Object.keys(SOUS_GROUPES_DERIVES)) {
      expect(connus.has(id), `entrée orpheline dans la table : ${id}`).toBe(true);
    }
  });
});

describe("groupesAffichage", () => {
  it("ne découpe QUE la catégorie Dérivés, dans l'ordre perp → on-chain → positionnement", () => {
    const derives = INDICATEURS_ANALYSE.filter((d) => d.category === "derivatives");
    const groupes = groupesAffichage("derivatives", derives);
    expect(groupes.map(([titre]) => titre)).toEqual([
      "Dérivés perp",
      "On-chain",
      "Positionnement",
    ]);
    // Partition complète : rien ne se perd, rien ne se duplique.
    const total = groupes.reduce((n, [, defs]) => n + defs.length, 0);
    expect(total).toBe(derives.length);
  });

  it("rend un unique groupe sans sous-titre pour les autres catégories", () => {
    const trend = INDICATEURS_ANALYSE.filter((d) => d.category === "trend");
    expect(groupesAffichage("trend", trend)).toEqual([[null, trend]]);
  });
});
