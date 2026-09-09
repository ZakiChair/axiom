import { afterEach, describe, expect, it, vi } from "vitest";
import { chargerPremieresPublicationsAlfred, chargerVueAlfred } from "./alfred";

afterEach(() => vi.unstubAllGlobals());

function reponse(observations: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ observations }) })));
}

describe("ALFRED", () => {
  it("demande une vue fermée à la date connue sans inventer une heure", async () => {
    reponse([
      { date: "2026-07-01", value: "130.500", realtime_start: "2026-08-15", realtime_end: "2026-08-15" },
    ]);
    await expect(chargerVueAlfred("PCEPILFE", "2026-08-15", { debut: "2026-01-01", fin: "2026-07-01" })).resolves.toEqual([
      { periode: "2026-07-01", valeur: 130.5, connuDepuis: "2026-08-15", connuJusqua: "2026-08-15" },
    ]);
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain("series_id=PCEPILFE");
    expect(url).toContain("realtime_start=2026-08-15");
    expect(url).toContain("realtime_end=2026-08-15");
    expect(url).toContain("observation_start=2026-01-01");
    expect(url).toContain("observation_end=2026-07-01");
  });

  it("transmet units à ALFRED pour conserver la transformation FRED", async () => {
    reponse([{ date: "2026-07-01", value: "2.9", realtime_start: "2026-08-15", realtime_end: "2026-08-15" }]);
    await chargerVueAlfred("CPIAUCSL", "2026-08-15", { units: "pc1" });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("units=pc1");
  });

  it("écarte une version qui commence après le cutoff, même si le fournisseur la renvoie", async () => {
    reponse([
      { date: "2026-07-01", value: "130.658", realtime_start: "2026-08-28", realtime_end: "9999-12-31" },
      { date: "2026-07-01", value: "130.500", realtime_start: "2026-07-31", realtime_end: "2026-08-27" },
    ]);
    await expect(chargerVueAlfred("PCEPILFE", "2026-08-15")).resolves.toHaveLength(1);
  });

  it("demande les premières publications avec output_type=4", async () => {
    reponse([{ date: "2026-07-01", value: "130.500", realtime_start: "2026-07-31", realtime_end: "9999-12-31" }]);
    await chargerPremieresPublicationsAlfred("PCEPILFE", { debut: "2026-01-01", fin: "2026-07-01" });
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain("output_type=4");
    expect(url).toContain("realtime_start=1776-07-04");
    expect(url).toContain("realtime_end=9999-12-31");
  });

  it("rejette dates et périodes invalides avant toute requête", async () => {
    const appel = vi.fn();
    vi.stubGlobal("fetch", appel);
    await expect(chargerVueAlfred("PCEPILFE", "2026-8-15")).rejects.toThrow(/YYYY-MM-DD/);
    expect(appel).not.toHaveBeenCalled();
  });

  it("rejette une date civile impossible, des bornes inversées et un intervalle realtime inversé", async () => {
    const appel = vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ observations: [{ date: "2026-06-01", value: "1", realtime_start: "2026-09-02", realtime_end: "2026-09-01" }] }) }));
    vi.stubGlobal("fetch", appel);
    await expect(chargerVueAlfred("PCEPILFE", "2026-02-30")).rejects.toThrow(/YYYY-MM-DD/);
    await expect(chargerVueAlfred("PCEPILFE", "2026-08-15", { debut: "2026-08-02", fin: "2026-08-01" })).rejects.toThrow(/debut.*fin/i);
    await expect(chargerVueAlfred("PCEPILFE", "2026-09-02")).resolves.toEqual([]);
  });
});
