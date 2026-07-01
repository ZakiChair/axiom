import { describe, expect, test } from "bun:test";
import type { Candle } from "@axiom/types";
import { ajouterBougie, construireUrlFlux, FENETRE_BOUGIES } from "./marketFeed";

/** Fabrique une bougie minimale à un temps donné. */
function bougie(time: number, close = 1): Candle {
  return { time, open: close, high: close, low: close, close, volume: 0 };
}

describe("construireUrlFlux", () => {
  test("null si aucun symbole", () => {
    expect(construireUrlFlux([])).toBeNull();
  });

  test("streams combinés miniTicker + kline_1m en minuscules", () => {
    expect(construireUrlFlux(["BTCUSDT", "ETHUSDT"])).toBe(
      "wss://stream.binance.com:9443/stream?streams=" +
        "btcusdt@miniTicker/btcusdt@kline_1m/ethusdt@miniTicker/ethusdt@kline_1m",
    );
  });
});

describe("ajouterBougie", () => {
  test("ajoute en fin quand le temps est strictement plus grand", () => {
    const f: Candle[] = [bougie(1000)];
    ajouterBougie(f, bougie(2000));
    expect(f.map((c) => c.time)).toEqual([1000, 2000]);
  });

  test("remplace la dernière bougie à temps égal (mise à jour de clôture)", () => {
    const f: Candle[] = [bougie(1000), bougie(2000, 5)];
    ajouterBougie(f, bougie(2000, 9));
    expect(f).toHaveLength(2);
    expect(f[1]?.close).toBe(9);
  });

  test("ignore une bougie hors ordre (antérieure)", () => {
    const f: Candle[] = [bougie(2000)];
    ajouterBougie(f, bougie(1000));
    expect(f.map((c) => c.time)).toEqual([2000]);
  });

  test("borne la fenêtre à FENETRE_BOUGIES", () => {
    const f: Candle[] = [];
    for (let i = 0; i < FENETRE_BOUGIES + 50; i++) ajouterBougie(f, bougie(i * 60_000));
    expect(f).toHaveLength(FENETRE_BOUGIES);
    // Les plus anciennes sont évincées : la 1re restante = index 50.
    expect(f[0]?.time).toBe(50 * 60_000);
  });
});
