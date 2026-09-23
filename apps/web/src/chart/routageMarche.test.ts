import { describe, expect, it } from "vitest";
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
