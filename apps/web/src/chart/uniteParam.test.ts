import { describe, expect, it } from "vitest";
import { CLE_UNITE, motifUniteHorsGraphe, suffixeUnite, uniteDemandee, uniteImbriquee } from "./uniteParam";

describe("paramètre réservé « unité »", () => {
  it("lit l'unité demandée ; vide, absente ou non textuelle = unité du graphe", () => {
    expect(CLE_UNITE).toBe("unite");
    expect(uniteDemandee({ length: 20, unite: "4h" })).toBe("4h");
    expect(uniteDemandee({ length: 20 })).toBeNull();
    expect(uniteDemandee({ unite: "" })).toBeNull();
    expect(uniteDemandee({ unite: 4 })).toBeNull();
  });

  it("suffixe la légende « [4h] » seulement quand une unité est posée", () => {
    expect(suffixeUnite({ length: 20, unite: "1d" })).toBe(" [1d]");
    expect(suffixeUnite({ length: 20 })).toBe("");
  });

  it("trouve une unité imbriquée dans une alerte composite ou une règle de backtest", () => {
    const composite = {
      type: "composite",
      conditions: [
        { type: "variation-pct", fenetreMs: 60_000, seuilPct: 5 },
        { type: "indicateur-seuil", indicateurId: "rsi", params: { length: 14, unite: "4h" }, output: "rsi", comparateur: ">", valeur: 70 },
      ],
    };
    expect(uniteImbriquee(composite)).toBe("4h");
    const regles = [
      { type: "comparaison", gauche: { type: "prix", champ: "close" }, comparateur: ">", droite: { type: "indicateur", indicateurId: "ema", params: { length: 50, unite: "1d" }, output: "ema" } },
    ];
    expect(uniteImbriquee(regles)).toBe("1d");
  });

  it("toute valeur posée compte (même vide) ; sans clé, rien", () => {
    expect(uniteImbriquee({ type: "indicateur-seuil", params: { unite: "" } })).toBe("");
    expect(uniteImbriquee({ type: "indicateur-seuil", indicateurId: "rsi", params: { length: 14 } })).toBeNull();
    expect(uniteImbriquee([{ a: { b: { c: 1 } } }, null, 3, "x"])).toBeNull();
    expect(uniteImbriquee(null)).toBeNull();
  });

  it("motif explicite, nommant l'unité et la cible", () => {
    expect(motifUniteHorsGraphe("4h", "alerte")).toBe(
      "Paramètre « unité » [4h] réservé au graphe : l'alerte calculerait sur ses propres bougies, sans unité supérieure. Retire ce paramètre.",
    );
    expect(motifUniteHorsGraphe("1d", "backtest")).toContain("le backtest calculerait");
  });
});
