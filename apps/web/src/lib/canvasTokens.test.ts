import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { couleurDeclaree, indexSerie, parseHexRgb, POLICE_CANVAS, POLICE_CANVAS_MONO, serieCanvas } from "./canvasTokens";

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

describe("couleurDeclaree — couleur sémantique d'une sortie d'indicateur", () => {
  it("absente → repli (cycle de série)", () => {
    expect(couleurDeclaree(undefined, () => "TOKEN", () => "REPLI")).toBe("REPLI");
  });
  it("token `--xxx` → lecteur appelé avec (token, repli)", () => {
    const appels: Array<[string, string]> = [];
    const res = couleurDeclaree("--down", (nom, repli) => (appels.push([nom, repli]), "#ef4444"), () => "REPLI");
    expect(res).toBe("#ef4444");
    expect(appels).toEqual([["--down", "REPLI"]]);
  });
  it("littéral → renvoyé tel quel, lecteur non appelé", () => {
    let appele = false;
    const res = couleurDeclaree("#f59e0b", () => (appele = true, "X"), () => "REPLI");
    expect(res).toBe("#f59e0b");
    expect(appele).toBe(false);
  });
});

it("POLICE_CANVAS : police unique des axes canvas", () => {
  expect(POLICE_CANVAS).toBe("10px ui-sans-serif, system-ui, sans-serif");
});

it("POLICE_CANVAS_MONO : variante monospace pour l'alignement de colonnes de chiffres", () => {
  expect(POLICE_CANVAS_MONO).toBe("11px ui-monospace, SFMono-Regular, Menlo, monospace");
});

it("un token absent conserve la palette dark du CSS, y compris après rebouclage", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  try {
    for (let i = 0; i < 12; i++) {
      const couleur = css.match(new RegExp(`--serie-${i % 6 + 1}:\\s*(#[0-9a-f]{6})`))?.[1];
      expect(serieCanvas(i)).toBe(couleur);
    }
    expect(serieCanvas(0, "#123456")).toBe("#123456");
  } finally {
    vi.unstubAllGlobals();
  }
});
