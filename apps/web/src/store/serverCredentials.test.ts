import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/deployment", () => ({ IS_VERCEL: true }));
import { hasServerCredential, initializeServerCredentials, serverCredentialsStore } from "./serverCredentials";

beforeEach(() => {
  vi.useFakeTimers();
  serverCredentialsStore.setState({ providers: {} });
});
afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function differe<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, ko) => { resolve = ok; reject = ko; });
  return { promise, resolve, reject };
}

const config = (providers: Record<string, unknown> = { coinalyze: true }) => Response.json({ providers });

describe("capacités serveur sans secret", () => {
  it("charge le chemin rapide et ne conserve que les booléens stricts des fournisseurs connus", async () => {
    const fetcher = vi.fn().mockResolvedValue(config({ fred: true, coinalyze: false, finnhub: "secret-inattendu", inconnu: true }));
    vi.stubGlobal("fetch", fetcher);
    await initializeServerCredentials();
    expect(hasServerCredential("fred")).toBe(true);
    expect(hasServerCredential("finnhub")).toBe(false);
    expect(JSON.stringify(serverCredentialsStore.getState())).not.toContain("secret-inattendu");
    expect(serverCredentialsStore.getState().providers).not.toHaveProperty("inconnu");
    expect(fetcher).toHaveBeenCalledWith("/api/config", expect.objectContaining({ cache: "no-store" }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([new Response("refus", { status: 403 }), Response.json({ providers: [] }), Response.json({}), new Response("html")])(
    "ne relance pas une réponse définitive ou malformée et conserve les capacités précédentes", async (response) => {
      serverCredentialsStore.setState({ providers: { fred: true } });
      const fetcher = vi.fn().mockResolvedValue(response);
      vi.stubGlobal("fetch", fetcher);
      await initializeServerCredentials();
      expect(serverCredentialsStore.getState().providers).toEqual({ fred: true });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("rend la main à 2s mais publie une réponse tardive par abonnement, sans rechargement", async () => {
    const reponse = differe<Response>();
    const fetcher = vi.fn().mockReturnValue(reponse.promise);
    vi.stubGlobal("fetch", fetcher);
    const notifications: boolean[] = [];
    const unsubscribe = serverCredentialsStore.subscribe(() => notifications.push(hasServerCredential("coinalyze")));
    try {
      let monte = false;
      const debut = initializeServerCredentials().then(() => { monte = true; });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(monte).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await debut;
      expect(monte).toBe(true);
      expect((fetcher.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(false);
      expect(notifications).toEqual([]);
      reponse.resolve(config());
      await vi.advanceTimersByTimeAsync(1);
      expect(notifications).toEqual([true]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { unsubscribe(); }
  });

  it.each(["réseau", "5xx"])("reprend une seule fois après une erreur %s, avec un délai de 2s", async (cause) => {
    const fetcher = vi.fn();
    if (cause === "réseau") fetcher.mockRejectedValueOnce(new TypeError("hors ligne"));
    else fetcher.mockResolvedValueOnce(new Response("indisponible", { status: 503 }));
    fetcher.mockResolvedValueOnce(config());
    vi.stubGlobal("fetch", fetcher);
    const debut = initializeServerCredentials();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await debut;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(hasServerCredential("coinalyze")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("borne deux erreurs réseau sans rejet non géré ni boucle permanente", async () => {
    serverCredentialsStore.setState({ providers: { fred: true } });
    const fetcher = vi.fn().mockRejectedValue(new TypeError("hors ligne"));
    vi.stubGlobal("fetch", fetcher);
    const debut = initializeServerCredentials();
    await vi.advanceTimersByTimeAsync(2_000);
    await debut;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(serverCredentialsStore.getState().providers).toEqual({ fred: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["fetch", "json"])("borne les attentes %s à 15s même si elles ignorent l’abandon", async (phase) => {
    const jamais = new Promise<Response>(() => {});
    const fetcher = phase === "fetch" ? vi.fn().mockReturnValue(jamais)
      : vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    vi.stubGlobal("fetch", fetcher);
    const debut = initializeServerCredentials();
    await vi.advanceTimersByTimeAsync(2_000);
    await debut;
    await vi.advanceTimersByTimeAsync(13_000);
    expect((fetcher.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect((fetcher.mock.calls[1]![1] as RequestInit).signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["réponse", "rejet"])("ignore le résultat tardif (%s) après le succès de la reprise", async (fin) => {
    const obsolete = differe<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(obsolete.promise).mockResolvedValueOnce(config());
    vi.stubGlobal("fetch", fetcher);
    const debut = initializeServerCredentials();
    await vi.advanceTimersByTimeAsync(17_000);
    await debut;
    expect(hasServerCredential("coinalyze")).toBe(true);
    if (fin === "réponse") obsolete.resolve(config({ coinalyze: false }));
    else obsolete.reject(new TypeError("rejet tardif après abandon"));
    await vi.advanceTimersByTimeAsync(1);
    expect(hasServerCredential("coinalyze")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("partage l’opération active entre appels simultanés et après le retour du montage", async () => {
    const reponse = differe<Response>();
    const fetcher = vi.fn().mockReturnValue(reponse.promise);
    vi.stubGlobal("fetch", fetcher);
    const debut = initializeServerCredentials();
    const simultane = initializeServerCredentials();
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all([debut, simultane]);
    const suivant = initializeServerCredentials();
    expect(fetcher).toHaveBeenCalledTimes(1);
    reponse.resolve(config());
    await suivant;
    expect(hasServerCredential("coinalyze")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
