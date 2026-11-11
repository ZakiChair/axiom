/**
 * Tests du catalogue d'opérandes des règles EQS : réutilisation du catalogue du backtest,
 * exclusion des définitions que le screener ne sert pas à l'identique du graphe, ajout du
 * squeeze TTM et de NR / Inside, aller-retour opérande → contrôles.
 */
import { describe, expect, it } from "vitest";
import { getIndicator } from "@axiom/indicators";
import { CATALOGUE_OPERANDES } from "../store/backtest";
import { decrireOperandeScreener, OPERANDES_SCREENER, specOperandeScreener } from "./screenerOperandes";
import { raisonCondition } from "./screenerRegles";

describe("OPERANDES_SCREENER", () => {
  it("reprend le catalogue du backtest sans AXIS (série aux, amorce de 1500)", () => {
    const ids = OPERANDES_SCREENER.map((s) => s.id);
    expect(ids).toContain("supertrend:direction");
    expect(ids).toContain("ema:ema");
    expect(ids).toContain("prix:close");
    expect(ids.some((id) => id.startsWith("stratAxis"))).toBe(false);
    expect(ids).toEqual(expect.arrayContaining(["ttmSqueeze:on", "narrowRange:nr", "narrowRange:inside"]));
    expect(new Set(ids).size).toBe(ids.length);
    // Tout le reste du catalogue du backtest est conservé.
    const repris = CATALOGUE_OPERANDES.filter((s) => !s.id.startsWith("stratAxis")).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(repris));
  });

  it("chaque opérande pointe une sortie du registre et passe la validation sur une unité compatible", () => {
    for (const spec of OPERANDES_SCREENER) {
      const op = spec.make(spec.defaultParam);
      if (op.type === "indicateur") {
        expect(getIndicator(op.indicateurId)?.outputs.some((o) => o.key === op.output), spec.id).toBe(true);
      }
      const tf = op.type === "indicateur" && op.indicateurId === "rvolSeasonal" ? "1h" : "4h";
      const raison = raisonCondition(
        { kind: "regle", condition: { type: "comparaison", gauche: op, comparateur: ">", droite: { type: "constante", valeur: 0 } } },
        tf,
      );
      expect(raison, spec.id).toBeNull();
    }
  });

  it("RVOL saisonnier : le libellé dit l'historique réellement lu (plafond d'une requête)", () => {
    expect(specOperandeScreener("rvolSeasonal:rvol")?.label).toBe("RVOL saisonnier H1 (heure UTC) · ≈ 41 j lus");
    // Le catalogue du backtest n'est pas modifié.
    expect(CATALOGUE_OPERANDES.find((s) => s.id === "rvolSeasonal:rvol")?.label).toBe("RVOL saisonnier H1 (heure UTC)");
  });

  it("aller-retour : un opérande construit se relit avec sa spec et son paramètre", () => {
    const ttm = specOperandeScreener("ttmSqueeze:on")!;
    expect(decrireOperandeScreener(ttm.make(30))).toEqual({ specId: "ttmSqueeze:on", param: 30 });
    expect(decrireOperandeScreener({ type: "prix", champ: "high" })).toEqual({ specId: "prix:high" });
    expect(decrireOperandeScreener({ type: "constante", valeur: 2 })).toEqual({ specId: "constante" });
    const st = specOperandeScreener("supertrend:direction")!;
    expect(decrireOperandeScreener(st.make())).toEqual({ specId: "supertrend:direction" });
  });
});
