import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReseauEth, fetchReseauEthAvecMeta, parseEthSupply, parseGasOracle, parseNodeCount } from "./etherscan";

describe("parseEthSupply", () => {
  it("convertit les wei en ETH", () => {
    expect(parseEthSupply({ status: "1", result: "120000000000000000000000000" })).toBeCloseTo(120_000_000, 0);
  });
  it("null sur échec", () => {
    expect(parseEthSupply({ status: "0" })).toBeNull();
  });
});

describe("parseGasOracle", () => {
  it("parse les 3 niveaux de gas", () => {
    const json = { status: "1", result: { SafeGasPrice: "10", ProposeGasPrice: "12", FastGasPrice: "15" } };
    expect(parseGasOracle(json)).toEqual({ safe: 10, propose: 12, fast: 15 });
  });
  it("null sur échec", () => {
    expect(parseGasOracle({ status: "0" })).toBeNull();
  });
});

describe("parseNodeCount", () => {
  it("parse le nombre de nœuds", () => {
    expect(parseNodeCount({ status: "1", result: { TotalNodeCount: "8500" } })).toBe(8500);
  });
  it("null sur forme inconnue", () => {
    expect(parseNodeCount({})).toBeNull();
  });
});

// Environnement Node sans localStorage → le cache on-chain no-ope (best-effort),
// chaque appel part donc réellement sur le fetch mocké.
describe("fetchReseauEth (fetch mocké)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(corps: unknown): ReturnType<typeof vi.fn> {
    const mock = vi.fn(async () => ({ ok: true, json: async () => corps }));
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  it("clé fournie → apikey en query ; sans clé → aucun apikey (le proxy injecte le repli)", async () => {
    const mock = stubFetch({ status: "1", result: { SafeGasPrice: "1", ProposeGasPrice: "2", FastGasPrice: "3" } });
    await fetchReseauEth("MACLE");
    const urlsAvec = mock.mock.calls.map((c) => String(c[0]));
    expect(urlsAvec.every((u) => u.startsWith("/ethscanapi/v2/api?chainid=1"))).toBe(true);
    expect(urlsAvec.every((u) => u.includes("apikey=MACLE"))).toBe(true);

    mock.mockClear();
    await fetchReseauEth(null);
    const urlsSans = mock.mock.calls.map((c) => String(c[0]));
    expect(urlsSans.length).toBe(3); // plus de court-circuit sans clé
    expect(urlsSans.every((u) => !u.includes("apikey="))).toBe(true);
  });

  it("réponse entièrement dégradée (status 0 partout) → null, pour que l'UI affiche « indisponible »", async () => {
    stubFetch({ status: "0", message: "NOTOK", result: "Invalid API Key" });
    expect(await fetchReseauEth("CLEINVALIDE")).toBeNull();
  });

  it("réponse partielle (gas seul) → objet partiel, jamais null", async () => {
    const mock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("gasoracle")
          ? { status: "1", result: { SafeGasPrice: "1", ProposeGasPrice: "2", FastGasPrice: "3" } }
          : { status: "0", message: "NOTOK", result: "Missing/Invalid API Key" },
    }));
    vi.stubGlobal("fetch", mock);
    const r = await fetchReseauEth(null);
    expect(r).not.toBeNull();
    expect(r?.gasFast).toBe(3);
    expect(r?.supplyEth).toBeNull();
    expect(r?.nodeCount).toBeNull();
  });

  it("ressert un cache périmé sans réinventer acquisition/observation et expose le motif", async () => {
    const t0 = Date.UTC(2020, 0, 1);
    const maintenant = Date.UTC(2026, 8, 9);
    const cache = { donnee: { supplyEth: 120_000_000, nodeCount: 8_500, gasSafe: 1, gasPropose: 2, gasFast: 3 }, ts: t0 };
    const stockage = new Map([["axiom:onchain:eth:reseau", JSON.stringify(cache)]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stockage.get(k) ?? null,
      setItem: (k: string, v: string) => void stockage.set(k, v),
      removeItem: (k: string) => void stockage.delete(k), clear: () => stockage.clear(),
      key: () => null, get length() { return stockage.size; },
    });
    vi.spyOn(Date, "now").mockReturnValue(maintenant);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("hors ligne"); }));
    const resultat = await fetchReseauEthAvecMeta("CLE");
    expect(resultat?.donnee.supplyEth).toBe(120_000_000);
    expect(resultat?.perime).toBe(true);
    expect(resultat?.recupereLe).toBe(t0);
    expect(resultat?.observeLe).toBeNull();
    expect(resultat?.sourceEffective).toBe("cache Etherscan");
    expect(resultat?.raison).toContain("hors ligne");
    vi.restoreAllMocks();
  });
});
