import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../onchain/cache", () => ({ lireCache: vi.fn(async () => null), ecrireCache: vi.fn(async () => undefined), estFrais: vi.fn(() => false) }));
import { lireCache, ecrireCache } from "../onchain/cache";
import { chargerIndiceGeo, lireTexteBorne } from "./indicesGeo";
import { chargerHistoriquePortWatch } from "./portwatchHistorique";

describe("historiques géo : erreurs, bornes et annulations", () => {
  beforeEach(() => { vi.mocked(lireCache).mockResolvedValue(null); vi.mocked(ecrireCache).mockClear(); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("coupe le flux dès la borne dépassée", async () => {
    let blocs = 0; const annuler = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      pull(c) { blocs++; if (blocs <= 10) c.enqueue(new Uint8Array(1024)); else c.close(); }, cancel: annuler,
    }))));
    await expect(lireTexteBorne("https://example.test/data", undefined, 1024)).rejects.toThrow("volumineuse");
    expect(blocs).toBeLessThan(5); expect(annuler).toHaveBeenCalled();
  });
  it("un échec conserve le cache avec son âge, sans le réécrire", async () => {
    vi.mocked(lireCache).mockResolvedValue({ ts: 100, donnee: { series: [{ id: "gpr", nom: "GPR", points: [{ time: 0, value: 3 }] }], millesime: null, recupereTs: 100 } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("indisponible", { status: 503 })));
    expect(await chargerIndiceGeo("gpr")).toMatchObject({ perime: true, recupereTs: 100 });
    expect(ecrireCache).not.toHaveBeenCalled();
  });
  it("n'enregistre pas une série après annulation", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); return new Response("[]"); }));
    await expect(chargerIndiceGeo("tpu", controller.signal)).rejects.toThrow();
    expect(ecrireCache).not.toHaveBeenCalled();
  });
  it("pagine le vrai historique d'un seul détroit sans transmettre de SQL libre", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const offset = new URL(input).searchParams.get("resultOffset");
      return Response.json({ exceededTransferLimit: offset === "0", features: [{ attributes: { portid: "chokepoint6", date: offset === "0" ? "2026-08-29" : "2026-08-30", n_total: 6 } }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await chargerHistoriquePortWatch("chokepoint6", "2026-08-30")).points).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(chargerHistoriquePortWatch("x' OR 1=1", "2026-08-30")).rejects.toThrow("invalide");
    await expect(chargerHistoriquePortWatch("chokepoint6", "2026-02-31")).rejects.toThrow("invalide");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("refuse une pagination infinie sans mettre en cache un historique tronqué", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ exceededTransferLimit: true, features: [] })));
    await expect(chargerHistoriquePortWatch("chokepoint6", "2026-08-30")).rejects.toThrow("incomplète");
    expect(fetch).toHaveBeenCalledTimes(4); expect(ecrireCache).not.toHaveBeenCalled();
  });
});
