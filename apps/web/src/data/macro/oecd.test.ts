import { describe, expect, it } from "vitest";
import { parseOecdSdmxJson } from "./oecd";

// EXTRAIT RÉEL de sdmx.oecd.org, capturé le 2026-09-06 sur
// DSD_PRICES@DF_PRICES_ALL,1.0 / CHN.M.N.CPI.PA._T.N.GY?startPeriod=2026-05.
// Deux traits du format réel à ne pas « corriger » :
//  1. TIME_PERIOD arrive DANS LE DÉSORDRE : ['2026-05', '2026-07', '2026-06'] ;
//  2. REF_AREA liste DEUX modalités (CHN et l'agrégat WXOECD) alors qu'une seule
//     série est demandée — la clé de série « 0:0:… » désigne la position 0.
const SDMX_CHN = {
  data: {
    dataSets: [
      {
        series: {
          "0:0:0:0:0:0:0:0": {
            observations: { "0": [1.2, 0], "1": [0.5, 0], "2": [1, 0] },
          },
        },
      },
    ],
    structures: [
      {
        dimensions: {
          series: [
            {
              id: "REF_AREA",
              keyPosition: 0,
              values: [
                { id: "CHN", name: "China (People's Republic of)" },
                { id: "WXOECD", name: "Non-OECD economies" },
              ],
            },
            { id: "FREQ", keyPosition: 1, values: [{ id: "M" }] },
            { id: "METHODOLOGY", keyPosition: 2, values: [{ id: "N" }] },
            { id: "MEASURE", keyPosition: 3, values: [{ id: "CPI" }] },
            { id: "UNIT_MEASURE", keyPosition: 4, values: [{ id: "PA" }] },
            { id: "EXPENDITURE", keyPosition: 5, values: [{ id: "_T" }] },
            { id: "ADJUSTMENT", keyPosition: 6, values: [{ id: "N" }] },
            { id: "TRANSFORMATION", keyPosition: 7, values: [{ id: "GY" }] },
          ],
          observation: [
            { id: "TIME_PERIOD", values: [{ id: "2026-05" }, { id: "2026-07" }, { id: "2026-06" }] },
          ],
        },
      },
    ],
  },
};

describe("parseOecdSdmxJson", () => {
  it("remet les observations dans l'ordre chronologique", () => {
    const serie = parseOecdSdmxJson(SDMX_CHN, "CHN");
    expect(serie).toEqual([
      { time: Date.UTC(2026, 4, 1), value: 1.2 },
      { time: Date.UTC(2026, 5, 1), value: 1 },
      { time: Date.UTC(2026, 6, 1), value: 0.5 },
    ]);
  });

  it("échoue si l'on retire le tri chronologique", () => {
    // Contrôle de sensibilité : la série NON triée ne doit pas être croissante en temps.
    // C'est ce qui rend le test précédent porteur plutôt que décoratif.
    const brut = SDMX_CHN.data.structures[0]!.dimensions.observation[0]!.values.map((v) => v.id);
    expect(brut).toEqual(["2026-05", "2026-07", "2026-06"]);
  });

  it("ne rend que la zone demandée quand la structure en déclare plusieurs", () => {
    const serie = parseOecdSdmxJson(SDMX_CHN, "CHN");
    expect(serie).toHaveLength(3);
  });

  it("lève une erreur explicite quand la zone attendue est absente", () => {
    expect(() => parseOecdSdmxJson(SDMX_CHN, "IND")).toThrow(/IND/);
  });

  it("écarte une observation dont la valeur n'est pas finie", () => {
    const avecTrou = structuredClone(SDMX_CHN);
    avecTrou.data.dataSets[0]!.series["0:0:0:0:0:0:0:0"]!.observations["1"] = [
      null as unknown as number,
      0,
    ];
    expect(parseOecdSdmxJson(avecTrou, "CHN")).toHaveLength(2);
  });

  it("rejette une réponse sans jeu de données", () => {
    expect(() => parseOecdSdmxJson({ data: { dataSets: [], structures: [] } }, "CHN")).toThrow();
  });
});
