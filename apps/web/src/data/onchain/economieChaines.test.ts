import { describe, expect, it, vi } from "vitest";
import {
  chargerEconomieChaines,
  parseHistoriqueStablecoinChaine,
  parseSerieDefiLlama,
  partsADateCommune,
  resumerSerie,
  _viderCacheEconomieChaines,
} from "./economieChaines";

describe("économie comparée des chaînes", () => {
  it("lit la valorisation USD stablecoin sans sommer les quantités natives", () => {
    expect(parseHistoriqueStablecoinChaine([
      {
        date: "1788739200",
        totalCirculating: { peggedUSD: 2, peggedJPY: 9_000_000 },
        totalCirculatingUSD: { peggedUSD: 2, peggedJPY: 55 },
      },
      { date: "date-invalide", totalCirculatingUSD: { peggedUSD: 99 } },
    ])).toEqual([{ time: 1_788_739_200_000, value: 57 }]);
    expect(parseHistoriqueStablecoinChaine([
      { date: "1788739200", totalCirculatingUSD: { peggedUSD: null, peggedEUR: 0 } },
      { date: "1788825600", totalCirculatingUSD: { peggedUSD: -1 } },
    ])).toEqual([]);
    expect(parseHistoriqueStablecoinChaine([
      { date: "1788739200", totalCirculatingUSD: { peggedUSD: 0, peggedEUR: 0 } },
    ])).toEqual([{ time: 1_788_739_200_000, value: 0 }]);
  });

  it("préserve les dates réelles, déduplique et calcule 30/90/365 jours sans zéro inventé", () => {
    const jour = 86_400_000;
    const fin = Date.UTC(2026, 8, 9);
    const serie = parseSerieDefiLlama([
      [(fin - 365 * jour) / 1000, 50],
      [(fin - 90 * jour) / 1000, 80],
      [(fin - 30 * jour) / 1000, 100],
      [fin / 1000, 120],
      [fin / 1000, 125],
      [(fin + jour) / 1000, null],
    ]);
    expect(serie.at(-1)).toEqual({ time: fin, value: 125 });
    expect(resumerSerie(serie, fin)).toEqual({
      niveau: 125,
      observeLe: fin,
      variation30jPct: 25,
      variation90jPct: 56.25,
      variation365jPct: 150,
    });
    expect(resumerSerie([{ time: fin, value: 0 }], fin).variation30jPct).toBeNull();
    expect(resumerSerie([{ time: fin - 31 * jour, value: 100 }, { time: fin, value: 120 }], fin).variation30jPct).toBeNull();
  });

  it("calcule les parts uniquement à une date réellement commune", () => {
    const source = (points: Array<{ time: number; value: number }>) => ({
      disponible: true, perime: false, serie: points, resume: resumerSerie(points, 3), source: "x", recupereLe: 3,
    });
    const chaines = [
      { id: "ethereum", libelle: "Ethereum", tvl: source([{ time: 1, value: 60 }, { time: 3, value: 90 }]) },
      { id: "solana", libelle: "Solana", tvl: source([{ time: 1, value: 40 }, { time: 2, value: 80 }]) },
    ];
    expect(partsADateCommune(chaines, "tvl")).toEqual({
      date: 1,
      couverture: { disponibles: 2, attendus: 2 },
      parts: [
        { id: "ethereum", valeur: 60, partPct: 60 },
        { id: "solana", valeur: 40, partPct: 40 },
      ],
    });
    chaines[1]!.tvl.perime = true;
    expect(partsADateCommune(chaines, "tvl")?.couverture).toEqual({ disponibles: 1, attendus: 2 });
  });

  it("borne à trois les appels concurrents et publie les erreurs par série", async () => {
    _viderCacheEconomieChaines();
    let actifs = 0;
    let maximum = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      actifs += 1;
      maximum = Math.max(maximum, actifs);
      await Promise.resolve();
      actifs -= 1;
      const url = String(input);
      if (url.includes("dailyRevenue") && url.includes("Base")) {
        return new Response("panne", { status: 503 });
      }
      if (url.includes("stablecoincharts")) {
        return new Response(JSON.stringify([{ date: "1788739200", totalCirculatingUSD: { peggedUSD: 42 } }]));
      }
      if (url.includes("historicalChainTvl")) {
        return new Response(JSON.stringify([{ date: 1_788_739_200, tvl: 100 }]));
      }
      return new Response(JSON.stringify({ totalDataChart: [[1_788_739_200, 10]] }));
    });

    const resultat = await chargerEconomieChaines({ fetcher, now: () => Date.UTC(2026, 8, 9) });

    expect(maximum).toBe(3);
    expect(resultat.chaines).toHaveLength(4);
    expect(resultat.chaines.find((c) => c.id === "base")?.revenus.disponible).toBe(false);
    expect(resultat.chaines.find((c) => c.id === "base")?.frais.disponible).toBe(true);
    expect(resultat.chaines.find((c) => c.id === "ethereum")?.stablecoins.serie.at(-1)?.value).toBe(42);
  });

  it("réutilise le cache une heure et étiquette le dernier cache lors d'une panne ultérieure", async () => {
    _viderCacheEconomieChaines();
    let maintenant = Date.UTC(2026, 8, 9);
    let panne = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (panne) return new Response("panne", { status: 503 });
      const url = String(input);
      if (url.includes("stablecoincharts")) return new Response(JSON.stringify([{ date: String(maintenant / 1000), totalCirculatingUSD: { peggedUSD: 42 } }]));
      if (url.includes("historicalChainTvl")) return new Response(JSON.stringify([{ date: maintenant / 1000, tvl: 100 }]));
      return new Response(JSON.stringify({ totalDataChart: [[maintenant / 1000, 10]] }));
    });
    await chargerEconomieChaines({ fetcher, now: () => maintenant });
    await chargerEconomieChaines({ fetcher, now: () => maintenant + 30 * 60_000 });
    expect(fetcher).toHaveBeenCalledTimes(20);

    panne = true;
    maintenant += 2 * 3_600_000;
    const repli = await chargerEconomieChaines({ fetcher, now: () => maintenant });
    expect(fetcher).toHaveBeenCalledTimes(40);
    expect(repli.chaines[0]?.tvl).toMatchObject({ disponible: true, perime: true, raison: "Cache périmé · HTTP 503" });
    expect(repli.chaines[0]?.tvl.resume.niveau).toBe(100);
  });

  it("marque périmé un endpoint réussi dont la dernière observation est vieille", async () => {
    _viderCacheEconomieChaines();
    const now = Date.UTC(2026, 8, 9);
    const ancien = now - 180 * 86_400_000;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("stablecoincharts")) return new Response(JSON.stringify([{ date: String(ancien / 1000), totalCirculatingUSD: { peggedUSD: 42 } }]));
      if (url.includes("historicalChainTvl")) return new Response(JSON.stringify([{ date: ancien / 1000, tvl: 100 }]));
      return new Response(JSON.stringify({ totalDataChart: [[ancien / 1000, 10]] }));
    });
    const resultat = await chargerEconomieChaines({ fetcher, now: () => now });
    expect(resultat.chaines[0]?.tvl).toMatchObject({ disponible: true, perime: true, raison: "Dernière observation trop ancienne" });
  });

  it("borne une requête qui ne répond pas sans bloquer les autres séries", async () => {
    _viderCacheEconomieChaines();
    const now = Date.UTC(2026, 8, 9);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("dailyRevenue") && url.includes("Base")) {
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
      }
      if (url.includes("stablecoincharts")) return new Response(JSON.stringify([{ date: String(now / 1000), totalCirculatingUSD: { peggedUSD: 42 } }]));
      if (url.includes("historicalChainTvl")) return new Response(JSON.stringify([{ date: now / 1000, tvl: 100 }]));
      return new Response(JSON.stringify({ totalDataChart: [[now / 1000, 10]] }));
    });
    const resultat = await chargerEconomieChaines({ fetcher, now: () => now, timeoutMs: 5 });
    expect(resultat.chaines.find((chaine) => chaine.id === "base")?.revenus)
      .toMatchObject({ disponible: false, raison: "délai dépassé (5 ms)" });
    expect(resultat.chaines.find((chaine) => chaine.id === "base")?.frais.disponible).toBe(true);
  });
});
