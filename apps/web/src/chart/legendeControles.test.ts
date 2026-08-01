/**
 * Règles PURES des légendes du graphe (env vitest node, pas de jsdom dans apps/web —
 * même convention que StrategyMenu.test.tsx : on verrouille les décisions, le rendu
 * réel passe par le gate visuel).
 *
 * Ces trois modules portent le geste central du lot A — identifier une courbe, la
 * régler, la retirer depuis le graphe — et n'avaient aucun test.
 */
import { describe, expect, it } from "vitest";
import type { IndicatorDef } from "@axiom/types";
import { etiquetteBouton, varSerie } from "./legendeControles";
import { estReglable } from "./legendeReglable";
import { dansLaBoite, instancePourY } from "./paneSousCurseur";
import { NB_COULEURS_SERIE } from "../store/indicators";

describe("varSerie", () => {
  it("mappe l'index 0-based sur les tokens 1-based du thème", () => {
    expect(varSerie(0)).toBe("var(--serie-1)");
    expect(varSerie(5)).toBe("var(--serie-6)");
  });

  it("replie dans la bande plutôt que produire --serie-0 ou --serie-7", () => {
    expect(varSerie(NB_COULEURS_SERIE)).toBe("var(--serie-1)");
    expect(varSerie(-1)).toBe("var(--serie-6)");
    expect(varSerie(Number.NaN)).toBe("var(--serie-1)");
  });

  it("passe par une VARIABLE CSS, jamais par une valeur résolue", () => {
    // Le changement de thème doit repeindre la pastille sans qu'aucun code n'intervienne
    // — contrairement au canvas, où lireTokenCanvas est obligatoire.
    expect(varSerie(2).startsWith("var(--")).toBe(true);
  });
});

describe("etiquetteBouton", () => {
  it("nomme la cible : trois croix anonymes, c'est la mauvaise courbe fermée", () => {
    expect(etiquetteBouton("close", "EMA (20)")).toBe("Fermer EMA (20)");
    expect(etiquetteBouton("settings", "EMA (20)")).toBe("Réglages de EMA (20)");
  });

  it("distingue les deux instances d'une même définition", () => {
    expect(etiquetteBouton("close", "EMA (20)")).not.toBe(etiquetteBouton("close", "EMA (50)"));
  });
});

describe("estReglable", () => {
  const def = (over: Partial<IndicatorDef>): IndicatorDef =>
    ({
      id: "x",
      name: "X",
      category: "trend",
      pane: "overlay",
      inputs: [],
      outputs: [],
      ...over,
    }) as IndicatorDef;
  const avecParam = [{ key: "length" }] as unknown as IndicatorDef["inputs"];

  it("refuse une définition inconnue", () => {
    expect(estReglable(undefined)).toBe(false);
  });

  it("refuse les STRATÉGIES : la section « Actifs » du menu les exclut par construction", () => {
    expect(estReglable(def({ category: "strategy", inputs: avecParam }))).toBe(false);
  });

  it("refuse une définition SANS paramètre (l'éditeur n'afficherait que « Aucun paramètre »)", () => {
    expect(estReglable(def({ inputs: [] }))).toBe(false);
  });

  it("accepte une définition technique paramétrable", () => {
    expect(estReglable(def({ inputs: avecParam }))).toBe(true);
  });
});

describe("instancePourY (double-clic sur un pane)", () => {
  it("exclut la borne HAUTE : deux panes adjacents ne se chevauchent pas d'un pixel", () => {
    expect(dansLaBoite(100, { top: 0, height: 100 })).toBe(false);
    expect(dansLaBoite(99, { top: 0, height: 100 })).toBe(true);
    expect(dansLaBoite(100, { top: 100, height: 100 })).toBe(true);
  });

  it("désigne le pane sous le curseur", () => {
    const panes = [
      { instanceId: "a", boite: { top: 0, height: 100 } },
      { instanceId: "b", boite: { top: 100, height: 100 } },
    ];
    expect(instancePourY(50, panes)).toBe("a");
    expect(instancePourY(150, panes)).toBe("b");
  });

  it("renvoie null hors de tout pane — le pane prix n'est jamais dans la liste", () => {
    expect(instancePourY(500, [{ instanceId: "a", boite: { top: 0, height: 100 } }])).toBeNull();
  });

  it("ignore un pane dont la géométrie n'est pas encore connue", () => {
    expect(instancePourY(50, [{ instanceId: "a", boite: null }])).toBeNull();
  });
});
