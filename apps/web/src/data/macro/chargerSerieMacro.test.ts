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
    if ("message" in r) expect(r.message).toMatch(/quota/i);
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

  it("rend un statut « panne » sur un 401 sans clé requise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 401, statusText: "Unauthorized" })),
    );
    const r = await chargerSerieMacro(DEF_OCDE, Date.UTC(2020, 0, 1));
    expect(r.statut).toBe("panne");
  });

  it("transmet le paramètre units au fournisseur FRED", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve({ ok: true, json: async () => ({ observations: [] }) });
      }),
    );
    await chargerSerieMacro(DEF_FRED, Date.UTC(2020, 0, 1));
    expect(urls[0]).toContain("series_id=CPIAUCSL");
    expect(urls[0]).toContain("units=pc1");
  });
});

describe("chargement macro étendu", () => {
  it("n'émet aucun appel pour un trou de couverture documenté", async () => {
    const appel = vi.fn(); vi.stubGlobal("fetch", appel);
    const r = await chargerSerieMacro({ ...DEF_OCDE, source: { transport: "indisponible", motif: "WPI différent du PPI" } }, 0);
    expect(r).toEqual({ statut: "indisponible", message: "WPI différent du PPI" });
    expect(appel).not.toHaveBeenCalled();
  });
  it("récupère le trimestre de référence et transforme le PIB ONS en a/a", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ months: [], quarters: [{ year: "2025", quarter: "Q2", value: "700000" }, { year: "2026", quarter: "Q2", value: "712545" }] }) })));
    const r = await chargerSerieMacro({ ...DEF_FRED, frequence: "Q", transformation: "aa", source: { transport: "ons", chemin: "economy/grossdomesticproductgdp/timeseries/abmi/pn2/data" } }, Date.UTC(2026, 0, 1));
    expect(r).toMatchObject({ statut: "ok", points: [{ time: Date.UTC(2026, 3, 1), value: expect.closeTo(1.792142857) }] });
  });
  it("ne forward-fille pas IORB pour créer un faux spread aux dates absentes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ observations: url.includes("series_id=SOFR") ? [{ date: "2026-09-01", value: "4.1" }, { date: "2026-09-02", value: "4.2" }] : [{ date: "2026-09-01", value: "4.3" }] }) })));
    const r = await chargerSerieMacro({ ...DEF_FRED, source: { transport: "ecartFred", gauche: "SOFR", droite: "IORB", facteur: 100 } }, 0);
    expect(r).toMatchObject({ statut: "ok", points: [{ time: Date.UTC(2026, 8, 1), value: expect.closeTo(-20) }] });
  });
  it("distingue une annulation de l'utilisateur d'une panne de source", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("Aborted", "AbortError"); }));
    expect((await chargerSerieMacro(DEF_OCDE, 0, ctrl.signal)).statut).toBe("annule");
  });
});
