import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/deployment", () => ({ IS_VERCEL: true }));
import { serverCredentialsStore } from "../store/serverCredentials";
import { fetchHistoriqueCcData, historiqueCcDataDisponible } from "./ccdataMcap";
import { chargerDefillamaPro } from "./onchain/defillamaPro";
import { chargerProfilFinnhub } from "./fund/finnhub";
import { sosoUnusableWithoutKey } from "./onchain/etf";
import { hasUsableCoinalyzeKey } from "../store/coinalyze";
import { hasUsableFredKey } from "../store/macro";
import { finnhubKeyStore } from "../store/finnhub";
import { fetchActiviteDex } from "./onchain/volumeDex";
import { withDemoKey, CG_BASE } from "./marketOverview";

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) });
  serverCredentialsStore.setState({ providers: {} });
});
afterEach(() => { serverCredentialsStore.setState({ providers: {} }); vi.unstubAllGlobals(); });

describe("clients avec accès serveur", () => {
  it("ouvre les gates FRED, Coinalyze et SoSoValue sans inventer une clé", () => {
    expect(hasUsableFredKey(null, true)).toBe(false);
    expect(hasUsableCoinalyzeKey(null, true)).toBe(false);
    expect(sosoUnusableWithoutKey(true, null)).toBe(true);
    serverCredentialsStore.setState({ providers: { fred: true, coinalyze: true, sosovalue: true } });
    expect(hasUsableFredKey(null, true)).toBe(true);
    expect(hasUsableCoinalyzeKey(null, true)).toBe(true);
    expect(sosoUnusableWithoutKey(true, null)).toBe(false);
  });

  it("CCData envoie la requête sans Authorization fictive, puis conserve l'override", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ Data: [] })));
    serverCredentialsStore.setState({ providers: { ccdata: true } });
    expect(historiqueCcDataDisponible()).toBe(true);
    await fetchHistoriqueCcData(null, { fetcher });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
    await fetchHistoriqueCcData("personnelle", { fetcher });
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Apikey personnelle");
  });

  it("DefiLlama serveur fonctionne sans clé locale et laisse l'override prioritaire", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json([])));
    vi.stubGlobal("fetch", fetcher);
    await expect(chargerDefillamaPro("emissions")).rejects.toThrow("Clé");
    serverCredentialsStore.setState({ providers: { defillama: true } });
    await chargerDefillamaPro("emissions");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("x-defillama-pro-key")).toBe(false);
    localStorage.setItem("axiom.defillama.proApiKey", "personnelle");
    await chargerDefillamaPro("emissions");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("x-defillama-pro-key")).toBe("personnelle");
  });

  it("Finnhub appelle le proxy sans jeton et encode la clé personnelle", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({})));
    vi.stubGlobal("fetch", fetcher);
    await chargerProfilFinnhub("AAPL", null);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/finnhubapi/stock/profile2?symbol=AAPL");
    await chargerProfilFinnhub("MSFT", "perso&test");
    expect(fetcher.mock.calls[1]?.[0]).toContain("token=perso%26test");
    const version = finnhubKeyStore.getState().version;
    finnhubKeyStore.getState().setKey("a");
    finnhubKeyStore.getState().setKey("b");
    expect(finnhubKeyStore.getState().version).toBe(version + 2);
  });

  it("CoinGecko utilise le proxy et l'override aussi dans la mesure DEX", async () => {
    expect(CG_BASE).toBe("/coingeckoapi");
    expect(withDemoKey(`${CG_BASE}/global`)).toBe("/coingeckoapi/global");
    localStorage.setItem("axiom.coingecko.demoApiKey", "personnelle");
    const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json(url.includes("overview/dexs") ? { total24h: 1, totalDataChart: [] } : { data: { total_volume: { usd: 10 } } })));
    vi.stubGlobal("fetch", fetcher);
    await fetchActiviteDex();
    expect(fetcher.mock.calls.some(call => call[0] === "/coingeckoapi/global?x_cg_demo_api_key=personnelle")).toBe(true);
  });
});
