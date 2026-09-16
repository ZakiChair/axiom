import { beforeEach, describe, expect, test } from "bun:test";
import type { FetchExtapi } from "./proxy";
import {
  COOLDOWN_QUOTA_DEFAUT_MS,
  COOLDOWN_QUOTA_MAX_MS,
  cooldownRestant,
  dureeRetryAfter,
  enregistrerQuotaEpuise,
  reinitialiserCooldownsQuota,
  traiterProxy,
  type RouteProxy,
} from "./proxy";

const route: RouteProxy = {
  prefix: "/fredapi",
  target: "https://api.stlouisfed.org",
  rewrite: (chemin) => chemin.replace(/^\/fredapi/, ""),
};
const url = new URL("http://127.0.0.1:8787/fredapi/fred/series/observations?series_id=DGS10");

/** URL distincte par test : le cache proxy est partagé entre les cas (même chemin = hit). */
const urlDe = (n: number): URL => new URL(`http://127.0.0.1:8787/fredapi/fred/series/observations?series_id=DGS10&cas=${n}`);

const options = (fetchImpl: FetchExtapi) => ({
  resoudreHote: async () => ["8.8.8.8"],
  fetchImpl,
  // Cache NEUTRE : le cache du daemon est un SQLite PERSISTANT — une entrée 200 écrite par
  // un run précédent ferait un hit et masquerait le fetch qu'on veut observer.
  lireCacheImpl: () => null,
  ecrireCacheImpl: () => {},
});

describe("dureeRetryAfter", () => {
  test("secondes, date HTTP, repli et plafond", () => {
    expect(dureeRetryAfter("120")).toBe(120_000);
    expect(dureeRetryAfter("0.5")).toBe(500);
    expect(dureeRetryAfter("99999")).toBe(COOLDOWN_QUOTA_MAX_MS);
    expect(dureeRetryAfter(null)).toBe(COOLDOWN_QUOTA_DEFAUT_MS);
    expect(dureeRetryAfter("0")).toBe(COOLDOWN_QUOTA_DEFAUT_MS);
    expect(dureeRetryAfter("bientôt")).toBe(COOLDOWN_QUOTA_DEFAUT_MS);
    const dans30s = new Date(Date.now() + 30_000).toUTCString();
    const duree = dureeRetryAfter(dans30s);
    expect(duree).toBeGreaterThan(25_000);
    expect(duree).toBeLessThanOrEqual(31_000);
    // Date passée → repli (jamais un cooldown nul).
    expect(dureeRetryAfter(new Date(Date.now() - 5_000).toUTCString())).toBe(COOLDOWN_QUOTA_DEFAUT_MS);
  });
});

describe("quota amont (429 / Retry-After)", () => {
  beforeEach(() => reinitialiserCooldownsQuota());

  test("un 429 met l'hôte en quarantaine et propage retry-after", async () => {
    let appels = 0;
    const u = urlDe(1);
    const rep = await traiterProxy(new Request(u), u, route, options(async () => {
      appels += 1;
      return new Response("quota", { status: 429, headers: { "retry-after": "90" } });
    }));
    expect(rep.status).toBe(429);
    expect(rep.headers.get("retry-after")).toBe("90");
    expect(appels).toBe(1);
    expect(cooldownRestant("api.stlouisfed.org")).toBeGreaterThan(89_000);
  });

  test("pendant le cooldown, aucune requête amont : 429 local avec retryAfterSec", async () => {
    let appels = 0;
    const fetchImpl = async () => {
      appels += 1;
      return new Response("quota", { status: 429, headers: { "retry-after": "90" } });
    };
    const u = urlDe(2);
    await traiterProxy(new Request(u), u, route, options(fetchImpl));
    const rep2 = await traiterProxy(new Request(u), u, route, options(fetchImpl));
    expect(rep2.status).toBe(429);
    expect(appels).toBe(1); // le second appel n'a PAS touché l'amont
    expect(rep2.headers.get("retry-after")).not.toBeNull();
    const corps = (await rep2.json()) as { erreur: string; retryAfterSec: number };
    expect(corps.erreur).toContain("quota");
    expect(corps.retryAfterSec).toBeGreaterThan(0);
  });

  test("cooldown expiré : l'amont est réinterrogé", async () => {
    let appels = 0;
    const fetchImpl = async () => {
      appels += 1;
      return Response.json({ ok: true });
    };
    // Échéance passée posée directement (pas d'attente réelle dans le test).
    enregistrerQuotaEpuise("api.stlouisfed.org", null, Date.now() - COOLDOWN_QUOTA_DEFAUT_MS - 1);
    const u = urlDe(3);
    const rep = await traiterProxy(new Request(u), u, route, options(fetchImpl));
    expect(rep.status).toBe(200);
    expect(appels).toBe(1);
  });

  test("un 503 SANS retry-after ne met PAS l'hôte en quarantaine", async () => {
    let appels = 0;
    const fetchImpl = async () => {
      appels += 1;
      return new Response("indisponible", { status: 503 });
    };
    const u = urlDe(4);
    await traiterProxy(new Request(u), u, route, options(fetchImpl));
    expect(cooldownRestant("api.stlouisfed.org")).toBe(0);
    await traiterProxy(new Request(u), u, route, options(fetchImpl));
    expect(appels).toBe(2);
  });
});
