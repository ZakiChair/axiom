/**
 * Sondage de toute jambe Twelve Data d'un synthétique (÷Or, ÷S&P 500, en CHF, GLD÷BTC…) :
 * amorçage immédiat (réessayé tant que rien n'est livré), puis seulement marché ouvert,
 * au plus toutes les 5 min (15 min dès 1d). Forex et or : ≈ 288 crédits par jour ouvré,
 * actions ≈ 82 ; un ratio laissé ouvert tient sous le plafond de 800 (revues du 26/09/2026).
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

  it("jeudi, SPY en 1m pendant la séance : plancher de 5 min", async () => {
    await suivre("SPY", "1m", "2026-09-24T15:00:00Z", 10 * MINUTE);
    expect(requetes).toHaveLength(3); // 0, +5, +10 min
  });

  it("mercredi, XAU/USD en 1m pendant 24 h : au plus 300 appels (plafond du jour : 800)", async () => {
    await suivre("XAU/USD", "1m", "2026-09-23T00:00:00Z", 24 * 60 * MINUTE);
    expect(requetes.length).toBeLessThanOrEqual(300);
    expect(requetes.length).toBeGreaterThan(280);
  });

  it("jeudi 02:00Z, SPY hors séance : amorçage seul", async () => {
    await suivre("SPY", "1m", "2026-09-24T02:00:00Z", 30 * MINUTE);
    expect(requetes).toEqual(["SPY"]);
  });
});

describe("souscrireJambeTwelveData — amorçage en échec (contre-revue du 26/09)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("premier fetch rejeté un samedi : nouvel essai puis émission, puis silence une fois amorcé", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
    let appels = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      appels += 1;
      if (appels === 1) return Promise.reject(new Error("réseau"));
      const values = [
        { datetime: "2026-09-25 20:00:00", open: "4280", high: "4290", low: "4270", close: "4286", volume: "0" },
        { datetime: "2026-09-25 21:00:00", open: "4286", high: "4288", low: "4284", close: "4286.2", volume: "0" },
      ];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "ok", values }) });
    }));
    const { souscrireJambeTwelveData } = await import("./twelvedata");
    const recu: Candle[] = [];
    const stop = souscrireJambeTwelveData("XAU/USD", "1h", (c) => recu.push(c));
    await vi.advanceTimersByTimeAsync(0);
    expect(recu).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(appels).toBe(2);
    expect(recu.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(120 * MINUTE);
    stop();
    expect(appels).toBe(2); // amorcé, marché fermé : plus aucun crédit
  });
});
