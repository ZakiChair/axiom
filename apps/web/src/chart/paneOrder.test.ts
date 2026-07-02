import { describe, expect, it } from "vitest";
import { computeDropOrder } from "./paneOrder";

describe("computeDropOrder", () => {
  it("déplace l'élément déplacé à l'index de dépôt demandé", () => {
    expect(computeDropOrder(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(computeDropOrder(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });

  it("laisse l'ordre inchangé si l'index de dépôt correspond à la position actuelle", () => {
    expect(computeDropOrder(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
  });

  it("borne l'index de dépôt entre 0 et la longueur du tableau sans l'élément déplacé", () => {
    expect(computeDropOrder(["a", "b", "c"], "a", -5)).toEqual(["a", "b", "c"]);
    expect(computeDropOrder(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
  });

  it("est un no-op si l'id déplacé est absent de la liste", () => {
    expect(computeDropOrder(["a", "b"], "x", 0)).toEqual(["a", "b"]);
  });
});
