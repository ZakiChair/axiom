/**
 * Mineurs BTC — Hash Ribbons (SMA courte/longue du hashrate) et hashprice.
 * Fixtures calculées à la main ; fenêtres réduites (2/3) pour lire les croisements.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PointMetrique } from "./coinmetrics";
import { calculerHashRibbons, calculerHashprice, moyenneMobile } from "./mineurs";

const JOUR = 86_400_000;
const serie = (valeurs: number[], debut = 0): PointMetrique[] =>
  valeurs.map((value, i) => ({ time: (debut + i) * JOUR, value }));

describe("moyenneMobile", () => {
  it("moyenne simple glissante, alignée sur la fin de fenêtre", () => {
    expect(moyenneMobile(serie([1, 2, 3, 4, 5]), 3)).toEqual([
      { time: 2 * JOUR, value: 2 },
      { time: 3 * JOUR, value: 3 },
      { time: 4 * JOUR, value: 4 },
    ]);
  });

  it("série plus courte que la fenêtre : vide", () => {
    expect(moyenneMobile(serie([1, 2]), 3)).toEqual([]);
  });
});

describe("calculerHashRibbons", () => {
  // Hashrate : plateau 10, chute à 4 (capitulation), retour à 10 (reprise).
  const chute = [10, 10, 10, 4, 4, 4, 10, 10];

  it("capitulation quand la SMA courte passe sous la longue", () => {
    const r = calculerHashRibbons(serie(chute.slice(0, 5)), 2, 3);
    // SMA2 = [10,10,7,4] (idx1..4), SMA3 = [10,8,6] (idx2..4) → idx3 : 7 < 8.
    expect(r.etat).toBe("capitulation");
    expect(r.croisement).toEqual({ time: 3 * JOUR, sens: "baissier" });
    expect(r.courte.at(-1)).toEqual({ time: 4 * JOUR, value: 4 });
    expect(r.longue.at(-1)).toEqual({ time: 4 * JOUR, value: 6 });
  });

  it("reprise quand la SMA courte repasse au-dessus après une capitulation", () => {
    const r = calculerHashRibbons(serie(chute), 2, 3);
    // idx5 : SMA2 = 4, SMA3 = 4 → égalité = fin de la capitulation (croisement haussier).
    expect(r.etat).toBe("reprise");
    expect(r.croisement).toEqual({ time: 5 * JOUR, sens: "haussier" });
  });

  it("expansion sans aucun croisement (hashrate stable)", () => {
    const r = calculerHashRibbons(serie(Array(10).fill(7)), 2, 3);
    expect(r.etat).toBe("expansion");
    expect(r.croisement).toBeNull();
  });

  it("reprise ancienne (> 30 jours) redevient expansion", () => {
    const valeurs = [...chute, ...Array(40).fill(10)];
    const r = calculerHashRibbons(serie(valeurs), 2, 3);
    expect(r.croisement?.sens).toBe("haussier");
    expect(r.etat).toBe("expansion");
  });

  it("série trop courte : état null, rubans vides", () => {
    const r = calculerHashRibbons(serie([1, 2]), 30, 60);
    expect(r.etat).toBeNull();
    expect(r.courte).toEqual([]);
    expect(r.longue).toEqual([]);
  });
});

describe("calculerHashprice", () => {
  it("USD par PH/s et par jour, jointure par jour UTC, jours orphelins ignorés", () => {
    // 40 M$ / (800 EH/s = 800 000 PH/s) = 50 $/PH/j ; 60 M$ / 1 000 000 PH/s = 60 $/PH/j.
    const revenus = serie([40e6, 60e6], 1);
    const hashrate = serie([800e18, 1000e18, 900e18], 1);
    const hp = calculerHashprice(revenus, hashrate);
    expect(hp.points).toEqual([
      { time: 1 * JOUR, value: 50 },
      { time: 2 * JOUR, value: 60 },
    ]);
    expect(hp.dernier).toEqual({ time: 2 * JOUR, value: 60 });
  });

  it("horodatages intra-journée rattachés au même jour UTC", () => {
    const revenus = [{ time: 5 * JOUR, value: 10e6 }];
    const hashrate = [{ time: 5 * JOUR + 3_600_000, value: 100e18 }];
    expect(calculerHashprice(revenus, hashrate).points).toEqual([{ time: 5 * JOUR, value: 100 }]);
  });

  it("hashrate nul ou négatif ignoré", () => {
    const revenus = serie([10e6, 10e6]);
    const hashrate = serie([0, -1]);
    expect(calculerHashprice(revenus, hashrate).points).toEqual([]);
  });
});

function stockage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("fetchRevenusMineurs : transport et cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lit blockchain.info en direct avec cors=true, puis ressert le cache 6 h", async () => {
    const { fetchRevenusMineurs } = await import("./mineurs");
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ status: "ok", values: [{ x: 86_400, y: 41_850_977.38 }] }),
    );
    vi.stubGlobal("fetch", fetcher);
    const r = await fetchRevenusMineurs();
    expect(r?.perime).toBe(false);
    expect(r?.donnee).toEqual([{ time: 86_400_000, value: 41_850_977.38 }]);
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url).toContain("https://api.blockchain.info/charts/miners-revenue?");
    expect(url).toContain("cors=true");
    await fetchRevenusMineurs();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("échec réseau : ressert le cache étiqueté périmé, sinon null", async () => {
    const { fetchRevenusMineurs } = await import("./mineurs");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    expect(await fetchRevenusMineurs()).toBeNull();
    localStorage.setItem(
      "axiom:onchain:bc:miners-revenue",
      JSON.stringify({ donnee: [{ time: 1, value: 2 }], ts: 0 }),
    );
    const r = await fetchRevenusMineurs();
    expect(r?.perime).toBe(true);
    expect(r?.donnee).toEqual([{ time: 1, value: 2 }]);
  });
});
