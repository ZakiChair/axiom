import { describe, expect, it } from "vitest";
import { ONCES_TROY_PAR_TONNE, parseImfGoldReserves } from "./goldReserves";

/**
 * Fixture calquée sur la réponse RÉELLE IMF SDMX-JSON « jsondata » (structure
 * dimensions/series + dataSets/series indexés). Contient volontairement :
 *  - USA & DEU : déclarants valides (valeurs concordant avec le WGC) ;
 *  - BRA : chiffre CORROMPU (~172 000 t, > plafond) → doit être écarté ;
 *  - G163 : code AGRÉGAT hors table de noms → doit être écarté ;
 *  - USA en DOUBLE (deux secteurs) → déduplication en gardant la plus grande valeur.
 */
function fixtureImf(): unknown {
  return {
    meta: {},
    data: {
      dataSets: [
        {
          series: {
            "0:0:0:0": { observations: { "0": ["261499000", null, 0, null] } }, // USA (sect. A)
            "0:0:1:0": { observations: { "1": ["261000000", null, 0, null] } }, // USA (sect. B, plus faible)
            "1:0:0:0": { observations: { "1": ["107689304.223", null, 0, null] } }, // DEU
            "2:0:0:0": { observations: { "0": ["5544278722.99784", null, 0, null] } }, // BRA corrompu
            "3:0:0:0": { observations: { "0": ["347551000", null, 0, null] } }, // G163 agrégat
          },
        },
      ],
      structures: [
        {
          dimensions: {
            series: [
              { id: "COUNTRY", keyPosition: 0, values: [{ id: "USA" }, { id: "DEU" }, { id: "BRA" }, { id: "G163" }] },
              { id: "INDICATOR", keyPosition: 1, values: [{ id: "IRFCLDT1_IRFCL56V_FTO" }] },
              { id: "SECTOR", keyPosition: 2, values: [{ id: "S1XS1311" }, { id: "S1XS1312" }] },
              { id: "FREQUENCY", keyPosition: 3, values: [{ id: "M" }] },
            ],
            observation: [
              { id: "TIME_PERIOD", keyPosition: 4, values: [{ value: "2026-M06" }, { value: "2026-M05" }] },
            ],
          },
        },
      ],
    },
  };
}

describe("parseImfGoldReserves", () => {
  it("convertit onces → tonnes et trie décroissant", () => {
    const res = parseImfGoldReserves(fixtureImf());
    expect(res.map((r) => r.pays)).toEqual(["USA", "DEU"]);
    expect(res[0]!.nom).toBe("États-Unis");
    expect(res[0]!.tonnes).toBeCloseTo(261499000 / ONCES_TROY_PAR_TONNE, 3); // ≈ 8133.5
    expect(res[1]!.tonnes).toBeCloseTo(107689304.223 / ONCES_TROY_PAR_TONNE, 3); // ≈ 3349.5
  });

  it("écarte les valeurs corrompues (> plafond de plausibilité) — BRA", () => {
    const res = parseImfGoldReserves(fixtureImf());
    expect(res.find((r) => r.pays === "BRA")).toBeUndefined();
  });

  it("écarte les codes agrégats hors table de noms — G163", () => {
    const res = parseImfGoldReserves(fixtureImf());
    expect(res.find((r) => r.pays === "G163")).toBeUndefined();
  });

  it("déduplique par pays en gardant la plus grande valeur (USA deux secteurs)", () => {
    const res = parseImfGoldReserves(fixtureImf());
    const usa = res.filter((r) => r.pays === "USA");
    expect(usa.length).toBe(1);
    expect(usa[0]!.tonnes).toBeCloseTo(261499000 / ONCES_TROY_PAR_TONNE, 3);
    expect(usa[0]!.periode).toBe("2026-M06");
  });

  it("entrée nulle / structure absente → [] (dégradation gracieuse)", () => {
    expect(parseImfGoldReserves(null)).toEqual([]);
    expect(parseImfGoldReserves({})).toEqual([]);
    expect(parseImfGoldReserves({ data: { dataSets: [], structures: [] } })).toEqual([]);
  });

  it("observation non numérique ou négative → pays absent", () => {
    const j = fixtureImf() as {
      data: { dataSets: Array<{ series: Record<string, { observations: Record<string, unknown[]> }> }> };
    };
    j.data.dataSets[0]!.series = {
      "0:0:0:0": { observations: { "0": ["NaN", null, 0, null] } },
      "1:0:0:0": { observations: { "1": ["-5", null, 0, null] } },
    };
    expect(parseImfGoldReserves(j)).toEqual([]);
  });
});
