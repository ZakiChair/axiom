import { describe, expect, test } from "bun:test";
import {
  LIMITE_DEFAUT,
  LIMITE_MAX,
  normaliserBougies,
  parseCheminCandles,
  parseRequeteCandles,
} from "./candles";

describe("parseCheminCandles", () => {
  test("/candles/:source/:symbole/:tf (segments décodés)", () => {
    expect(parseCheminCandles("/candles/coinalyze/BTCUSDT_PERP.A/1h")).toEqual({
      source: "coinalyze",
      symbole: "BTCUSDT_PERP.A",
      tf: "1h",
    });
  });

  test("formes non reconnues → null", () => {
    expect(parseCheminCandles("/candles/coinalyze/BTCUSDT")).toBeNull(); // tf manquant
    expect(parseCheminCandles("/candles/a/b/c/d")).toBeNull(); // segment en trop
  });
});

describe("normaliserBougies", () => {
  test("conserve les bougies dont t,o,h,l,c,v sont des nombres finis", () => {
    const out = normaliserBougies([
      { t: 1, o: 10, h: 12, l: 9, c: 11, v: 100 },
      { t: 2, o: 11, h: 13, l: 10, c: 12, v: 200 },
    ]);
    expect(out).toEqual([
      { t: 1, o: 10, h: 12, l: 9, c: 11, v: 100 },
      { t: 2, o: 11, h: 13, l: 10, c: 12, v: 200 },
    ]);
  });

  test("écarte les entrées invalides sans faire échouer le lot", () => {
    const out = normaliserBougies([
      { t: 1, o: 10, h: 12, l: 9, c: 11, v: 100 }, // ok
      { t: 2, o: 11, h: 13, l: 10, c: 12 }, // v manquant
      { t: NaN, o: 1, h: 1, l: 1, c: 1, v: 1 }, // t NaN
      { t: 3, o: 1, h: 1, l: 1, c: 1, v: "x" }, // v non numérique
      null, // pas un objet
      42, // pas un objet
    ]);
    expect(out).toEqual([{ t: 1, o: 10, h: 12, l: 9, c: 11, v: 100 }]);
  });

  test("corps non-tableau → tableau vide", () => {
    expect(normaliserBougies({ pas: "un tableau" })).toEqual([]);
    expect(normaliserBougies(null)).toEqual([]);
  });
});

describe("parseRequeteCandles", () => {
  test("bornes et limite lues depuis la query", () => {
    const p = new URLSearchParams("depuis=1000&jusqua=2000&limite=42");
    expect(parseRequeteCandles(p)).toEqual({ depuis: 1000, jusqua: 2000, limite: 42 });
  });

  test("limite absente → défaut ; bornes absentes → null", () => {
    expect(parseRequeteCandles(new URLSearchParams(""))).toEqual({
      depuis: null,
      jusqua: null,
      limite: LIMITE_DEFAUT,
    });
  });

  test("limite bornée à [1, LIMITE_MAX]", () => {
    expect(parseRequeteCandles(new URLSearchParams("limite=0")).limite).toBe(1);
    expect(parseRequeteCandles(new URLSearchParams("limite=99999999")).limite).toBe(LIMITE_MAX);
  });

  test("valeurs non numériques ignorées (bornes null, limite défaut)", () => {
    const p = new URLSearchParams("depuis=abc&limite=xyz");
    expect(parseRequeteCandles(p)).toEqual({ depuis: null, jusqua: null, limite: LIMITE_DEFAUT });
  });
});
