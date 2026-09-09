import { afterEach, describe, expect, it, vi } from "vitest";
import { chargerSerieTgaTreasury, extraireTgaDts } from "./treasury";

afterEach(() => vi.unstubAllGlobals());

describe("DTS Treasury TGA", () => {
  it("traite la rupture 2022, écarte les autres comptes et convertit M$ en Md$", () => {
    expect(extraireTgaDts([
      { record_date: "2022-04-15", account_type: "Treasury General Account (TGA)", close_today_bal: "578473", open_today_bal: "0" },
      { record_date: "2022-04-15", account_type: "Deposits", close_today_bal: "900000" },
      { record_date: "2022-04-18", account_type: "Treasury General Account (TGA) Closing Balance", close_today_bal: "null", open_today_bal: "600000" },
      { record_date: "2022-04-18", account_type: "Treasury General Account (TGA)", close_today_bal: "700000" },
    ])).toEqual([
      { time: Date.UTC(2022, 3, 15), value: 578.473 },
      { time: Date.UTC(2022, 3, 18), value: 600 },
    ]);
  });

  it("ne transforme jamais la chaîne null en zéro", () => {
    expect(extraireTgaDts([{ record_date: "2026-09-04", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "null", close_today_bal: "null" }])).toEqual([]);
  });

  it("pagine une borne historique et applique le timeout de quinze secondes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ record_date: "2026-09-04", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "888923" }], meta: { "total-pages": 1 } }) })));
    const serie = await chargerSerieTgaTreasury({ debut: "2026-09-01", fin: "2026-09-05" });
    expect(serie.points).toEqual([{ time: Date.UTC(2026, 8, 4), value: 888.923 }]);
    expect(serie.source).toBe("Treasury DTS operating_cash_balance");
    expect(serie.recupereLe).toEqual(expect.any(Number));
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/extapi/api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?");
    expect(String(url)).toContain("page%5Bsize%5D=1000");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("concatène deux pages bornées avant de parser les points", async () => {
    const appel = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ record_date: "2026-09-03", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "800000" }], meta: { "total-pages": 2 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ record_date: "2026-09-04", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "888923" }], meta: { "total-pages": 2 } }) });
    vi.stubGlobal("fetch", appel);
    await expect(chargerSerieTgaTreasury({ debut: "2026-09-01", fin: "2026-09-05" })).resolves.toMatchObject({ points: [{ value: 800 }, { value: 888.923 }] });
    expect(appel).toHaveBeenCalledTimes(2);
    expect(String(appel.mock.calls[1]?.[0])).toContain("page%5Bnumber%5D=2");
  });

  it("rejette les dates civiles impossibles et les bornes inversées", async () => {
    await expect(chargerSerieTgaTreasury({ debut: "2026-02-30" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(chargerSerieTgaTreasury({ debut: "2026-09-05", fin: "2026-09-01" })).rejects.toThrow(/debut.*fin/i);
  });
});
