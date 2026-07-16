/**
 * @axiom/alerts — describe.test.ts
 *
 * Vérifie les libellés français des conditions + le formatage de durée.
 */
import { describe, expect, it } from "vitest";
import { decrireCondition, formaterDuree } from "./describe";

describe("formaterDuree", () => {
  it("choisit l'unité compacte selon l'ordre de grandeur", () => {
    expect(formaterDuree(30_000)).toBe("30 s");
    expect(formaterDuree(15 * 60_000)).toBe("15 min");
    expect(formaterDuree(4 * 3_600_000)).toBe("4 h");
    expect(formaterDuree(2 * 86_400_000)).toBe("2 j");
  });
});

describe("decrireCondition", () => {
  it("prix-croise selon le sens", () => {
    expect(decrireCondition({ type: "prix-croise", niveau: 100, sens: "hausse" })).toBe(
      "Prix franchit 100 à la hausse"
    );
    expect(decrireCondition({ type: "prix-croise", niveau: 100, sens: "baisse" })).toBe(
      "Prix franchit 100 à la baisse"
    );
    expect(decrireCondition({ type: "prix-croise", niveau: 100, sens: "les-deux" })).toBe(
      "Prix franchit 100"
    );
  });

  it("variation-pct affiche le signe et la fenêtre", () => {
    expect(decrireCondition({ type: "variation-pct", seuilPct: 5, fenetreMs: 15 * 60_000 })).toBe(
      "Variation +5% sur 15 min"
    );
    expect(decrireCondition({ type: "variation-pct", seuilPct: -3, fenetreMs: 3_600_000 })).toBe(
      "Variation -3% sur 1 h"
    );
  });

  it("conditions d'indicateur", () => {
    expect(
      decrireCondition({
        type: "indicateur-seuil",
        indicateurId: "rsi",
        params: { length: 14 },
        output: "rsi",
        comparateur: ">",
        valeur: 70,
      })
    ).toBe("rsi(rsi) > 70");
    expect(
      decrireCondition({
        type: "indicateur-croisement",
        indicateurId: "macd",
        params: {},
        outputA: "macd",
        outputB: "signal",
        sens: "hausse",
      })
    ).toBe("macd : macd croise à la hausse signal");
  });

  it("funding-extreme selon sens et seuils", () => {
    expect(
      decrireCondition({ type: "funding-extreme", sens: "long-crowded", seuilAbs: 0.001 })
    ).toBe("Funding extrême (long crowded, |rate|≥0.1%)");
    expect(decrireCondition({ type: "funding-extreme", sens: "les-deux", zSeuil: 2.5 })).toBe(
      "Funding extrême (long/short crowded, |z|≥2.5)"
    );
    expect(
      decrireCondition({
        type: "funding-extreme",
        sens: "short-crowded",
        seuilAbs: 0.0005,
        zSeuil: 3,
      })
    ).toBe("Funding extrême (short crowded, |rate|≥0.05% ou |z|≥3)");
  });

  it("liq-cascade en montant compact $/min", () => {
    expect(decrireCondition({ type: "liq-cascade", seuilUsdParMin: 5_000_000 })).toBe(
      "Cascade de liquidations ≥ 5M $/min"
    );
    expect(decrireCondition({ type: "liq-cascade", seuilUsdParMin: 2_500_000 })).toBe(
      "Cascade de liquidations ≥ 2.5M $/min"
    );
    expect(decrireCondition({ type: "liq-cascade", seuilUsdParMin: 750_000 })).toBe(
      "Cascade de liquidations ≥ 750K $/min"
    );
    expect(decrireCondition({ type: "liq-cascade", seuilUsdParMin: 500 })).toBe(
      "Cascade de liquidations ≥ 500 $/min"
    );
  });

  it("cvd-spot-perp-div selon kind", () => {
    expect(decrireCondition({ type: "cvd-spot-perp-div", kind: "spotUp_perpDown" })).toBe(
      "CVD divergence spot↑ perp↓"
    );
    expect(decrireCondition({ type: "cvd-spot-perp-div", kind: "spotDown_perpUp" })).toBe(
      "CVD divergence spot↓ perp↑"
    );
    expect(decrireCondition({ type: "cvd-spot-perp-div", kind: "les-deux" })).toBe(
      "CVD divergence spot/perp"
    );
  });
});
