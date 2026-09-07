import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
function stockage(): Storage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k),
    clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const jour = () => new Date().toISOString().slice(0, 10);
describe("historiques on-chain : transport et cache", () => {
  beforeEach(() => { vi.resetModules(); vi.stubGlobal("localStorage", stockage()); });
  afterEach(() => vi.unstubAllGlobals());
  it("ETF utilise le GET documenté, la clé en en-tête et ne crée aucune séance", async () => {
    const { fetchEtfHistory, resumerEtfHistory } = await import("./etfHistory");
    const fetcher = vi.fn(async () => Response.json({ code: 0, data: [{ date: jour(), total_net_inflow: 20, total_net_assets: 1000 }] }));
    vi.stubGlobal("fetch", fetcher);
    const r = await fetchEtfHistory("eth", "test-personnelle");
    expect(fetcher).toHaveBeenCalledWith("/sosoapi/openapi/v1/etfs/summary-history?symbol=ETH&country_code=US&limit=300", expect.objectContaining({ headers: { "x-soso-api-key": "test-personnelle" } }));
    expect(r.points).toHaveLength(1);
    expect(resumerEtfHistory(r.points)).toMatchObject({ cumul5: null, cumul20: null, ratioJourPct: 2 });
    await fetchEtfHistory("eth", "test-personnelle");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("ETF 403 est explicite, non caché et récupérable après changement de clé", async () => {
    const { fetchEtfHistory } = await import("./etfHistory");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(Response.json([{ date: jour(), total_net_inflow: 0, total_net_assets: 10 }]));
    vi.stubGlobal("fetch", fetcher);
    expect((await fetchEtfHistory("btc", "ancienne")).raison).toContain("Clé SoSoValue");
    expect((await fetchEtfHistory("btc", "nouvelle")).points[0]?.fluxUsd).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("ETF annulé pendant le parsing n'inscrit pas un succès en cache", async () => {
    const { fetchEtfHistory } = await import("./etfHistory");
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => {
      ctrl.abort(); return [{ date: jour(), total_net_inflow: 2, total_net_assets: 100 }];
    } })));
    const r = await fetchEtfHistory("btc", "personnelle", ctrl.signal);
    expect(r.points).toEqual([]);
    expect(localStorage.getItem("axiom:onchain:etf:history-v1:btc")).toBeNull();
  });
  it("ValidatorQueue annulé pendant la dernière lecture n'inscrit pas un succès en cache", async () => {
    const { fetchEthStaking } = await import("./ethStaking");
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode(JSON.stringify([{ date: jour(), entry_queue: 1, exit_queue: 0, entry_wait: 1, exit_wait: 0, staked_amount: 400, staked_percent: 30 }])));
      c.close(); ctrl.abort();
    } }))));
    expect(await fetchEthStaking(ctrl.signal)).toBeNull();
    expect(localStorage.getItem("axiom:onchain:eth:validatorqueue:v1")).toBeNull();
  });
  it("ValidatorQueue emploie sa source fixe puis conserve un cache daté sur panne", async () => {
    const { fetchEthStaking, ETH_STAKING_SOURCE } = await import("./ethStaking");
    const row = { date: jour(), entry_queue: 100, exit_queue: 20, entry_wait: 1, exit_wait: 0.2, staked_amount: 400, staked_percent: 30 };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json([row])).mockRejectedValueOnce(new Error("réseau absent"));
    vi.stubGlobal("fetch", fetcher);
    const a = await fetchEthStaking();
    expect(a?.points[0]?.entreeEth).toBe(100);
    expect(fetcher).toHaveBeenCalledWith(ETH_STAKING_SOURCE, expect.anything());
    const key = "axiom:onchain:eth:validatorqueue:v1";
    localStorage.setItem(key, JSON.stringify({ donnee: a!.points, ts: Date.now() - 7 * 3600_000 }));
    const b = await fetchEthStaking();
    expect(b?.perime).toBe(true);
    expect(b?.raison).toContain("réseau absent");
    expect(b?.points).toEqual(a?.points);
  });
  it("ValidatorQueue interrompt un flux dépassant 2 MiB avant de lire la suite", async () => {
    const { fetchEthStaking } = await import("./ethStaking");
    const cancel = vi.fn(); let lectures = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      pull(c) { lectures++; c.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); if (lectures > 3) c.close(); }, cancel,
    }, { highWaterMark: 0 }))));
    expect(await fetchEthStaking()).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(lectures).toBe(1);
  });
});
