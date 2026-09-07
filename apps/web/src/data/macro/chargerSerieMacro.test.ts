import { afterEach, describe, expect, it, vi } from "vitest";
import type { DefinitionSerieMacro } from "./catalogueMacro";
import { chargerSerieMacro, cleSante } from "./chargerSerieMacro";

const DEF_OCDE: DefinitionSerieMacro = {
  id: "cpi-aa-cn",
  region: "CN",
  indicateur: "cpi-aa",
  libelleRegion: "Chine",
  frequence: "M",
  cleRequise: false,
  source: {
    transport: "oecd",
    dataflow: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
    cle: "CHN.M.N.CPI.PA._T.N.GY",
  },
};

const DEF_FRED: DefinitionSerieMacro = {
  id: "cpi-aa-us",
  region: "US",
  indicateur: "cpi-aa",
  libelleRegion: "États-Unis",
  frequence: "M",
  cleRequise: true,
  source: { transport: "fred", seriesId: "CPIAUCSL", units: "pc1" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cleSante", () => {
  it("nomme UNE clé par hôte, jamais par série", () => {
    expect(cleSante(DEF_OCDE)).toBe("macro:oecd");
    expect(cleSante(DEF_FRED)).toBe("macro:fred");
  });
});

describe("chargerSerieMacro", () => {
  it("rend un statut « quota » distinct sur un 429 OCDE", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 429, statusText: "" })));
    const r = await chargerSerieMacro(DEF_OCDE, Date.UTC(2020, 0, 1));
    expect(r.statut).toBe("quota");
    // Le message ne doit JAMAIS laisser croire à une source morte.
    if (r.statut !== "ok") expect(r.message).toMatch(/quota/i);
  });

  it("rend un statut « panne » sur une erreur ordinaire", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 503, statusText: "Service Unavailable" })),
    );
    const r = await chargerSerieMacro(DEF_OCDE, Date.UTC(2020, 0, 1));
    expect(r.statut).toBe("panne");
  });

  it("rend un statut « sansCle » sur un 401 FRED plutôt qu'une panne", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 401, statusText: "Unauthorized" })),
    );
    const r = await chargerSerieMacro(DEF_FRED, Date.UTC(2020, 0, 1));
    expect(r.statut).toBe("sansCle");
  });

  it("ne laisse échapper aucune exception", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("réseau coupé"))));
    await expect(chargerSerieMacro(DEF_OCDE, Date.UTC(2020, 0, 1))).resolves.toMatchObject({
      statut: "panne",
    });
  });
});
