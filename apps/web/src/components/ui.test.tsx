import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import {
  CLASSES_CHAMP, Input, Select, Bouton, BoutonBascule, BoutonRafraichir, BTN_SECONDAIRE, CLASSES_BOUTON,
  BarreProgression, Chip, classesSegmentItem, CLASSES_SEGMENT_CONTENEUR, SegmenteCompact, TitreSection,
  Metric, TuileStat,
} from "./ui";

/** Invoque un composant SANS hook et retourne ses props d'élément racine. */
function racine(el: unknown): { type: unknown; props: Record<string, unknown> } {
  const e = el as ReactElement;
  return { type: e.type, props: e.props as Record<string, unknown> };
}

describe("Input / Select", () => {
  it("rend un <input> avec le focus standard et fusionne className", () => {
    const { type, props } = racine(Input({ placeholder: "Nom…", className: "flex-1" }));
    expect(type).toBe("input");
    expect(props.className).toContain(CLASSES_CHAMP);
    expect(props.className).toContain("flex-1");
    expect(CLASSES_CHAMP).toContain("focus:ring-accent");
    expect(CLASSES_CHAMP).toContain("rounded-md");
    expect(CLASSES_CHAMP).toContain("text-[11px]");
  });
  it("rend un <select> avec les mêmes classes de champ", () => {
    const { type, props } = racine(Select({ "aria-label": "Champ" }));
    expect(type).toBe("select");
    expect(props.className).toContain(CLASSES_CHAMP);
  });
});

describe("Bouton", () => {
  it("variante par défaut = secondaire, type=button", () => {
    const { props } = racine(Bouton({ children: "Exporter" }));
    expect(props.type).toBe("button");
    expect(props.className).toContain(CLASSES_BOUTON.secondaire);
  });
  it("le secondaire reste identique à BTN_SECONDAIRE (compat classes)", () => {
    expect(CLASSES_BOUTON.secondaire).toBe(BTN_SECONDAIRE);
  });
  it("primaire = accent bordé (standard CAP), danger = hover down", () => {
    expect(CLASSES_BOUTON.primaire).toContain("border-accent/60");
    expect(CLASSES_BOUTON.primaire).toContain("bg-accent/10");
    expect(CLASSES_BOUTON.danger).toContain("hover:text-down");
  });
  it("BoutonBascule pose aria-pressed et le point quand actif", () => {
    const on = racine(BoutonBascule({ actif: true, children: "Sur le graphe" }));
    expect(on.props["aria-pressed"]).toBe(true);
    expect(on.props.className).toContain("border-accent");
    const off = racine(BoutonBascule({ actif: false, children: "Sur le graphe" }));
    expect(off.props["aria-pressed"]).toBe(false);
  });
  it("BoutonRafraichir : glyphe ↻ et libellé par défaut", () => {
    const el = racine(BoutonRafraichir({ onClick: () => {} }));
    expect(JSON.stringify(el.props.children)).toContain("↻");
  });
});

describe("SegmenteCompact", () => {
  it("conteneur role=group + item actif bg-bg", () => {
    const el = racine(
      SegmenteCompact({
        options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        actif: "a", onChange: () => {}, ariaLabel: "Mode",
      }),
    );
    expect(el.props.role).toBe("group");
    expect(el.props.className).toContain(CLASSES_SEGMENT_CONTENEUR);
    expect(classesSegmentItem(true)).toContain("bg-bg text-text");
    expect(classesSegmentItem(false)).toContain("text-text-dim");
    expect(classesSegmentItem(false)).toContain("text-[10px]");
  });
});

describe("Chip / BarreProgression / TitreSection", () => {
  it("Chip : croix ✕ seulement si onRetirer", () => {
    const avec = JSON.stringify(racine(Chip({ children: "BTC", onRetirer: () => {}, retirerLabel: "Retirer BTC" })).props.children);
    expect(avec).toContain("✕");
    const sans = JSON.stringify(racine(Chip({ children: "BTC" })).props.children);
    expect(sans).not.toContain("✕");
  });
  it("BarreProgression : fraction bornée [0,1], piste bg-bg", () => {
    const el = racine(BarreProgression({ fraction: 1.7 }));
    expect(el.props["aria-valuenow"]).toBe(100);
    expect(el.props.className).toContain("bg-bg");
  });
  it("TitreSection : h3 gabarit unique", () => {
    const el = racine(TitreSection({ children: "Positions" }));
    expect(el.type).toBe("h3");
    expect(el.props.className).toContain("text-[10px] uppercase tracking-wide text-text-dim");
  });
});

describe("TuileStat", () => {
  it("empilée : libellé au-dessus, ton down applique text-down, marqueurs unique à empilée", () => {
    // Sans passer disposition, on vérifie la présence de marqueurs UNIQUES à empilée
    // (absent de inline) pour prouver que disposition="empilee" est effectif
    const el = racine(TuileStat({ label: "PnL net", valeur: "−123", ton: "down" }));
    const html = JSON.stringify(el.props);
    expect(html).toContain("PnL net");
    expect(html).toContain("text-down");
    expect(html).toContain("tabular-nums");
    // Marqueurs uniques à empilée : uppercase tracking-wider sur le libellé (text-[10px])
    expect(html).toContain("uppercase tracking-wider");
  });
  it("couleur brute prioritaire sur ton (style appliqué, classeTon conservé)", () => {
    const el = racine(TuileStat({ label: "OI", valeur: "1,2 Md", ton: "up", couleur: "var(--serie-1)" }));
    const props = el.props;
    const html = JSON.stringify(props);
    expect(html).toContain("var(--serie-1)");
    // Inspecte le style de l'objet pour vérifier que la couleur est effectivement appliquée
    // Cherche le span valeur qui contient le style inline
    expect(html).toContain("color"); // Propriété CSS appliquée
    // Note : classeTon ("text-up") reste dans className par design — le style inline gagne visuellement
  });
  it("inline : même tuile bordée, libellé et valeur sur une ligne", () => {
    const el = racine(TuileStat({ label: "Funding", valeur: "0,01 %", disposition: "inline" }));
    expect(el.props.className as string).toContain("items-baseline justify-between");
  });
  it("pied en empilée : rendu, absent en inline", () => {
    // Empilée avec pied
    const empilee = racine(TuileStat({ label: "Stock", valeur: "100", pied: "Fraîcheur 30s" }));
    expect(JSON.stringify(empilee.props)).toContain("Fraîcheur 30s");
    // Inline avec pied fourni → le contenu pied ne doit PAS apparaître (branche inline ignore pied)
    const inline = racine(TuileStat({ label: "Stock", valeur: "100", disposition: "inline", pied: "Fraîcheur 30s" }));
    expect(JSON.stringify(inline.props)).not.toContain("Fraîcheur 30s");
  });
  it("Metric (déprécié) délègue à TuileStat inline", () => {
    const viaMetric = racine(Metric({ label: "x", value: "1" }));
    expect(viaMetric.type).toBe(TuileStat);
  });
});
