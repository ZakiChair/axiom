import { afterEach, describe, expect, it, vi } from "vitest";

describe("KV : ordre des éditions d'une même clé", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("sérialise PUT A, PUT B et DELETE, tout en laissant une autre clé avancer", async () => {
    vi.resetModules();
    const { kvPut, kvDelete } = await import("./daemon");
    let finirA!: (r: Response) => void;
    const appels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
      appels.push(`${String(input).split("/").at(-1)}:${init.method}:${init.body ?? ""}`);
      if (init.body === '"A"') return await new Promise<Response>(r => { finirA = r; });
      return Response.json({ majA: 20 });
    }));
    const a = kvPut("persist", "cle", "A");
    const b = kvPut("persist", "cle", "B");
    const suppression = kvDelete("persist", "cle");
    const autre = kvPut("persist", "autre", "C");
    await autre;
    expect(appels).toEqual(['cle:PUT:"A"', 'autre:PUT:"C"']);
    finirA(Response.json({ majA: 10 }));
    expect(await a).toBe(10); expect(await b).toBe(20); expect(await suppression).toBe(true);
    expect(appels).toEqual(['cle:PUT:"A"', 'autre:PUT:"C"', 'cle:PUT:"B"', 'cle:DELETE:']);
  });
  it("une écriture en échec ne bloque pas les éditions suivantes", async () => {
    vi.resetModules();
    const { kvPut } = await import("./daemon");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json({ majA: 20 })));
    expect(await kvPut("persist", "cle", "A")).toBeNull();
    expect(await kvPut("persist", "cle", "B")).toBe(20);
  });
});
