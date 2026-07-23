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
});

afterEach(() => {
  netliqStore.setState({ enCours: false, serie: [], stats: null, erreur: null, majTs: null });
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
