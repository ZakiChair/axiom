import { describe, expect, it } from "vitest";
import { construireRequetesNbs, validerRequeteNbs, NBS_HOST, NBS_CHEMIN } from "../../../../../shared/nbs-series";
import { parseSerieNbs } from "./nbs";
const maintenant = Date.UTC(2026, 8, 7);

describe("NBS : requêtes bornées et données nationales", () => {
  it("borne l'historique core aux catalogues statistiques de 2021 et 2026 sans inventer de core antérieur", () => {
    const requetes = construireRequetesNbs("core-cpi-aa", Date.UTC(2016, 8, 1), maintenant);
    expect(requetes).toHaveLength(2);
    expect(requetes[0]?.dts).toEqual(["202101MM-202512MM"]);
    expect(requetes[1]?.dts).toEqual(["202601MM-202609MM"]);
    expect(requetes.every((r) => validerRequeteNbs(r, maintenant))).toBe(true);
    expect(NBS_HOST).toBe("data.stats.gov.cn");
    expect(NBS_CHEMIN.endsWith("/stream/esData")).toBe(true);
  });
  it("refuse les IDs hors catalogue, dimensions supplémentaires et bornes abusives", () => {
    const r = construireRequetesNbs("core-cpi-aa", Date.UTC(2026, 0, 1), maintenant)[0]!;
    expect(validerRequeteNbs({ ...r, indicatorIds: ["arbitraire"] }, maintenant)).toBe(false);
    expect(validerRequeteNbs({ ...r, sql: "texte" }, maintenant)).toBe(false);
    expect(validerRequeteNbs({ ...r, dts: ["201001MM-202609MM"] }, maintenant)).toBe(false);
    expect(validerRequeteNbs({ ...r, dts: ["202613MM-202609MM"] }, maintenant)).toBe(false);
    expect(validerRequeteNbs({ ...r, dts: ["202601MM-202610MM"] }, maintenant)).toBe(false);
    expect(validerRequeteNbs({ ...r, das: [{ text: "全国", value: "110000000000" }] }, maintenant)).toBe(false);
  });
  it("convertit un indice base 100 a/a sans transformer les cellules vides en zéro", () => {
    const r = construireRequetesNbs("core-cpi-aa", Date.UTC(2026, 0, 1), maintenant)[0]!;
    const cellule = { _id: r.indicatorIds[0], da: "000000000000", catalogid: r.cid };
    const json = { success: true, data: [
      { code: "202608MM", values: [{ ...cellule, value: "" }] },
      { code: "202607MM", values: [{ ...cellule, value: "100.9" }, { ...cellule, _id: "autre", value: "115" }] },
      { code: "202606MM", values: [{ ...cellule, value: "99.5" }, { ...cellule, da: "110000000000", value: "888" }] },
    ] };
    expect(parseSerieNbs(json, r, "core-cpi-aa")).toEqual([{ time: Date.UTC(2026, 5, 1), value: -0.5 }, { time: Date.UTC(2026, 6, 1), value: 0.9 }]);
  });
});

it("segmente une demande de plus de dix ans sans élargir la requête amont", () => {
  const requetes = construireRequetesNbs("ppi-aa", Date.UTC(2015, 7, 1), maintenant);
  expect(requetes).toHaveLength(2);
  expect(requetes.every((r) => validerRequeteNbs(r, maintenant))).toBe(true);
});

it("ne soustrait pas 100 à un taux de chômage ou une croissance industrielle déjà en %", () => {
  for (const serie of ["chomage", "production-aa"] as const) {
    const r = construireRequetesNbs(serie, Date.UTC(2026, 0, 1), maintenant)[0]!;
    expect(parseSerieNbs({ data: [{ code: "202607MM", values: [{ _id: r.indicatorIds[0], da: "000000000000", catalogid: r.cid, value: "0" }] }] }, r, serie)[0]?.value).toBe(0);
  }
});

it("ne double-compte pas un mois répété et rejette une période hors requête", () => {
  const r = construireRequetesNbs("chomage", Date.UTC(2026, 0, 1), maintenant)[0]!;
  const cellule = { _id: r.indicatorIds[0], da: "000000000000", catalogid: r.cid, value: "5.2" };
  const json = { data: [
    { code: "202607MM", values: [cellule, cellule] },
    { code: "202512MM", values: [cellule] },
    { code: "202610MM", values: [cellule] },
  ] };
  expect(parseSerieNbs(json, r, "chomage")).toEqual([{ time: Date.UTC(2026, 6, 1), value: 5.2 }]);
});
