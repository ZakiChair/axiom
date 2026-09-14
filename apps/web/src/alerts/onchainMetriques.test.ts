/**
 * Alertes on-chain : ne charge que les métriques requises, mappe les dernières valeurs,
 * omet les indisponibles (jamais 0), calcule le hashprice depuis les deux séries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const bg = vi.fn();
const thermocap = vi.fn();
const hashrate = vi.fn();
const revenus = vi.fn();
const mempool = vi.fn();

vi.mock("../data/onchain/bgeometrics", () => ({
  BG_MVRV: { id: "mvrv" },
  BG_SOPR: { id: "sopr" },
  BG_NUPL: { id: "nupl" },
  fetchBgeometricMetrique: (def: { id: string }, cle: string | null) => bg(def.id, cle),
}));
vi.mock("../data/onchain/thermocap", () => ({ fetchThermocap: () => thermocap() }));
vi.mock("../data/onchain/mempool", () => ({
  fetchHashrate: () => hashrate(),
  fetchMempoolReseau: () => mempool(),
}));
vi.mock("../data/onchain/mineurs", async (importOriginal) => {
  const original = await importOriginal<typeof import("../data/onchain/mineurs")>();
  return { ...original, fetchRevenusMineurs: () => revenus() };
});
vi.mock("../store/onchain", () => ({ getBgeometricsKey: () => "cle-perso" }));

import { chargerMetriquesOnchain } from "./onchainMetriques";

const JOUR = 86_400_000;

describe("chargerMetriquesOnchain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bg.mockResolvedValue({ serie: { points: [], dernier: { time: 1, value: 2.5 } }, ts: 1, perime: false });
    thermocap.mockResolvedValue({ donnee: { points: [], dernier: { time: 1, value: 16.5 } }, ts: 1, perime: false });
    hashrate.mockResolvedValue({ donnee: { points: [{ time: 3 * JOUR, value: 1000e18 }] }, ts: 1, perime: false });
    revenus.mockResolvedValue({ donnee: [{ time: 3 * JOUR, value: 40e6 }], ts: 1, perime: false });
    mempool.mockResolvedValue({ donnee: { fees: { fastestFee: 12 } }, ts: 1, perime: false });
  });

  it("ne charge que les métriques requises et passe la clé BGeometrics personnelle", async () => {
    const v = await chargerMetriquesOnchain(new Set(["mvrv-z", "frais-sat-vb"]));
    expect(v).toEqual({ "mvrv-z": 2.5, "frais-sat-vb": 12 });
    expect(bg).toHaveBeenCalledTimes(1);
    expect(bg).toHaveBeenCalledWith("mvrv", "cle-perso");
    expect(thermocap).not.toHaveBeenCalled();
    expect(hashrate).not.toHaveBeenCalled();
  });

  it("hashprice = revenus ÷ hashrate du même jour (40 M$ / 1 000 000 PH/s = 40 $/PH/j)", async () => {
    const v = await chargerMetriquesOnchain(new Set(["hashprice", "thermocap"]));
    expect(v).toEqual({ hashprice: 40, thermocap: 16.5 });
  });

  it("une source indisponible ou en échec laisse sa métrique ABSENTE (jamais 0)", async () => {
    bg.mockResolvedValue(null);
    revenus.mockRejectedValue(new Error("réseau"));
    const v = await chargerMetriquesOnchain(new Set(["sopr", "nupl", "hashprice", "frais-sat-vb"]));
    expect(v).toEqual({ "frais-sat-vb": 12 });
  });
});
