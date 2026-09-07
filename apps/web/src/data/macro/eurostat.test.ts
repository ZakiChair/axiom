import { describe, expect, it } from "vitest";
import { parseEurostatJsonStat } from "./eurostat";

// EXTRAIT RÉEL d'ec.europa.eu, capturé le 2026-09-06 sur
// prc_hicp_minr?freq=M&unit=RCH_A&coicop18=TOTAL&geo=EA21&sinceTimePeriod=2026-05.
// Format JSON-stat : `value` est indexé par POSITION, pas par période ; la
// correspondance passe par `dimension.time.category.index`.
const JSONSTAT_EA = {
  version: "2.0",
  class: "dataset",
  label: "Harmonised index of consumer prices (HICP) - ECOICOP ver.2",
  updated: "2026-09-01T23:00:00+0200",
  value: { "0": 3.2, "1": 2.8, "2": 3.0, "3": 3.2 },
  id: ["freq", "unit", "coicop18", "geo", "time"],
  size: [1, 1, 1, 1, 4],
  dimension: {
    freq: { category: { index: { M: 0 } } },
    unit: { category: { index: { RCH_A: 0 } } },
    coicop18: { category: { index: { TOTAL: 0 } } },
    geo: { category: { index: { EA21: 0 } } },
    time: { category: { index: { "2026-05": 0, "2026-06": 1, "2026-07": 2, "2026-08": 3 } } },
  },
};

describe("parseEurostatJsonStat", () => {
  it("apparie chaque valeur à sa période via l'index de dimension", () => {
    expect(parseEurostatJsonStat(JSONSTAT_EA)).toEqual([
      { time: Date.UTC(2026, 4, 1), value: 3.2 },
      { time: Date.UTC(2026, 5, 1), value: 2.8 },
      { time: Date.UTC(2026, 6, 1), value: 3.0 },
      { time: Date.UTC(2026, 7, 1), value: 3.2 },
    ]);
  });

  it("tolère les trous : une position sans valeur est simplement absente", () => {
    const troue = structuredClone(JSONSTAT_EA);
    delete (troue.value as Record<string, number>)["2"];
    expect(parseEurostatJsonStat(troue)).toHaveLength(3);
  });

  // Un HTTP 200 avec `value` vide est un ÉCHEC DE SOURCE, pas une série vide :
  // le distinguer évite d'afficher « aucune donnée » pour une panne amont.
  it("rejette une réponse dont value est vide", () => {
    const vide = { ...JSONSTAT_EA, value: {} };
    expect(() => parseEurostatJsonStat(vide)).toThrow(/vide/i);
  });

  // GARDE ANTI-PAYLOAD : le poste coicop18 compte 555 modalités. Une requête
  // sous-filtrée renvoie des milliers de valeurs en HTTP 200. On refuse de parser
  // plutôt que d'attribuer les valeurs à la mauvaise période.
  it("rejette une réponse insuffisamment filtrée", () => {
    const large = structuredClone(JSONSTAT_EA);
    large.size = [1, 1, 555, 1, 4];
    expect(() => parseEurostatJsonStat(large)).toThrow(/filtr/i);
  });

  it("rejette une réponse sans dimension temporelle", () => {
    const sansTemps = { ...JSONSTAT_EA, id: ["freq", "unit"], size: [1, 1] };
    expect(() => parseEurostatJsonStat(sansTemps)).toThrow();
  });
});

it("conserve le statut d'estimation de l'IPCH flash", () => {
  const serie = parseEurostatJsonStat({ ...JSONSTAT_EA, status: { "3": "e" } });
  expect(serie.at(-1)?.qualite).toBe("estimation");
  expect(serie[0]?.qualite).toBeUndefined();
});
