import { describe, expect, it } from "vitest";
import { couleurAffichable } from "./compare";

describe("couleurAffichable — tokens et hex hérités", () => {
  it("enveloppe un token CSS dans var()", () => {
    expect(couleurAffichable("--serie-3")).toBe("var(--serie-3)");
  });
  it("laisse passer un hex hérité (persistance ancienne)", () => {
    expect(couleurAffichable("#f59e0b")).toBe("#f59e0b");
  });
});
