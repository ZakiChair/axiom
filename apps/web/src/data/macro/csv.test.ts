import { describe, expect, it } from "vitest";
import { accesseurColonnes, decouperLigneCsv, parseCsv } from "./csv";

describe("decouperLigneCsv", () => {
  it("découpe une ligne simple", () => {
    expect(decouperLigneCsv("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("respecte les virgules à l'intérieur des guillemets", () => {
    expect(decouperLigneCsv('a,"b,c,d",e')).toEqual(["a", "b,c,d", "e"]);
  });
  it("gère les guillemets échappés (\"\")", () => {
    expect(decouperLigneCsv('"il dit ""oui""",x')).toEqual(['il dit "oui"', "x"]);
  });
  it("conserve les champs vides", () => {
    expect(decouperLigneCsv("a,,c")).toEqual(["a", "", "c"]);
  });
});

describe("parseCsv", () => {
  it("sépare en-têtes et lignes, ignore les lignes vides", () => {
    const table = parseCsv('Date,"2 Yr"\r\n07/02/2026,4.14\r\n\r\n07/01/2026,4.17\r\n');
    expect(table.entetes).toEqual(["Date", "2 Yr"]);
    expect(table.lignes).toEqual([
      ["07/02/2026", "4.14"],
      ["07/01/2026", "4.17"],
    ]);
  });
  it("retire un BOM éventuel en tête", () => {
    const table = parseCsv("﻿a,b\n1,2");
    expect(table.entetes).toEqual(["a", "b"]);
  });
  it("entrée vide → table vide", () => {
    expect(parseCsv("")).toEqual({ entetes: [], lignes: [] });
    expect(parseCsv("   \n  ")).toEqual({ entetes: [], lignes: [] });
  });
});

describe("accesseurColonnes", () => {
  it("accède aux colonnes par nom (robuste à l'ordre)", () => {
    const col = accesseurColonnes(["REF_AREA", "TIME_PERIOD", "OBS_VALUE"]);
    const ligne = ["US", "2026-06-30", "3.625"];
    expect(col(ligne, "OBS_VALUE")).toBe("3.625");
    expect(col(ligne, "REF_AREA")).toBe("US");
  });
  it("colonne absente → undefined", () => {
    const col = accesseurColonnes(["a", "b"]);
    expect(col(["1", "2"], "z")).toBeUndefined();
  });
});
