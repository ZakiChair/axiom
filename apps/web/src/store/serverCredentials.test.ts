import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/deployment", () => ({ IS_VERCEL: true }));
import { hasServerCredential, initializeServerCredentials, serverCredentialsStore } from "./serverCredentials";

beforeEach(() => serverCredentialsStore.setState({ providers: {} }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("capacités serveur sans secret", () => {
  it("ne conserve que les booléens stricts des fournisseurs connus", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ providers: { fred: true, coinalyze: false, finnhub: "secret-inattendu", inconnu: true } }));
    vi.stubGlobal("fetch", fetcher);
    await initializeServerCredentials();
    expect(hasServerCredential("fred")).toBe(true);
    expect(hasServerCredential("finnhub")).toBe(false);
    expect(JSON.stringify(serverCredentialsStore.getState())).not.toContain("secret-inattendu");
    expect(serverCredentialsStore.getState().providers).not.toHaveProperty("inconnu");
    expect(fetcher).toHaveBeenCalledWith("/api/config", expect.objectContaining({ cache: "no-store" }));
  });

  it.each([Response.json({}, { status: 503 }), Response.json({ providers: [] }), new Response("html")])("dégrade une réponse indisponible ou invalide sans bloquer", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await initializeServerCredentials();
    expect(serverCredentialsStore.getState().providers).toEqual({});
  });

  it("abandonne la requête après deux secondes et rend la main", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const pending = initializeServerCredentials();
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(serverCredentialsStore.getState().providers).toEqual({});
  });
});
