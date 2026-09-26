/**
 * Sondage de la jambe Twelve Data d'un ratio (÷Or, ÷S&P 500, en CHF…) : amorçage immédiat,
 * puis seulement marché ouvert, à une cadence qui suit l'unité de temps — un ratio laissé
 * ouvert ne doit plus épuiser à lui seul le quota de 800 crédits/jour (revue du 26/09/2026).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";

const MINUTE = 60_000;

describe("souscrireJambeTwelveData — cadence et heures de marché", () => {
  let requetes: string[];

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    requetes = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      requetes.push(new URL(url, "http://localhost").searchParams.get("symbol") ?? "");
      const values = [
        { datetime: "2026-09-24 09:00:00", open: "1.2", high: "1.21", low: "1.19", close: "1.205", volume: "0" },
        { datetime: "2026-09-24 10:00:00", open: "1.205", high: "1.21", low: "1.2", close: "1.207", volume: "0" },
      ];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "ok", values }) });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function suivre(symbol: string, tf: "1m" | "1h" | "1d", debut: string, dureeMs: number) {
    vi.setSystemTime(new Date(debut));
    const { souscrireJambeTwelveData } = await import("./twelvedata");
    const recu: Candle[] = [];
    const stop = souscrireJambeTwelveData(symbol, tf, (c) => recu.push(c));
    await vi.advanceTimersByTimeAsync(dureeMs);
    stop();
    return recu;
  }

  it("samedi, XAU/USD (forex fermé) : un seul sondage d'amorçage en deux heures", async () => {
    const recu = await suivre("XAU/USD", "1h", "2026-09-26T10:00:00Z", 120 * MINUTE);
    expect(requetes).toEqual(["XAU/USD"]);
    expect(recu.length).toBeGreaterThan(0); // amorçage : le ratio a un dénominateur tout de suite
  });

  it("jeudi, CHF/USD en 1h : amorçage immédiat puis toutes les 5 min", async () => {
    await suivre("CHF/USD", "1h", "2026-09-24T10:00:00Z", 10 * MINUTE);
    expect(requetes).toHaveLength(3); // 0, +5, +10 min
  });

  it("jeudi, CHF/USD en 1d : toutes les 15 min", async () => {
    await suivre("CHF/USD", "1d", "2026-09-24T10:00:00Z", 30 * MINUTE);
    expect(requetes).toHaveLength(3); // 0, +15, +30 min
  });

  it("jeudi, SPY en 1m pendant la séance : chaque minute", async () => {
    await suivre("SPY", "1m", "2026-09-24T15:00:00Z", 3 * MINUTE);
    expect(requetes).toHaveLength(4);
  });

  it("jeudi 02:00Z, SPY hors séance : amorçage seul", async () => {
    await suivre("SPY", "1m", "2026-09-24T02:00:00Z", 30 * MINUTE);
    expect(requetes).toEqual(["SPY"]);
  });
});
