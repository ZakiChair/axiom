import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import { chargerAuCreneau, chargerAvecRepli } from "./routageMarche";
const identities = [
  { exchange: "binance" as const, symbol: "BTCUSDT", timeframe: "1h" as const },
  { exchange: "kraken" as const, symbol: "BTCUSDT", timeframe: "1h" as const },
];
const candle: Candle = { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };

describe("backfill automatique borné", () => {
  it("remplace intégralement une source en erreur ou vide par le candidat suivant", async () => {
    for (const mode of ["error", "empty"]) {
      const result = await chargerAvecRepli(identities, async (identity) => {
        if (identity.exchange === "binance") { if (mode === "error") throw new Error("451"); return []; }
        return [candle];
      }, () => false);
      expect(result).toEqual({ identity: identities[1], candles: [candle] });
    }
  });
  it("arrête après chaque candidat une seule fois quand toutes les places échouent", async () => {
    const visited: string[] = [];
    await expect(chargerAvecRepli(identities, async (identity) => { visited.push(identity.exchange); throw new Error("KO"); }, () => false))
      .rejects.toThrow("binance, kraken");
    expect(visited).toEqual(["binance", "kraken"]);
  });
  it("un changement d'identité pendant le réseau interdit publication et prochain essai", async () => {
    let cancelled = false;
    const visited: string[] = [];
    const result = await chargerAvecRepli(identities, async (identity) => { visited.push(identity.exchange); cancelled = true; throw new Error("KO"); }, () => cancelled);
    expect(result).toBeNull();
    expect(visited).toEqual(["binance"]);
  });
});

describe("repli progressif : essais immédiats puis liste complète", () => {
  const binance = identities[0]!;
  const kraken = identities[1]!;
  const okx = { exchange: "okx" as const, symbol: "BTCUSDT", timeframe: "1h" as const };

  it("un immédiat réussi ne demande jamais la liste complète", async () => {
    const complets = vi.fn(async () => [binance, kraken]);
    expect(await chargerAvecRepli({ immediats: [binance], complets }, async () => [candle], () => false))
      .toEqual({ identity: binance, candles: [candle] });
    expect(complets).not.toHaveBeenCalled();
  });
  it("après l'échec des immédiats, essaie le reste de la liste complète sans réessayer une identité", async () => {
    const visited: string[] = [];
    const result = await chargerAvecRepli({ immediats: [binance], complets: async () => [binance, kraken, okx] }, async (identity) => {
      visited.push(identity.exchange);
      if (identity.exchange !== "okx") throw new Error("KO");
      return [candle];
    }, () => false);
    expect(result).toEqual({ identity: okx, candles: [candle] });
    expect(visited).toEqual(["binance", "kraken", "okx"]);
  });
  it("sans immédiat, la liste complète est parcourue dans l'ordre", async () => {
    const visited: string[] = [];
    await chargerAvecRepli({ immediats: [], complets: async () => [kraken, okx] }, async (identity) => { visited.push(identity.exchange); return [candle]; }, () => false);
    expect(visited).toEqual(["kraken"]);
  });
  it("mêmes messages : liste des places essayées, erreur d'origine pour un candidat unique, actif introuvable", async () => {
    await expect(chargerAvecRepli({ immediats: [binance], complets: async () => [binance, kraken] }, async () => { throw new Error("KO"); }, () => false))
      .rejects.toThrow("Aucune source compatible ne fournit cet historique (binance, kraken).");
    await expect(chargerAvecRepli({ immediats: [binance], complets: async () => [binance] }, async () => { throw new Error("Twelve Data: clé requise"); }, () => false))
      .rejects.toThrow("Twelve Data: clé requise");
    await expect(chargerAvecRepli({ immediats: [], complets: async () => [] }, async () => [candle], () => false))
      .rejects.toThrow("Actif indisponible dans les catalogues chargés");
  });
  it("une annulation pendant l'attente de la liste complète interdit tout essai suivant", async () => {
    let cancelled = false;
    const visited: string[] = [];
    const result = await chargerAvecRepli({
      immediats: [binance],
      complets: async () => { cancelled = true; return [binance, kraken]; },
    }, async (identity) => { visited.push(identity.exchange); throw new Error("KO"); }, () => cancelled);
    expect(result).toBeNull();
    expect(visited).toEqual(["binance"]);
    const complets = vi.fn(async () => [kraken]);
    let stop = false;
    expect(await chargerAvecRepli({ immediats: [binance], complets }, async () => { stop = true; throw new Error("KO"); }, () => stop)).toBeNull();
    expect(complets).not.toHaveBeenCalled();
  });
});

describe("backfill Twelve Data : chien de garde armé à l'obtention du créneau", () => {
  const serie = { status: "ok", values: [{ datetime: "2026-01-02", open: "1", high: "2", low: "0.5", close: "1.5", volume: "10" }] };
  let envois: Array<{ url: string; signal: AbortSignal | undefined }>;
  let delaiReponse: number | null;
  /** Même contrat que `avecDelai` de ChartInstance (réimplanté : module sans DOM). */
  const garder = <T,>(travail: Promise<T>) => {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const garde = new Promise<never>((_resolve, reject) => { handle = setTimeout(() => reject(new Error("Backfill : délai dépassé")), 20_000); });
    const annuler = () => clearTimeout(handle);
    return { promesse: Promise.race([travail, garde]).finally(annuler), annuler };
  };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-07-01T12:00:00Z"));
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    envois = [];
    delaiReponse = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      envois.push({ url: String(input), signal: init?.signal ?? undefined });
      const reponse = { status: 200, statusText: "OK", json: async () => serie };
      if (delaiReponse === null) return new Promise(() => {});
      if (delaiReponse === 0) return Promise.resolve(reponse);
      return new Promise((resolve) => setTimeout(() => resolve(reponse), delaiReponse!));
    }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function preparer() {
    const td = await import("../data/twelvedata");
    await Promise.all(Array.from({ length: 8 }, (_, i) => td.fetchKlinesTwelveData(`PLEIN${i}`, "1d")));
    const backfill = (symbol: string) => chargerAuCreneau(
      (controle) => td.fetchKlinesTwelveData(symbol, "1d", { limit: 500 }, { ...controle, priorite: "graphe", attenteMaxMs: 20_000 }),
      garder,
    );
    return { td, backfill };
  }

  it("15 s d'attente de créneau puis 10 s de réponse : le chien de garde de 20 s ne tue pas la demande", async () => {
    const { backfill } = await preparer();
    await vi.advanceTimersByTimeAsync(45_000);
    delaiReponse = 10_000;
    const { promesse } = backfill("AMZN");
    let etat = "en attente";
    promesse.then(() => { etat = "ok"; }, (e: Error) => { etat = e.message; });
    await vi.advanceTimersByTimeAsync(24_999);
    expect(etat).toBe("en attente");
    await vi.advanceTimersByTimeAsync(1);
    expect(etat).toBe("ok");
  });

  it("le délai court à partir du créneau et abandonne alors le fetch en vol", async () => {
    const { backfill } = await preparer();
    await vi.advanceTimersByTimeAsync(45_000);
    delaiReponse = null;
    const { promesse } = backfill("META");
    const rejet = expect(promesse).rejects.toThrow("délai dépassé");
    // Créneau à +15 s, puis 20 s de chien de garde : 35 s au total, pas 20.
    await vi.advanceTimersByTimeAsync(15_000 + 19_999);
    expect(envois.at(-1)?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejet;
    expect(envois.at(-1)?.url).toContain("META");
    expect(envois.at(-1)?.signal?.aborted).toBe(true);
  });

  it("le démontage pendant l'attente retire la demande de la file : rien n'est envoyé", async () => {
    const { backfill } = await preparer();
    await vi.advanceTimersByTimeAsync(45_000);
    const { promesse, couper } = backfill("NFLX");
    await vi.advanceTimersByTimeAsync(5_000);
    couper();
    await expect(promesse).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(envois.filter(({ url }) => url.includes("NFLX"))).toHaveLength(0);
  });

  it("une attente de quota au-delà du raisonnable échoue d'emblée avec le prochain créneau", async () => {
    const { backfill } = await preparer();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(backfill("TSLA").promesse).rejects.toThrow("Quota Twelve Data : prochain créneau dans 55 s");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(envois.filter(({ url }) => url.includes("TSLA"))).toHaveLength(0);
  });
});
