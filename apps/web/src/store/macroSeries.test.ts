import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { macroSeriesStore } from "./macroSeries";
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
      const zone = url.includes("JPN") ? "JPN" : url.includes("CHN") ? "CHN" : "IND";
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
  it("charge les six régions et laisse les autres tracées quand une source tombe", async () => {
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
    expect(Object.values(s).filter((e) => e.points.length > 0)).toHaveLength(5);
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
            const zone = url.includes("JPN") ? "JPN" : url.includes("CHN") ? "CHN" : "IND";
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
    expect(attentes.filter((ms) => ms >= 2000)).toHaveLength(2);
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
    expect(n1).toBe(3); // Japon, Chine, Inde

    macroSeriesStore.setState({ series: {} }); // état perdu, cache conservé
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", opts);
    expect(appelsOecd()).toBe(n1); // servi par le cache : aucun appel OCDE de plus

    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { ...opts, force: true });
    expect(appelsOecd()).toBe(n1 + 3); // force ignore le cache
  });

  it("enregistre une clé de santé par hôte, pas par série", async () => {
    vi.stubGlobal("fetch", stubParHote());
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { attendre: () => Promise.resolve() });
    const cles = Object.keys(healthStore.getState().sources).filter((k) => k.startsWith("macro:"));
    // Quatre hôtes, six séries : la clé nomme le fournisseur, jamais l'observation.
    expect(cles.sort()).toEqual(["macro:eurostat", "macro:fred", "macro:oecd", "macro:ons"]);
  });
});
