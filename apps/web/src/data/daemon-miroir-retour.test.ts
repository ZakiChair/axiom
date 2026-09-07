import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HEALTH = { ok: true, service: "axiomd", apiVersion: 1, version: "0.1.0", capabilities: ["kv", "snapshots"] };
let present: boolean;
let local: Map<string, string>;
let remote: Map<string, unknown>;
let puts: number;

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  present = false; local = new Map(); remote = new Map(); puts = 0;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => local.set(key, value),
    removeItem: (key: string) => local.delete(key),
  });
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    if (String(input).endsWith("/health")) return Response.json(present ? HEALTH : {}, { status: present ? 200 : 503 });
    const key = decodeURIComponent(String(input).split("/").at(-1)!);
    if (init?.method === "PUT") { puts++; remote.set(key, JSON.parse(String(init.body))); }
    if (init?.method === "DELETE") remote.delete(key);
    return Response.json({ majA: Date.now(), supprime: true });
  }));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("miroir personnel après retour du daemon", () => {
  it("réamorce les valeurs locales actuelles après un boot sans daemon, sans nouvelle édition", async () => {
    const d = await import("./daemon");
    local.set("axiom:notes:v1", "notes avant absence");
    await d.initialiserMiroirPersonnel();
    expect(puts).toBe(0);
    local.set("axiom:notes:v1", "notes éditées hors ligne");
    local.set("axiom:api-key:fred", "privée");
    present = true;
    await vi.advanceTimersByTimeAsync(60_001);
    expect(remote.get("axiom:notes:v1")).toBe("notes éditées hors ligne");
    expect(remote.has("axiom:api-key:fred")).toBe(false);
    expect(remote.get("@perimetre:v1")).toContain("axiom:notes:v1");
  });
  it("une simple détection du daemon n'active pas les miroirs de persistence", async () => {
    const d = await import("./daemon");
    local.set("axiom:notes:v1", "privé sans persistence activée");
    await d.detectDaemon(); present = true;
    await vi.advanceTimersByTimeAsync(120_001);
    expect(puts).toBe(0);
  });
  it("ne resème pas à chaque sonde saine et réamorce après une nouvelle coupure", async () => {
    const d = await import("./daemon"); present = true;
    local.set("axiom:notes:v1", "première");
    await d.initialiserMiroirPersonnel();
    const firstPuts = puts;
    await vi.advanceTimersByTimeAsync(120_001);
    expect(puts).toBe(firstPuts);
    present = false; await vi.advanceTimersByTimeAsync(60_001);
    local.set("axiom:notes:v1", "dernière hors ligne");
    present = true; await vi.advanceTimersByTimeAsync(60_001);
    expect(remote.get("axiom:notes:v1")).toBe("dernière hors ligne");
    expect(puts).toBeGreaterThan(firstPuts);
  });
});
