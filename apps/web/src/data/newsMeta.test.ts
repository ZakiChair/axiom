import { describe, expect, it } from "vitest";
import { bordureSource } from "./newsMeta";

describe("bordureSource — bordure adoucie d'un badge de source", () => {
  it("hex → suffixe alpha 8 chiffres", () => {
    expect(bordureSource("#f97316")).toBe("#f9731655");
  });
  it("token var(--x) → rgb(var(--x-rgb) / 0.33) (les hex-alpha ne s'appliquent pas à var())", () => {
    expect(bordureSource("var(--serie-4)")).toBe("rgb(var(--serie-4-rgb) / 0.33)");
  });
});
