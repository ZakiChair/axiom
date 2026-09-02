/**
 * Tests des helpers PURS du panneau Alertes : construction de la condition
 * `indicateur-croisement` (formulaire) et cible de navigation d'un déclenchement.
 */
import { describe, expect, it } from "vitest";
import { decrireCondition, validerComposite, type AlertDef } from "@axiom/alerts";
import { cibleAlerte, construireConditionCroisement, INDICATEURS_CROISEMENT } from "./alertsPanel.util";

/** Def minimale pour les tests de cible de navigation. */
function def(id: string, symbol: string, source: AlertDef["source"]): AlertDef {
  return {
    id,
    symbol,
    source,
    condition: { type: "prix-croise", niveau: 1, sens: "hausse" },
    actif: true,
    declenchements: [],
  };
}

describe("INDICATEURS_CROISEMENT", () => {
  it("ne retient que des indicateurs sur bougies seules avec au moins deux sorties", () => {
    expect(INDICATEURS_CROISEMENT.length).toBeGreaterThan(0);
    for (const d of INDICATEURS_CROISEMENT) {
      expect(d.outputs.length).toBeGreaterThanOrEqual(2);
      expect(d.aux === undefined || d.aux.length === 0).toBe(true);
    }
  });

  it("contient MACD (cas d'usage de référence : macd × signal)", () => {
    expect(INDICATEURS_CROISEMENT.map((d) => d.id)).toContain("macd");
  });
});

describe("construireConditionCroisement", () => {
  it("construit la condition attendue par le moteur", () => {
    expect(construireConditionCroisement("macd", "macd", "signal", "hausse")).toEqual({
      type: "indicateur-croisement",
      indicateurId: "macd",
      params: {},
      outputA: "macd",
      outputB: "signal",
      sens: "hausse",
    });
  });

  it("refuse deux fois la même sortie (croisement d'une série avec elle-même)", () => {
    expect(construireConditionCroisement("macd", "macd", "macd", "hausse")).toBeNull();
  });

  it("refuse un indicateur inconnu", () => {
    expect(construireConditionCroisement("inconnu", "a", "b", "hausse")).toBeNull();
  });

  it("refuse une sortie absente de l'indicateur", () => {
    expect(construireConditionCroisement("macd", "macd", "fantome", "baisse")).toBeNull();
  });

  it("produit un libellé lisible via decrireCondition", () => {
    const c = construireConditionCroisement("macd", "macd", "signal", "hausse");
    expect(c).not.toBeNull();
    expect(decrireCondition(c!)).toBe("macd : macd croise à la hausse signal");
  });
});

describe("cibleAlerte", () => {
  it("retrouve symbole et source de la def d'un déclenchement", () => {
    const defs = [def("a1", "BTCUSDT", "binance"), def("a2", "ETHUSDT", "bybit")];
    expect(cibleAlerte(defs, "a2")).toEqual({ symbol: "ETHUSDT", source: "bybit" });
  });

  it("renvoie null si la def a été supprimée depuis le déclenchement", () => {
    expect(cibleAlerte([def("a1", "BTCUSDT", "binance")], "disparue")).toBeNull();
  });
});

describe("validerComposite", () => {
  it("accepte 2–4 sous-conditions atomiques, refuse whale-flux / les-deux / n=1", () => {
    const prix = { type: "prix-croise" as const, niveau: 100, sens: "hausse" as const };
    const fund = { type: "funding-extreme" as const, sens: "short-crowded" as const, zSeuil: 2 };
    expect(validerComposite([prix, fund])).toBe(true);
    expect(validerComposite([prix])).toBe(false);
    expect(validerComposite([{ type: "prix-croise", niveau: 1, sens: "les-deux" }, fund])).toBe(false);
    expect(validerComposite([prix, { type: "whale-flux", seuilUsd: 1, direction: "tous" }])).toBe(false);
  });
});
