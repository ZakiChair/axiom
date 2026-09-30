import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chargerEarnings, chargerProfilFinnhub } from "./finnhub";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const OLD = Date.parse("2026-09-29T12:00:00Z");
const profile = { nom: "Apple", secteur: "Technology", capitalisation: 3_000_000, description: "" };
const earnings = [{ ticker: "AAPL", date: "2026-10-30", epsEstime: 1.5, epsReel: null }];
const cases = [
  { id: "profil", load: chargerProfilFinnhub, cached: profile, response: { name: "Apple", finnhubIndustry: "Technology", marketCapitalization: 3_000_000, weburl: "" } },
  { id: "earnings", load: chargerEarnings, cached: earnings, response: { earningsCalendar: [{ date: "2026-10-30", epsEstimate: 1.5, epsActual: null }] } },
] as const;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

for (const source of cases) describe(`Finnhub ${source.id} — fraîcheur`, () => {
  const key = `axiom:onchain:finnhub:${source.id}:AAPL`;
  const seed = (ts = OLD) => localStorage.setItem(key, JSON.stringify({ ts, donnee: source.cached }));
  it("rend la date du cache frais sans le rafraîchir artificiellement", async () => {
    seed(NOW - 60_000);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await source.load("AAPL", null)).toMatchObject({ ok: true, donnee: source.cached, ts: NOW - 60_000, perime: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  for (const status of [401, 429, 503]) it(`HTTP ${status} : garde les données périmées et leur ancienne date`, async () => {
    seed();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret-amont-ne-pas-afficher", { status })));
    const result = await source.load("AAPL", null);
    expect(result).toMatchObject({ ok: true, donnee: source.cached, ts: OLD, perime: true, raison: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain("secret-amont");
    expect(JSON.parse(localStorage.getItem(key)!).ts).toBe(OLD);
  });
  it("réseau coupé : marque le repli périmé ; sans cache, expose l'échec", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    seed();
    expect(await source.load("AAPL", null)).toMatchObject({ ok: true, ts: OLD, perime: true, raison: expect.stringMatching(/injoignable/i) });
    localStorage.removeItem(key);
    expect(await source.load("AAPL", null)).toMatchObject({ ok: false, raison: expect.stringMatching(/injoignable/i) });
  });
  it("une réponse réussie remplace le cache périmé avec une vraie nouvelle date", async () => {
    seed();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(source.response)));
    expect(await source.load("AAPL", "personnelle")).toEqual({ ok: true, donnee: source.cached, ts: NOW, perime: false });
    expect(JSON.parse(localStorage.getItem(key)!).ts).toBe(NOW);
  });
  it("une annulation en vol ne publie ni repli réussi ni nouvelle date", async () => {
    seed();
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { ctrl.abort(); throw new DOMException("Annulé", "AbortError"); }));
    expect(await source.load("AAPL", null, ctrl.signal)).toMatchObject({ ok: false, annule: true });
    expect(JSON.parse(localStorage.getItem(key)!).ts).toBe(OLD);
  });
  it("une annulation avant lecture n'envoie pas de requête", async () => {
    seed();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await source.load("AAPL", null, AbortSignal.abort())).toMatchObject({ ok: false, annule: true });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([NOW + 60_000, 1e99, -1])("ignore un horodatage de cache impossible ou futur (%s)", async ts => {
    seed(ts);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("indisponible", { status: 503 })));
    expect(await source.load("AAPL", null)).toMatchObject({ ok: false, raison: expect.any(String) });
  });
});

it("un profil absent dans la nouvelle réponse ne rajeunit pas l'ancien profil conservé", async () => {
  localStorage.setItem("axiom:onchain:finnhub:profil:AAPL", JSON.stringify({ ts: OLD, donnee: profile }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  expect(await chargerProfilFinnhub("AAPL", null)).toMatchObject({ ok: true, donnee: profile, ts: OLD, perime: true, raison: expect.any(String) });
});

it("un calendrier mal formé ne remplace pas un cache existant par une fausse liste vide", async () => {
  localStorage.setItem("axiom:onchain:finnhub:earnings:AAPL", JSON.stringify({ ts: OLD, donnee: earnings }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid" })));
  expect(await chargerEarnings("AAPL", null)).toMatchObject({ ok: true, donnee: earnings, ts: OLD, perime: true, raison: expect.any(String) });
});
