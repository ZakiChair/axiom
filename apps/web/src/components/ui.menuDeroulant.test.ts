import { describe, expect, it } from "vitest";
import { indexRoving } from "./ui";

/**
 * Navigation clavier « roving » du MenuDeroulant (fonction pure, testée sans DOM
 * — convention vitest node du repo). ↑/↓ bouclent aux extrémités ; Home/End
 * sautent aux bords ; un menu vide renvoie -1 (aucun élément à focaliser).
 */
describe("indexRoving — navigation clavier du MenuDeroulant", () => {
  it("↓ depuis aucun focus (-1) va au premier élément", () => {
    expect(indexRoving(4, -1, "ArrowDown")).toBe(0);
  });

  it("↓ avance d'un cran puis boucle après le dernier", () => {
    expect(indexRoving(4, 0, "ArrowDown")).toBe(1);
    expect(indexRoving(4, 3, "ArrowDown")).toBe(0);
  });

  it("↑ depuis aucun focus (-1) va au dernier élément", () => {
    expect(indexRoving(4, -1, "ArrowUp")).toBe(3);
  });

  it("↑ recule d'un cran puis boucle avant le premier", () => {
    expect(indexRoving(4, 2, "ArrowUp")).toBe(1);
    expect(indexRoving(4, 0, "ArrowUp")).toBe(3);
  });

  it("Home / End sautent aux bords quel que soit le focus courant", () => {
    expect(indexRoving(4, 2, "Home")).toBe(0);
    expect(indexRoving(4, 1, "End")).toBe(3);
  });

  it("un menu vide renvoie -1", () => {
    expect(indexRoving(0, -1, "ArrowDown")).toBe(-1);
    expect(indexRoving(0, 0, "End")).toBe(-1);
  });
});
