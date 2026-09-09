import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { macroSeriesStore, PREFIXE_CACHE, TTL_CACHE_MS } from "./macroSeries";
import { healthStore } from "./health";

// ⚠️ apps/web tourne sous Vitest en environnement NODE, sans jsdom (convention affirmée
// dans tout le dépôt). `localStorage` n'existe donc pas : on installe le faux Storage
// maison, copié de data/cmcMcap.test.ts:32 — même forme, mêmes bornes de vie.
function installMockLocalStorage(): void {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

/** Réponse OCDE minimale valide pour une zone donnée. */
function reponseOecd(refArea: string, valeur: number): unknown {
  return {
    data: {
      dataSets: [{ series: { "0:0:0:0:0:0:0:0": { observations: { "0": [valeur, 0] } } } }],
      structures: [
        {
          dimensions: {
            series: [{ id: "REF_AREA", keyPosition: 0, values: [{ id: refArea }] }],
            observation: [{ id: "TIME_PERIOD", values: [{ id: "2026-07" }] }],
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  installMockLocalStorage();
  macroSeriesStore.setState({ series: {} });
  healthStore.setState({ sources: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

/**
 * Aiguillage de stub par HÔTE, partagé par les tests qui ont besoin des six séries.
 * Servir la même charge utile à toutes les URL ferait échouer les parseurs non-OCDE
 * (« bloc months absent »), leurs séries passeraient en `panne`, ne seraient donc PAS
 * mises en cache — et un test de cache compterait alors des refetch parasites.
 */
function stubParHote(): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url.includes("stlouisfed") || url.includes("/fredapi")) {
      return Promise.resolve({ ok: false, status: 401, statusText: "Unauthorized" });
    }
    if (url.includes("sdmx.oecd.org")) {
      const zone = url.includes("JPN") ? "JPN" : url.includes("CHN") ? "CHN" : url.includes("CAN") ? "CAN" : url.includes("CHE") ? "CHE" : "IND";
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reponseOecd(zone, 1)) });
    }
    if (url.includes("ec.europa.eu")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: ["freq", "unit", "coicop18", "geo", "time"],
            size: [1, 1, 1, 1, 1],
            dimension: { time: { category: { index: { "2026-08": 0 } } } },
            value: { "0": 3.2 },
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ months: [{ year: "2026", month: "July", value: "2.9" }] }),
    });
  });
}

describe("macroSeriesStore.demanderIndicateur", () => {
  it("charge les huit régions et laisse les autres tracées quand une source tombe", async () => {
    vi.stubGlobal("fetch", stubParHote());

    // `attendre` neutralisé : le séquencement est vérifié par son propre test.
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { attendre: () => Promise.resolve() });

    const s = macroSeriesStore.getState().series;
    expect(s["cpi-aa-us"]?.statut).toBe("sansCle");
    expect(s["cpi-aa-ez"]?.statut).toBe("ok");
    expect(s["cpi-aa-uk"]?.statut).toBe("ok");
    expect(s["cpi-aa-jp"]?.statut).toBe("ok");
    expect(s["cpi-aa-cn"]?.statut).toBe("ok");
    expect(s["cpi-aa-in"]?.statut).toBe("ok");
    // Cinq courbes sur six restent traçables malgré l'absence de clé FRED.
    expect(Object.values(s).filter((e) => e.points.length > 0)).toHaveLength(7);
  });

  it("espace les appels OCDE et ne les lance jamais en parallèle", async () => {
    const attentes: number[] = [];
    let enVol = 0;
    let maxEnVol = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (!url.includes("sdmx.oecd.org")) {
          return Promise.resolve({ ok: false, status: 503, statusText: "" });
        }
        enVol++;
        maxEnVol = Math.max(maxEnVol, enVol);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => {
            enVol--;
            const zone = url.includes("JPN") ? "JPN" : url.includes("CHN") ? "CHN" : url.includes("CAN") ? "CAN" : url.includes("CHE") ? "CHE" : "IND";
            return Promise.resolve(reponseOecd(zone, 1));
          },
        });
      }),
    );

    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", {
      attendre: (ms) => {
        attentes.push(ms);
        return Promise.resolve();
      },
    });

    expect(maxEnVol).toBe(1);
    // Trois séries OCDE → deux attentes intercalées, d'au moins 2 s chacune.
    expect(attentes.filter((ms) => ms >= 2000).length).toBeGreaterThanOrEqual(4);
  });

  it("sert le cache sans refetch dans les 24 h, et refetch si force", async () => {
    const appels = stubParHote();
    vi.stubGlobal("fetch", appels);
    const opts = { attendre: () => Promise.resolve() };
    // On ne compte QUE les séries réellement mises en cache. La série US est en 401
    // (« sansCle ») : elle n'est pas cachée, donc elle sera légitimement redemandée —
    // la compter fausserait le test.
    const appelsOecd = (): number =>
      appels.mock.calls.filter((c) => String(c[0]).includes("sdmx.oecd.org")).length;

    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", opts);
    const n1 = appelsOecd();
    expect(n1).toBe(5); // Japon, Chine, Inde, Canada, Suisse

    macroSeriesStore.setState({ series: {} }); // état perdu, cache conservé
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", opts);
    expect(appelsOecd()).toBe(n1); // servi par le cache : aucun appel OCDE de plus

    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { ...opts, force: true });
    expect(appelsOecd()).toBe(n1 + 5); // force ignore le cache
  });

  it("enregistre une clé de santé par hôte, pas par série", async () => {
    vi.stubGlobal("fetch", stubParHote());
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { attendre: () => Promise.resolve() });
    const cles = Object.keys(healthStore.getState().sources).filter((k) => k.startsWith("macro:"));
    // Quatre hôtes, six séries : la clé nomme le fournisseur, jamais l'observation.
    expect(cles.sort()).toEqual(["macro:eurostat", "macro:fred", "macro:oecd", "macro:ons"]);
  });

  it("ne lance jamais deux chargements en parallèle pour le même indicateur", async () => {
    const appels = stubParHote();
    vi.stubGlobal("fetch", appels);
    const opts = { attendre: () => Promise.resolve() };

    // Deux appels concurrents, sans attendre le premier avant de lancer le second.
    const p1 = macroSeriesStore.getState().demanderIndicateur("cpi-aa", opts);
    const p2 = macroSeriesStore.getState().demanderIndicateur("cpi-aa", opts);
    await Promise.all([p1, p2]);

    const appelsOecd = appels.mock.calls.filter((c) => String(c[0]).includes("sdmx.oecd.org"));
    // Sans garde de réentrance : chaque appel lance sa propre boucle OCDE (3 + 3 = 6).
    // Avec la garde : le second appel partage la promesse du premier (3 seulement).
    expect(appelsOecd).toHaveLength(5);
  });

  it("ignore une entrée de cache plus vieille que TTL_CACHE_MS et refetch", async () => {
    const now = Date.now();
    // Déposée DIRECTEMENT dans le faux localStorage, juste au-delà du TTL.
    localStorage.setItem(
      PREFIXE_CACHE + "cpi-aa-jp",
      JSON.stringify({ ts: now - TTL_CACHE_MS - 1, points: [{ time: now, value: 1.9 }] }),
    );
    const appels = stubParHote();
    vi.stubGlobal("fetch", appels);

    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { attendre: () => Promise.resolve() });

    const appelsJapon = appels.mock.calls.filter((c) => String(c[0]).includes("JPN"));
    expect(appelsJapon.length).toBeGreaterThan(0); // cache expiré ignoré : refetch
    expect(macroSeriesStore.getState().series["cpi-aa-jp"]?.statut).toBe("ok");
  });

  it("sert une entrée de cache plus fraîche que TTL_CACHE_MS sans refetch", async () => {
    const appels = stubParHote();
    vi.stubGlobal("fetch", appels);
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["JP"], attendre: () => Promise.resolve() });
    macroSeriesStore.setState({ series: {} });
    appels.mockClear();

    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { attendre: () => Promise.resolve() });

    const appelsJapon = appels.mock.calls.filter((c) => String(c[0]).includes("JPN"));
    expect(appelsJapon).toHaveLength(0); // cache encore valide : aucun refetch
    expect(macroSeriesStore.getState().series["cpi-aa-jp"]?.points).toHaveLength(1);
  });
});


describe("fenêtre, cache conservé et annulation", () => {
  it("ne charge que les régions choisies et élargit réellement de 1 à 10 ans", async () => {
    const appels = stubParHote();
    vi.stubGlobal("fetch", appels);
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["UK"], horizonAnnees: 1 });
    expect(appels).toHaveBeenCalledTimes(1);
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["UK"], horizonAnnees: 10 });
    expect(appels).toHaveBeenCalledTimes(2);
    expect(Object.keys(macroSeriesStore.getState().series)).toEqual(["cpi-aa-uk"]);
  });

  it("conserve le dernier historique valide en signalant un refresh échoué", async () => {
    vi.stubGlobal("fetch", stubParHote());
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["UK"] });
    const avant = macroSeriesStore.getState().series["cpi-aa-uk"]!;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("hors ligne")));
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["UK"], force: true });
    const apres = macroSeriesStore.getState().series["cpi-aa-uk"]!;
    expect(apres.points).toEqual(avant.points);
    expect(apres.majTs).toBe(avant.majTs);
    expect(apres.recupereTs).toBe(avant.recupereTs);
    expect(apres.perime).toBe(true);
    expect(apres.statut).toBe("panne");
  });

  it("annule un appel sans créer de panne et transmet le signal au transport", async () => {
    const ctrl = new AbortController();
    let commence!: () => void;
    const debut = new Promise<void>((resolve) => { commence = resolve; });
    vi.stubGlobal("fetch", vi.fn((_url, opts: RequestInit) => {
      expect(opts.signal).toBe(ctrl.signal);
      commence();
      return new Promise((_resolve, reject) => opts.signal!.addEventListener("abort", () => reject(new DOMException("Annulé", "AbortError"))));
    }));
    const chargement = macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["UK"], signal: ctrl.signal });
    await debut;
    ctrl.abort();
    await chargement;
    expect(macroSeriesStore.getState().series["cpi-aa-uk"]?.statut).toBe("idle");
    expect(healthStore.getState().sources["macro:ons"]).toBeUndefined();
  });

  it("sérialise l'OCDE même entre familles concurrentes et saute la file annulée", async () => {
    let actif = 0;
    let maximum = 0;
    const appels = vi.fn(async () => {
      maximum = Math.max(maximum, ++actif);
      await Promise.resolve();
      actif--;
      return { ok: true, status: 200, json: async () => reponseOecd("JPN", 1) };
    });
    vi.stubGlobal("fetch", appels);
    const attendre = async () => {};
    const p1 = macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["JP"], attendre });
    const p2 = macroSeriesStore.getState().demanderIndicateur("core-cpi-aa", { regions: ["JP"], attendre });
    const ctrl = new AbortController();
    const p3 = macroSeriesStore.getState().demanderIndicateur("cpi-mm", { regions: ["JP"], attendre, signal: ctrl.signal });
    ctrl.abort();
    await Promise.all([p1, p2, p3]);
    expect(maximum).toBe(1);
    expect(appels).toHaveBeenCalledTimes(2);
    expect(macroSeriesStore.getState().series["cpi-mm-jp"]?.statut).toBe("idle");
  });

  it("date la fraîcheur ONS à la fin du trimestre glissant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ months: [{ year: "2026", month: "May", value: "4.9" }] }) }));
    await macroSeriesStore.getState().demanderIndicateur("chomage", { regions: ["UK"] });
    expect(macroSeriesStore.getState().series["chomage-uk"]?.majTs).toBe(Date.UTC(2026, 6, 1) - 1);
  });
});

describe("vues ALFRED isolées par cutoff", () => {
  const cutoffA = "2026-08-15";
  const cutoffB = "2025-01-01";
  const reponseAlfred = (valeur: number) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ observations: [{ date: "2024-12-01", value: String(valeur), realtime_start: cutoffA, realtime_end: cutoffA }] }),
  });

  it("vide immédiatement la vue précédente pendant le chargement d'un autre millésime", async () => {
    let terminer!: () => void;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(reponseAlfred(100))
      .mockImplementationOnce(() => new Promise((resolve) => { terminer = () => resolve(reponseAlfred(90)); })));
    await macroSeriesStore.getState().demanderIndicateur("pce-niveau", { regions: ["US"], connuLe: cutoffA });
    const chargement = macroSeriesStore.getState().demanderIndicateur("pce-niveau", { regions: ["US"], connuLe: cutoffB, force: true });
    expect(macroSeriesStore.getState().series["pce-niveau-us"]).toMatchObject({ statut: "loading", points: [], contexteConnuLe: cutoffB });
    terminer();
    await chargement;
  });

  it("ne conserve pas des points d'un autre cutoff après une panne ou une annulation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reponseAlfred(100)).mockRejectedValueOnce(new Error("hors ligne")));
    await macroSeriesStore.getState().demanderIndicateur("pce-niveau", { regions: ["US"], connuLe: cutoffA });
    await macroSeriesStore.getState().demanderIndicateur("pce-niveau", { regions: ["US"], connuLe: cutoffB, force: true });
    expect(macroSeriesStore.getState().series["pce-niveau-us"]).toMatchObject({ statut: "panne", points: [], contexteConnuLe: cutoffB });

    const ctrl = new AbortController();
    let commence!: () => void;
    const debut = new Promise<void>((resolve) => { commence = resolve; });
    vi.stubGlobal("fetch", vi.fn((_url, opts: RequestInit) => new Promise((_resolve, reject) => {
      commence();
      opts.signal?.addEventListener("abort", () => reject(new DOMException("Annulé", "AbortError")));
    })));
    const p = macroSeriesStore.getState().demanderIndicateur("pce-niveau", { regions: ["US"], connuLe: cutoffB, force: true, signal: ctrl.signal });
    await debut;
    ctrl.abort();
    await p;
    expect(macroSeriesStore.getState().series["pce-niveau-us"]).toMatchObject({ statut: "panne", points: [], contexteConnuLe: cutoffB });
  });

  it("n'affiche pas le cache ALFRED d'un autre cutoff lorsque le nouveau chargement échoue", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reponseAlfred(100)).mockRejectedValueOnce(new Error("hors ligne")));
    await macroSeriesStore.getState().demanderIndicateur("pce-niveau", { regions: ["US"], connuLe: cutoffA });
    macroSeriesStore.setState({ series: {} });
    await macroSeriesStore.getState().demanderIndicateur("pce-niveau", { regions: ["US"], connuLe: cutoffB });
    expect(macroSeriesStore.getState().series["pce-niveau-us"]).toMatchObject({ statut: "panne", points: [], contexteConnuLe: cutoffB });
  });

  it("ancre la requête historique à connuLe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponseAlfred(100)));
    await macroSeriesStore.getState().demanderIndicateur("pce-niveau", { regions: ["US"], horizonAnnees: 5, connuLe: "2020-01-15" });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("observation_start=2015-01-01");
  });
});

it("restaure un historique expiré après remontage même si le fournisseur tombe", async () => {
  vi.stubGlobal("fetch", stubParHote());
  await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["UK"] });
  const key = PREFIXE_CACHE + "cpi-aa-uk";
  const cache = JSON.parse(localStorage.getItem(key)!);
  cache.ts = Date.now() - TTL_CACHE_MS - 1;
  localStorage.setItem(key, JSON.stringify(cache));
  macroSeriesStore.setState({ series: {} });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("hors ligne")));
  await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { regions: ["UK"] });
  expect(macroSeriesStore.getState().series["cpi-aa-uk"]).toMatchObject({ statut: "panne", perime: true, points: cache.points, recupereTs: cache.ts });
});
