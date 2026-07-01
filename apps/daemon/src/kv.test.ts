import { describe, expect, test } from "bun:test";
import { parseCheminKv } from "./kv";

describe("parseCheminKv", () => {
  test("/kv/:ns → snapshot du namespace", () => {
    expect(parseCheminKv("/kv/persist")).toEqual({ kind: "ns", ns: "persist" });
  });

  test("/kv/:ns/:cle → clé unique (segments URL-décodés)", () => {
    // Le front encode la clé localStorage (« axiom:chartState:v1 » → « axiom%3A… »).
    expect(parseCheminKv("/kv/persist/axiom%3AchartState%3Av1")).toEqual({
      kind: "cle",
      ns: "persist",
      cle: "axiom:chartState:v1",
    });
  });

  test("formes non reconnues → null", () => {
    expect(parseCheminKv("/kv")).toBeNull(); // pas de namespace
    expect(parseCheminKv("/kv/persist/cle/en-trop")).toBeNull(); // segment surnuméraire
  });

  test("encodage invalide toléré (retombe sur le segment brut)", () => {
    expect(parseCheminKv("/kv/persist/%E0%A4%A")).toEqual({
      kind: "cle",
      ns: "persist",
      cle: "%E0%A4%A",
    });
  });
});
