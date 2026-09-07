import { describe, expect, it } from "vitest";
import { CATALOGUE_MACRO, INDICATEURS_MACRO, ORDRE_REGIONS, seriesDeIndicateur } from "./catalogueMacro";

describe("catalogue mondial", () => {
  it("rend huit zones sélectionnables et les familles d'économie réelle", () => {
    expect(ORDRE_REGIONS).toEqual(["US", "EZ", "UK", "JP", "CN", "IN", "CA", "CH"]);
    for (const id of ["cpi-aa", "cpi-mm", "core-cpi-aa", "ppi-aa", "pib-aa", "chomage", "production-aa", "change-reel-aa", "monnaie-aa"]) {
      expect(INDICATEURS_MACRO.some((i) => i.id === id)).toBe(true);
      expect(seriesDeIndicateur(id).map((d) => d.region)).toEqual(ORDRE_REGIONS);
    }
  });
  it("donne des identifiants stables uniques", () => {
    expect(new Set(CATALOGUE_MACRO.map((d) => d.id)).size).toBe(CATALOGUE_MACRO.length);
    expect(seriesDeIndicateur("cpi-aa").find((d) => d.region === "US")?.id).toBe("cpi-aa-us");
  });
  it("n'utilise pas les miroirs CPI arrêtés du Canada et de la Suisse", () => {
    for (const id of ["core-cpi-aa-ca", "cpi-aa-ch"]) {
      expect(CATALOGUE_MACRO.find((d) => d.id === id)?.source).toMatchObject({ transport: "oecd", dataflow: expect.stringContaining("COICOP2018") });
    }
  });
  it("garde le chômage UK glissant et ne le remplace pas par les demandeurs d'indemnités", () => {
    expect(CATALOGUE_MACRO.find((d) => d.id === "chomage-uk")).toMatchObject({ decalageFinMois: 1, source: { transport: "ons", chemin: expect.stringContaining("mgsx") } });
  });
  it("utilise les séries chinoises nationales vérifiées et ne nomme pas WPI indien PPI", () => {
    for (const id of ["chomage-cn", "ppi-aa-cn", "core-cpi-aa-cn", "production-aa-cn"]) expect(CATALOGUE_MACRO.find((d) => d.id === id)?.source.transport).toBe("nbs");
    expect(CATALOGUE_MACRO.find((d) => d.id === "ppi-aa-in")?.source).toMatchObject({ transport: "indisponible", motif: expect.stringContaining("WPI") });
  });
  it("raccorde les enquêtes et PPI officiels nouvellement vérifiés sans proxy de concept", () => {
    expect(CATALOGUE_MACRO.find((d) => d.id === "chomage-in")).toMatchObject({ frequence: "M", source: { transport: "mospi", serie: "chomage" }, perimetre: expect.stringContaining("15 ans") });
    expect(CATALOGUE_MACRO.find((d) => d.id === "ppi-aa-ca")).toMatchObject({ source: { transport: "statcan", vectorId: 1230995983 }, transformation: "aa" });
    expect(CATALOGUE_MACRO.find((d) => d.id === "ppi-aa-jp")).toMatchObject({ source: { transport: "boj", code: "PRCG20_2200000000%" } });
    expect(CATALOGUE_MACRO.find((d) => d.id === "ppi-aa-jp")?.transformation).toBeUndefined();
  });
  it("prévoit les observations de stress US et leurs unités", () => {
    expect(INDICATEURS_MACRO.find((i) => i.id === "nfci")?.unite).toBe("indice");
    expect(INDICATEURS_MACRO.find((i) => i.id === "demandes-chomage")?.unite).toBe("personnes");
    expect(INDICATEURS_MACRO.find((i) => i.id === "sofr-iorb")?.unite).toBe("pb");
    expect(seriesDeIndicateur("demandes-chomage")).toHaveLength(2);
  });
  it("ne laisse aucune dimension OCDE joker ou multi-pays dans le runtime", () => {
    for (const d of CATALOGUE_MACRO) {
      if (d.source.transport !== "oecd") continue;
      expect(d.source.cle).not.toMatch(/[+*]/);
      expect(d.source.cle.split(".").every(Boolean)).toBe(true);
      const dimensions = d.source.dataflow.includes("DF_KEI") ? 7 : d.source.dataflow.includes("DF_MONAGG") ? 9 : 8;
      expect(d.source.cle.split(".")).toHaveLength(dimensions);
    }
  });
});
