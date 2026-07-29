import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import {
  CLASSES_CHAMP, Input, Select, Bouton, BoutonBascule, BoutonRafraichir, BTN_SECONDAIRE, CLASSES_BOUTON,
  BarreProgression, Chip, classesSegmentItem, CLASSES_SEGMENT_CONTENEUR, SegmenteCompact, TitreSection,
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
