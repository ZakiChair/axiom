/**
 * Tests du store NETLIQ — logique orchestration (le calcul pur est couvert par
 * data/netliq.test.ts). On mocke la seule collecte réseau `fetchSeriesNetliq` et on
 * garde `serieNetliq`/`statsNetliq` RÉELS : les jambes FRED fournies produisent une
 * vraie série. Couvre : succès, erreur non destructive, garde 200-vide, et cache
 * TTL 12 h (skip / force / expiration / premier run vide). La garde `currentRunId`
 * (run périmé) suit le patron cbprem : couverte par revue de code, pas par un test
 * unitaire (parité avec cbprem.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { netliqStore } from "./netliq";
import { fetchSeriesNetliq, type PointFred } from "../data/netliq";

// Mock de la seule fonction de collecte ; `serieNetliq`/`statsNetliq` restent réels.
vi.mock("../data/netliq", async (orig) => ({
  ...(await orig<typeof import("../data/netliq")>()),
  fetchSeriesNetliq: vi.fn(),
}));

const fetchMock = vi.mocked(fetchSeriesNetliq);

// Environnement de test Node (pas de DOM) : `localStorage` est absent par défaut. Même
// mock en mémoire que sosovalue.test.ts / persist.test.ts — indispensable ici car le store
// persiste la fenêtre (`axiom:netliq:fenetre`).
function installMockLocalStorage(): void {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
}

/** Raccourci de fabrication de PointFred. */
function pf(date: string, valeur: number): PointFred {
  return { date, valeur };
}

/** Trois jambes alignées produisant une série non vide (mêmes fixtures que data/netliq.test.ts). */
function jambesValides(): { walcl: PointFred[]; tga: PointFred[]; rrp: PointFred[] } {
  return {
    walcl: [pf("2026-01-07", 6000), pf("2026-01-14", 6100)],
    tga: [pf("2026-01-07", 900), pf("2026-01-14", 950)],
    rrp: [pf("2026-01-07", 100), pf("2026-01-08", 101), pf("2026-01-14", 108)],
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  // localStorage neuf à chaque test → repart du défaut 2 a, pas de fuite d'ordre.
  installMockLocalStorage();
});

afterEach(() => {
  // `fenetreAnnees` remis à 2 (défaut) en plus des champs de données, sinon un test qui
  // bascule la fenêtre fuite sur les suivants.
  netliqStore.setState({
    enCours: false,
    serie: [],
    stats: null,
    erreur: null,
    majTs: null,
    fenetreAnnees: 2,
  });
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("run() — succès", () => {
  it("pose serie/stats, efface erreur, horodate majTs", async () => {
    fetchMock.mockResolvedValue(jambesValides());
    await netliqStore.getState().run();

    const s = netliqStore.getState();
    expect(s.serie.length).toBeGreaterThan(0);
    expect(s.stats?.courant).toBe(5042); // 6100 − 950 − 108, dernier point
    expect(s.erreur).toBeNull();
    expect(s.majTs).not.toBeNull();
    expect(s.enCours).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("run() — erreur non destructive", () => {
  it("un fetch en échec conserve serie/stats/majTs et pose erreur", async () => {
    fetchMock.mockResolvedValueOnce(jambesValides());
    await netliqStore.getState().run();
    const { serie, stats, majTs } = netliqStore.getState();

    fetchMock.mockRejectedValueOnce(new Error("réseau"));
    await netliqStore.getState().run(true); // force pour contourner le TTL

    const apres = netliqStore.getState();
    expect(apres.serie).toBe(serie); // même référence, préservée
    expect(apres.stats).toBe(stats);
    expect(apres.majTs).toBe(majTs); // pas réhorodaté
    expect(apres.erreur).toBe("Séries FRED indisponibles — dernière liquidité nette conservée.");
    expect(apres.enCours).toBe(false);
  });
});

describe("run() — garde 200-vide", () => {
  it("un fetch réussi mais série vide ne remplace PAS une série valide", async () => {
    fetchMock.mockResolvedValueOnce(jambesValides());
    await netliqStore.getState().run();
    const { serie, stats, majTs } = netliqStore.getState();

    // Jambes désamorcées → serieNetliq renvoie [] (voir data/netliq.test.ts).
    fetchMock.mockResolvedValueOnce({ walcl: [], tga: [], rrp: [] });
    await netliqStore.getState().run(true);

    const apres = netliqStore.getState();
    expect(apres.serie).toBe(serie);
    expect(apres.stats).toBe(stats);
    expect(apres.majTs).toBe(majTs);
    expect(apres.erreur).toBe("Réponse FRED vide — courbe précédente conservée.");
    expect(apres.enCours).toBe(false);
  });
});

describe("run() — cache TTL 12 h", () => {
  it("skip : un run immédiat après un succès ne re-fetch pas", async () => {
    fetchMock.mockResolvedValue(jambesValides());
    await netliqStore.getState().run(); // majTs frais
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await netliqStore.getState().run(); // < 12 h + série non vide → skip
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("force : run(true) re-fetch même si le cache est frais", async () => {
    fetchMock.mockResolvedValue(jambesValides());
    await netliqStore.getState().run();
    await netliqStore.getState().run(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("expiration : un majTs de plus de 12 h re-déclenche le fetch", async () => {
    fetchMock.mockResolvedValue(jambesValides());
    await netliqStore.getState().run();
    // Vieillit artificiellement la fraîcheur au-delà du TTL.
    netliqStore.setState({ majTs: Date.now() - 13 * 60 * 60 * 1000 });

    await netliqStore.getState().run();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("premier run vide ne fige pas le cache (serie vide → pas de skip)", async () => {
    // Aucune série préexistante : la garde 200-vide ne s'applique pas, on passe par le
    // succès (serie vide). Le TTL skip exige `serie.length > 0` → le run suivant re-tente
    // malgré un majTs frais : c'est ce terme, pas la nullité de majTs, qui évite le gel 12 h.
    fetchMock.mockResolvedValue({ walcl: [], tga: [], rrp: [] });
    await netliqStore.getState().run();
    expect(netliqStore.getState().serie).toEqual([]);

    await netliqStore.getState().run();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("run() — fenêtre transmise à la collecte", () => {
  it("passe fenetreAnnees (défaut 2) à fetchSeriesNetliq", async () => {
    fetchMock.mockResolvedValue(jambesValides());
    await netliqStore.getState().run();
    expect(fetchMock).toHaveBeenLastCalledWith(expect.any(Number), 2);
  });
});

describe("setFenetre() — changement de fenêtre : invalidation + re-fetch forcé", () => {
  it("un run 2 a frais NE bloque PAS le fetch 10 a (skip TTL invalidé au changement)", async () => {
    fetchMock.mockResolvedValue(jambesValides());
    await netliqStore.getState().run(); // majTs frais, série 2 a affichée
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.any(Number), 2);

    // Bascule vers 10 a : setFenetre déclenche un run(true) fire-and-forget.
    netliqStore.getState().setFenetre(10);
    expect(netliqStore.getState().fenetreAnnees).toBe(10);

    // Le re-fetch DOIT survenir ET porter sur 10 a (preuve que la série 2 a fraîche n'a
    // pas été servie par le skip TTL). Le call-count seul ne le prouverait pas (force
    // re-fetch de toute façon) — c'est l'argument `10` qui est décisif.
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith(expect.any(Number), 10);
    });
  });

  it("re-sélectionner la fenêtre courante ne re-fetch pas", async () => {
    fetchMock.mockResolvedValue(jambesValides());
    await netliqStore.getState().run();
    netliqStore.getState().setFenetre(2); // déjà 2 a → no-op
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("persiste la fenêtre dans axiom:netliq:fenetre", async () => {
    // mock résolu pour que le run(true) déclenché par setFenetre s'achève proprement.
    fetchMock.mockResolvedValue(jambesValides());
    netliqStore.getState().setFenetre(5);
    expect(localStorage.getItem("axiom:netliq:fenetre")).toBe("5");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.any(Number), 5));
  });
});
