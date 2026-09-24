import { describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import { chargerAvecRepli } from "./routageMarche";
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
