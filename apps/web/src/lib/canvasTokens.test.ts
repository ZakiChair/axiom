import { describe, expect, it } from "vitest";
import { indexSerie, parseHexRgb, POLICE_CANVAS } from "./canvasTokens";

// serieCanvas/lireTokenCanvas exigent le DOM (vitest node) : on teste leurs
// briques pures — le cycle modulo des séries et le parseur hex.
describe("indexSerie — cycle sur les 6 tokens --serie-N", () => {
  it("cycle 0..5 puis reboucle", () => {
    expect(indexSerie(0)).toBe(0);
    expect(indexSerie(5)).toBe(5);
    expect(indexSerie(6)).toBe(0);
    expect(indexSerie(13)).toBe(1);
  });
  it("reste positif pour un index négatif", () => {
    expect(indexSerie(-1)).toBe(5);
  });
});

describe("parseHexRgb", () => {
  it("parse #rrggbb et #rgb", () => {
    expect(parseHexRgb("#f59e0b")).toEqual([245, 158, 11]);
    expect(parseHexRgb("#fff")).toEqual([255, 255, 255]);
  });
  it("rejette les non-hex", () => {
    expect(parseHexRgb("rgb(1,2,3)")).toBeNull();
    expect(parseHexRgb("")).toBeNull();
  });
});

it("POLICE_CANVAS : police unique des axes canvas", () => {
  expect(POLICE_CANVAS).toBe("10px ui-sans-serif, system-ui, sans-serif");
});
