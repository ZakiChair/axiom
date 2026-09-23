import { describe, expect, it } from "vitest";
import { INDICATORS } from "@axiom/indicators";
import { filtrerCatalogueIndicateurs } from "./indicatorMenuFilters";

const [ema, rsi, macd] = ["ema", "rsi", "macd"].map((id) => INDICATORS.find((d) => d.id === id)!);
const defs = [ema!, rsi!, macd!];

describe("filtres combinables du catalogue", () => {
  it("favoris + récents + recherche + utilisables s'appliquent en intersection", () => {
    const r = filtrerCatalogueIndicateurs(defs, {
      recherche: "m", favorisSeulement: true, recentsSeulement: true, utilisablesSeulement: true,
      favoris: ["ema", "macd"], recents: ["macd", "rsi", "ema"],
      correspondRecherche: (d, q) => d.id.includes(q), utilisable: (d) => d.id !== "macd",
    });
    expect(r.map((d) => d.id)).toEqual(["ema"]);
  });

  it("le filtre récents suit l'ordre des ajouts et ne modifie pas le catalogue", () => {
    const r = filtrerCatalogueIndicateurs(defs, {
      recherche: "", favorisSeulement: false, recentsSeulement: true, utilisablesSeulement: false,
      favoris: [], recents: ["macd", "ema"], correspondRecherche: () => true, utilisable: () => true,
    });
    expect(r.map((d) => d.id)).toEqual(["macd", "ema"]);
    expect(defs.map((d) => d.id)).toEqual(["ema", "rsi", "macd"]);
  });
});
