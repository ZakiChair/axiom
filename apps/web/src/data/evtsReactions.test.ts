import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { chargerFenetreReactionM1 } from "./evtsReactions";

const M = 60_000;
const debut = Date.UTC(2026, 8, 4, 12, 30);

function candle(time: number): Candle {
  return { time, open: 100, high: 100, low: 100, close: 100, volume: 1 };
}

describe("chargerFenetreReactionM1", () => {
  it("page au plus 1000 bougies, déduplique et couvre avant/après H0", async () => {
    const all = Array.from({ length: 2_881 }, (_, index) => candle(debut - 1_441 * M + index * M));
    const appels: Array<{ limit?: number; endTime?: number }> = [];
    const adapter = {
      fetchKlines: async (_symbol: string, _tf: "1m", options?: { limit?: number; endTime?: number }) => {
        appels.push(options ?? {});
        const fin = options?.endTime ?? Infinity;
        return all.filter((item) => item.time <= fin).slice(-(options?.limit ?? 500));
      },
    };

    const resultat = await chargerFenetreReactionM1(adapter, "BTCUSDT", debut, {
      maintenantMs: debut + 1_500 * M,
    });

    expect(appels.every((appel) => (appel.limit ?? 0) <= 1000)).toBe(true);
    expect(appels).toHaveLength(3);
    expect(resultat.map((item) => item.time)).toEqual(all.map((item) => item.time));
  });

  it("s'arrête sans boucle si une page ne progresse plus et respecte l'annulation", async () => {
    const first = [candle(debut)];
    let appels = 0;
    const adapter = {
      fetchKlines: async () => {
        appels += 1;
        return first;
      },
    };
    const ctrl = new AbortController();
    const resultat = await chargerFenetreReactionM1(adapter, "BTCUSDT", debut, { maintenantMs: debut + 2_000 * M, signal: ctrl.signal });
    expect(resultat).toEqual(first);
    expect(appels).toBe(2);
    ctrl.abort();
    await expect(chargerFenetreReactionM1(adapter, "BTCUSDT", debut, { maintenantMs: debut + 2_000 * M, signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
