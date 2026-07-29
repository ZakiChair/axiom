import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { CLASSES_CHAMP, Input, Select } from "./ui";

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
