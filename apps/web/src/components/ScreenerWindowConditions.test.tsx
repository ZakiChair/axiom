import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { basculerTypeRegle, LigneCondition } from "./ScreenerWindowConditions";
import { PRESETS_DESCRIPTIFS } from "../data/screenerRegles";

const rien = () => {};

describe("lignes de conditions EQS", () => {
  it("champ de force relative : groupes du sélecteur, unité imposée 1d, fenêtre K", () => {
    const html = renderToStaticMarkup(
      <LigneCondition
        cond={{ kind: "indicator", fieldId: "rsMansfield", op: ">", value: 0, fenetre: 2 }}
        tfRun="4h"
        raison={null}
        onChange={rien}
        onRemove={rien}
      />,
    );
    expect(html).toContain('label="Flux (volume taker Binance)"');
    expect(html).toContain('label="Force relative vs réf. (descriptif)"');
    expect(html).toContain('title="Unité imposée par le champ">1d<');
    expect(html).toContain('aria-label="Fenêtre K (bougies closes)"');
    expect(html).toContain('value="2"');
    expect(html).toContain("52 semaines");
  });

  it("règle du préréglage squeeze : croisement ↓, opérande TTM, raison de refus affichée", () => {
    const regle = PRESETS_DESCRIPTIFS[0]!.indicatorConditions[0]!;
    const html = renderToStaticMarkup(
      <LigneCondition cond={regle} tfRun="4h" raison="Condition 1 : exemple" onChange={rien} onRemove={rien} />,
    );
    expect(html).toContain("croise ↓");
    expect(html).toContain("TTM Squeeze actif (1 / 0)");
    expect(html).toContain("Condition 1 : exemple");
    // RVOL saisonnier : désactivé hors 1h, avec la raison.
    expect(html).toMatch(/disabled="">RVOL saisonnier H1 \(heure UTC\) · ≈ 41 j lus · 1h requis/);
  });

  it("bascule comparaison ↔ croisement en gardant les opérandes", () => {
    const comparaison = {
      type: "comparaison" as const,
      gauche: { type: "prix" as const, champ: "close" as const },
      comparateur: ">" as const,
      droite: { type: "constante" as const, valeur: 3 },
    };
    const croisement = basculerTypeRegle(comparaison, "croisement");
    expect(croisement).toEqual({ type: "croisement", a: comparaison.gauche, b: comparaison.droite, sens: "hausse" });
    expect(basculerTypeRegle(croisement, "comparaison")).toEqual(comparaison);
  });
});
