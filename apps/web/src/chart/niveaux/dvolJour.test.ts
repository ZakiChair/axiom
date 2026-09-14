/**
 * Tests du chargeur DVOL quotidien des bandes implicites (chart/niveaux/dvolJour.ts) : une
 * requête par jour UTC et par devise, promesses en vol dédoublonnées, échec non caché, série
 * sans la bougie de la veille servie mais NON cachée (sa clôture est l'IV de la bande du jour :
 * on la redemande au prochain essai), bougies non alignées sur 00:00 UTC refusées.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { JOURS_DVOL, _viderCacheDvolJour, chargerDvolJour, type PointDvol } from "./dvolJour";

const JOUR = 86_400_000;
const NOW = Date.UTC(2026, 8, 14, 18);

const SERIE: PointDvol[] = [
  { time: Date.UTC(2026, 8, 13), value: 38.89 },
  { time: Date.UTC(2026, 8, 14), value: 37.92 },
];

function fetcherFactice(reponse: () => Promise<PointDvol[]> = async () => SERIE) {
  const appels: { devise: string; jours: number }[] = [];
  return {
    appels,
    fetcher: (devise: "BTC" | "ETH", jours: number) => {
      appels.push({ devise, jours });
      return reponse();
    },
  };
}

beforeEach(() => {
  _viderCacheDvolJour();
});

describe("chargerDvolJour", () => {
  it("demande JOURS_DVOL jours quotidiens et met le succès en cache pour la journée", async () => {
    const f = fetcherFactice();
    const a = await chargerDvolJour("BTC", NOW, f.fetcher);
    const b = await chargerDvolJour("BTC", NOW + 3_600_000, f.fetcher);
    expect(a).toEqual(SERIE);
    expect(b).toBe(a);
    expect(f.appels).toEqual([{ devise: "BTC", jours: JOURS_DVOL }]);
    // La clôture du dimanche précédent (≤ 8 jours) doit toujours être couverte.
    expect(JOURS_DVOL).toBeGreaterThanOrEqual(9);
  });

  it("dédoublonne les requêtes en vol", async () => {
    const f = fetcherFactice();
    const [a, b] = await Promise.all([chargerDvolJour("BTC", NOW, f.fetcher), chargerDvolJour("BTC", NOW, f.fetcher)]);
    expect(a).toBe(b);
    expect(f.appels).toHaveLength(1);
  });

  it("nouveau jour UTC ou autre devise → nouvelle requête", async () => {
    const f = fetcherFactice(async () => [...SERIE, { time: Date.UTC(2026, 8, 15), value: 36 }]);
    await chargerDvolJour("BTC", NOW, f.fetcher);
    await chargerDvolJour("BTC", NOW + JOUR, f.fetcher);
    await chargerDvolJour("ETH", NOW + JOUR, f.fetcher);
    expect(f.appels).toHaveLength(3);
  });

  it("échec réseau → null, non caché (le prochain appel réessaie)", async () => {
    let echec = true;
    const f = fetcherFactice(async () => {
      if (echec) throw new Error("HTTP 503");
      return SERIE;
    });
    expect(await chargerDvolJour("BTC", NOW, f.fetcher)).toBeNull();
    echec = false;
    expect(await chargerDvolJour("BTC", NOW, f.fetcher)).toEqual(SERIE);
    expect(f.appels).toHaveLength(2);
  });

  it("série sans la bougie de la veille : servie mais non cachée (redemandée au prochain essai)", async () => {
    const f = fetcherFactice(async () => [{ time: Date.UTC(2026, 8, 12), value: 39.5 }]);
    expect(await chargerDvolJour("BTC", NOW, f.fetcher)).toEqual([{ time: Date.UTC(2026, 8, 12), value: 39.5 }]);
    await chargerDvolJour("BTC", NOW, f.fetcher);
    expect(f.appels).toHaveLength(2);
  });

  it("bougies non alignées sur 00:00 UTC ou réponse vide → null", async () => {
    const decalee = fetcherFactice(async () => SERIE.map((p) => ({ ...p, time: p.time + 3_600_000 })));
    expect(await chargerDvolJour("BTC", NOW, decalee.fetcher)).toBeNull();
    const vide = fetcherFactice(async () => []);
    expect(await chargerDvolJour("ETH", NOW, vide.fetcher)).toBeNull();
  });
});
