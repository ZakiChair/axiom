import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLE_INDEX_HISTORIQUE,
  MAX_ENTREES,
  MESSAGE_COLONNES_INTROUVABLES,
  RELANCE_ERREUR_MS,
  cleCacheHistorique,
  cotHistoriqueStore,
  ecrireCacheHistorique,
  lireCacheHistorique,
  reinitialiserCotHistorique,
} from "./cotHistorique";
import { compacterSerie, type SerieHistoriqueCot } from "../data/cotHistorique";

const SP = "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE";
const OR = "GOLD - COMMODITY EXCHANGE INC.";

/** localStorage en mémoire, avec quota optionnel (en caractères). */
function stubStorage(quota = Infinity) {
  const donnees = new Map<string, string>();
  const ls = {
    getItem: (k: string) => donnees.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const total = [...donnees].reduce((s, [cle, val]) => s + (cle === k ? 0 : val.length), 0) + v.length;
      if (total > quota) throw new DOMException("quota", "QuotaExceededError");
      donnees.set(k, v);
    },
    removeItem: (k: string) => void donnees.delete(k),
  };
  vi.stubGlobal("localStorage", ls);
  return donnees;
}

function recTff(date: string, amLong: number) {
  return {
    market_and_exchange_names: SP,
    report_date_as_yyyy_mm_dd: `${date}T00:00:00.000`,
    open_interest_all: String(amLong + 1000),
    dealer_positions_long_all: "100",
    dealer_positions_short_all: String(amLong),
    asset_mgr_positions_long: String(amLong),
    asset_mgr_positions_short: "100",
    lev_money_positions_long: "300",
    lev_money_positions_short: "300",
    other_rept_positions_long: "50",
    other_rept_positions_short: "50",
    nonrept_positions_long_all: "20",
    nonrept_positions_short_all: "20",
  };
}

/** fetch simulé : découverte (sans $select) puis historique (avec $select). */
function stubFetch(historique: unknown[], decouverte: unknown[] = historique.slice(-4)) {
  const appels: string[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = decodeURIComponent(String(input));
    appels.push(url);
    const corps = url.includes("$select") ? historique : decouverte;
    return new Response(JSON.stringify(corps), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return appels;
}

const HISTORIQUE = [recTff("2026-10-20", 900), recTff("2026-10-27", 1000)];
const initial = cotHistoriqueStore.getState();

beforeEach(() => {
  reinitialiserCotHistorique();
  cotHistoriqueStore.setState({ ...initial, marche: SP, mode: "detaille", serie: null, ts: null, erreur: null, nonCouvert: false }, true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
});

afterEach(() => {
  reinitialiserCotHistorique();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("chargement d'un historique", () => {
  it("découvre les colonnes puis lit l'historique complet, et le met en cache", async () => {
    const donnees = stubStorage();
    const appels = stubFetch(HISTORIQUE);
    await cotHistoriqueStore.getState().charger();

    expect(appels).toHaveLength(2);
    expect(appels[0]).toContain("publicreporting.cftc.gov/resource/gpe5-46if.json");
    expect(appels[0]).not.toContain("$select");
    expect(appels[1]).toContain("$select=market_and_exchange_names,report_date_as_yyyy_mm_dd,open_interest_all,dealer_positions_long_all");

    const s = cotHistoriqueStore.getState();
    expect(s.erreur).toBeNull();
    expect(s.enCours).toBe(false);
    expect(s.serie?.dataset).toBe("tff");
    expect(s.serie?.points).toHaveLength(2);
    expect(s.serie?.disponibles).toEqual([true, true, true, true, true]);
    const cle = cleCacheHistorique("tff", SP);
    expect(lireCacheHistorique(cle)?.serie.points).toHaveLength(2);
    expect(JSON.parse(donnees.get(CLE_INDEX_HISTORIQUE)!)).toEqual([cle]);
  });

  it("ne relit pas la CFTC avant la publication suivante, puis relit", async () => {
    stubStorage();
    const appels = stubFetch(HISTORIQUE);
    await cotHistoriqueStore.getState().charger();
    await cotHistoriqueStore.getState().charger();
    expect(appels).toHaveLength(2);

    // Rapport du mardi 27 octobre : le suivant paraît le vendredi 6 novembre à 20 h 30 UTC.
    vi.setSystemTime(new Date("2026-11-06T20:00:00Z"));
    await cotHistoriqueStore.getState().charger();
    expect(appels).toHaveLength(2);
    vi.setSystemTime(new Date("2026-11-06T20:31:00Z"));
    await cotHistoriqueStore.getState().charger();
    expect(appels).toHaveLength(4);
  });

  it("repart du cache local sans réseau après un rechargement de page", async () => {
    stubStorage();
    stubFetch(HISTORIQUE);
    await cotHistoriqueStore.getState().charger();
    reinitialiserCotHistorique(); // mémoire vidée, cache local conservé
    cotHistoriqueStore.setState({ serie: null, ts: null });
    const appels = stubFetch(HISTORIQUE);
    await cotHistoriqueStore.getState().charger();
    expect(appels).toHaveLength(0);
    expect(cotHistoriqueStore.getState().serie?.points).toHaveLength(2);
  });

  it("le rapport Disaggregated sert les matières premières", async () => {
    stubStorage();
    const recOr = {
      market_and_exchange_names: OR,
      report_date_as_yyyy_mm_dd: "2026-10-27T00:00:00.000",
      m_money_positions_long_all: "10",
      m_money_positions_short_all: "5",
    };
    const appels = stubFetch([recOr]);
    await cotHistoriqueStore.getState().selectionner(OR);
    expect(appels[0]).toContain("resource/72hh-3qpy.json");
    const s = cotHistoriqueStore.getState();
    expect(s.serie?.dataset).toBe("disaggregated");
    expect(s.serie?.disponibles).toEqual([false, false, true, false, false]);
  });

  it("marché absent du rapport : non couvert, explicite", async () => {
    stubStorage();
    stubFetch([], []);
    await cotHistoriqueStore.getState().charger();
    const s = cotHistoriqueStore.getState();
    expect(s.nonCouvert).toBe(true);
    expect(s.serie).toBeNull();
    expect(s.erreur).toBeNull();
  });

  it("aucune colonne de positions reconnue : erreur, rien d'inventé", async () => {
    stubStorage();
    const appels = stubFetch([], [{ market_and_exchange_names: SP, report_date_as_yyyy_mm_dd: "2026-10-27" }]);
    await cotHistoriqueStore.getState().charger();
    expect(appels).toHaveLength(1);
    expect(cotHistoriqueStore.getState().erreur).toBe(MESSAGE_COLONNES_INTROUVABLES);
    expect(cotHistoriqueStore.getState().serie).toBeNull();
  });

  it("échec réseau : la dernière série reste affichée avec un bandeau", async () => {
    stubStorage();
    stubFetch(HISTORIQUE);
    await cotHistoriqueStore.getState().charger();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await cotHistoriqueStore.getState().rafraichir();
    const s = cotHistoriqueStore.getState();
    expect(s.erreur).toBe("Historique COT (CFTC) indisponible. Dernières données conservées.");
    expect(s.serie?.points).toHaveLength(2);
  });

  it("une réponse tardive d'un autre marché n'écrase pas la sélection courante", async () => {
    stubStorage();
    let liberer: () => void = () => {};
    const bloque = new Promise<void>((r) => (liberer = r));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("gpe5-46if")) await bloque;
      const corps = url.includes("gpe5-46if") ? HISTORIQUE : [{
        market_and_exchange_names: OR, report_date_as_yyyy_mm_dd: "2026-10-27T00:00:00.000",
        m_money_positions_long_all: "10", m_money_positions_short_all: "5",
      }];
      return new Response(JSON.stringify(corps), { status: 200 });
    }));
    const premier = cotHistoriqueStore.getState().charger();
    await cotHistoriqueStore.getState().selectionner(OR);
    liberer();
    await premier;
    expect(cotHistoriqueStore.getState().marche).toBe(OR);
    expect(cotHistoriqueStore.getState().serie?.dataset).toBe("disaggregated");
    // La réponse tardive est gardée : revenir au S&P ne relit pas la CFTC.
    const appels = stubFetch(HISTORIQUE);
    await cotHistoriqueStore.getState().selectionner(SP);
    expect(appels).toHaveLength(0);
    expect(cotHistoriqueStore.getState().serie?.dataset).toBe("tff");
  });
});

describe("suivi hebdomadaire", () => {
  it("rapport attendu absent juste après l'heure prévue : nouvelle lecture 15 min plus tard", async () => {
    vi.setSystemTime(new Date("2026-11-06T20:40:00Z"));
    stubStorage();
    const desactiver = cotHistoriqueStore.getState().activerSuivi();
    stubFetch(HISTORIQUE); // Socrata pas encore à jour : dernier rapport toujours le 27 octobre
    await cotHistoriqueStore.getState().charger();
    const appels = stubFetch([...HISTORIQUE, recTff("2026-11-03", 1100)]);
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 31_000);
    expect(appels).toHaveLength(2);
    expect(cotHistoriqueStore.getState().serie?.points).toHaveLength(3);
    desactiver();
  });

  it("relit automatiquement à la publication suivante tant que le graphique est affiché", async () => {
    stubStorage();
    const appels = stubFetch(HISTORIQUE);
    const desactiver = cotHistoriqueStore.getState().activerSuivi();
    await cotHistoriqueStore.getState().charger();
    expect(appels).toHaveLength(2);

    stubFetch([...HISTORIQUE, recTff("2026-11-03", 1100)]);
    // Du samedi 31 octobre 12 h au vendredi 6 novembre 20 h 30 UTC (+ 30 s de marge).
    await vi.advanceTimersByTimeAsync(Date.parse("2026-11-06T20:31:00Z") - Date.now());
    expect(cotHistoriqueStore.getState().serie?.points).toHaveLength(3);
    desactiver();
  });

  it("sans graphique affiché, aucune minuterie ne tourne", async () => {
    stubStorage();
    stubFetch(HISTORIQUE);
    const desactiver = cotHistoriqueStore.getState().activerSuivi();
    await cotHistoriqueStore.getState().charger();
    desactiver();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("après un échec, nouvelle tentative 30 min plus tard", async () => {
    stubStorage();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const desactiver = cotHistoriqueStore.getState().activerSuivi();
    await cotHistoriqueStore.getState().charger();
    expect(cotHistoriqueStore.getState().erreur).not.toBeNull();
    const appels = stubFetch(HISTORIQUE);
    await vi.advanceTimersByTimeAsync(RELANCE_ERREUR_MS + 31_000);
    expect(appels).toHaveLength(2);
    expect(cotHistoriqueStore.getState().erreur).toBeNull();
    desactiver();
  });
});

describe("cache local borné", () => {
  const serie = (nom: string): SerieHistoriqueCot => ({
    dataset: "legacy",
    nom,
    disponibles: [true, true, true],
    points: Array.from({ length: 50 }, (_, i) => ({ t: i * 7 * 86_400_000 + 1, oi: 1000, longs: [1, 2, 3], shorts: [3, 2, 1] })),
  });

  it(`garde au plus ${MAX_ENTREES} séries, la moins récente évincée`, () => {
    const donnees = stubStorage();
    for (let i = 0; i <= MAX_ENTREES; i++) ecrireCacheHistorique(`k${i}`, { ts: 1, serie: serie(`m${i}`) });
    expect(donnees.has("k0")).toBe(false);
    expect(donnees.has(`k${MAX_ENTREES}`)).toBe(true);
    expect(JSON.parse(donnees.get(CLE_INDEX_HISTORIQUE)!)).toHaveLength(MAX_ENTREES);
  });

  it("quota plein : évince les plus anciennes au lieu d'échouer", () => {
    const taille = JSON.stringify({ ts: 1, serie: compacterSerie(serie("m")) }).length;
    const donnees = stubStorage(taille * 2.5);
    for (let i = 0; i < 4; i++) expect(() => ecrireCacheHistorique(`k${i}`, { ts: 1, serie: serie(`m${i}`) })).not.toThrow();
    expect(donnees.has("k3")).toBe(true);
    expect(donnees.has("k0")).toBe(false);
  });

  it("une entrée corrompue est ignorée", () => {
    const donnees = stubStorage();
    donnees.set("x", "{pas du json");
    donnees.set("y", JSON.stringify({ ts: 1, serie: { v: 999 } }));
    expect(lireCacheHistorique("x")).toBeNull();
    expect(lireCacheHistorique("y")).toBeNull();
  });
});
