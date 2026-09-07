import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chargerEvenementsEco } from "./eco";
import { chargerDatesEvenement } from "./macro/eventDates";

describe("calendrier : clé personnelle et résultats de publication", () => {
  const now = Date.UTC(2026, 8, 7, 12, 35);
  let storage: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    fetchMock = vi.fn(async (input: string) => new Response(JSON.stringify(
      input.startsWith("/fredapi") ? { release_dates: [] } : [{
        title: "CPI y/y", country: "USD", impact: "High",
        date: "2026-09-07T12:30:00Z", actual: "2.8%",
      }],
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("transmet la clé personnelle uniquement à FRED", async () => {
    storage.set("axiom:fred:key", "test-personal-fred-key");
    await chargerEvenementsEco({ force: true });
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(new URL(urls.find((url) => url.startsWith("/fredapi"))!, "http://localhost").searchParams.get("api_key")).toBe("test-personal-fred-key");
    expect(urls.filter((url) => !url.startsWith("/fredapi")).every((url) => !url.includes("test-personal-fred-key"))).toBe(true);
  });

  it("rafraîchit un résultat récent malgré un calendrier mis en cache depuis une heure", async () => {
    storage.set("axiom:eco:cache:v1", JSON.stringify({ ts: now - 3_600_000, events: [{
      id: "test-cpi", title: "CPI y/y", country: "USD", impact: "high",
      source: "forexfactory", time: now - 5 * 60_000,
    }] }));
    const result = await chargerEvenementsEco();
    expect(result.depuisCache).toBe(false);
    expect(result.events.find((event) => event.title === "CPI y/y")?.actual).toBe("2.8%");
  });

  it("transmet aussi la clé personnelle aux dates historiques CPI/NFP", async () => {
    storage.set("axiom:fred:key", "test-personal-fred-key");
    await chargerDatesEvenement("cpi");
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(new URL(url, "http://localhost").searchParams.get("api_key")).toBe("test-personal-fred-key");
  });

  it("conserve le cache loin d'une publication et respecte le quota près d'elle", async () => {
    storage.set("axiom:eco:cache:v1", JSON.stringify({ ts: now - 3_600_000, events: [{
      id: "future", source: "forexfactory", impact: "high", time: now + 86_400_000,
    }] }));
    expect((await chargerEvenementsEco()).depuisCache).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    storage.set("axiom:eco:fetchLog:v1", JSON.stringify([now - 1000, now - 2000]));
    expect((await chargerEvenementsEco({ force: true })).brideDebit).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("une annulation ne remplace pas le cache par des résultats partiels", async () => {
    const initial = JSON.stringify({ ts: now - 86_400_000, events: [{ id: "saved" }] });
    storage.set("axiom:eco:cache:v1", initial);
    const controller = new AbortController();
    controller.abort();
    await chargerEvenementsEco({ force: true, signal: controller.signal });
    expect(storage.get("axiom:eco:cache:v1")).toBe(initial);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
