/**
 * Backtest : une règle importée qui porte le paramètre réservé « unité » (SUG-1, phase 1 :
 * graphe seul) est refusée avec motif, avant toute requête ; sans lui, le run part.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";

const { charger } = vi.hoisted(() => ({ charger: vi.fn() }));
vi.mock("../data/backtestData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/backtestData")>()),
  accumulerKlines: charger,
}));
import { backtestStore } from "./backtest";

afterEach(() => {
  backtestStore.getState().cancel();
  charger.mockReset();
  vi.unstubAllGlobals();
});

const rsi = (params: Record<string, number | string>) => ({
  type: "comparaison" as const,
  gauche: { type: "indicateur" as const, indicateurId: "rsi", params, output: "rsi" },
  comparateur: "<" as const,
  droite: { type: "constante" as const, valeur: 30 },
});

describe("backtest — paramètre « unité » refusé", () => {
  it("refus motivé, aucune bougie chargée", () => {
    backtestStore.setState({ symbol: "BTCUSDT", tf: "1h", modeFunding: "aucun", reglesEntree: [rsi({ length: 14, unite: "4h" })], reglesSortie: [] });
    backtestStore.getState().run();
    const etat = backtestStore.getState();
    expect(etat.phase).toBe("error");
    expect(etat.error).toBe(
      "Paramètre « unité » [4h] réservé au graphe : le backtest calculerait sur ses propres bougies, sans unité supérieure. Retire ce paramètre.",
    );
    expect(charger).not.toHaveBeenCalled();
  });

  it("une règle de SORTIE suffit à refuser", () => {
    backtestStore.setState({ symbol: "BTCUSDT", tf: "4h", modeFunding: "aucun", reglesEntree: [rsi({ length: 14 })], reglesSortie: [rsi({ length: 14, unite: "1d" })] });
    backtestStore.getState().run();
    expect(backtestStore.getState().error).toContain("[1d] réservé au graphe");
    expect(charger).not.toHaveBeenCalled();
  });

  it("sans le paramètre, le run démarre normalement", async () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({ time: Date.UTC(2026, 8, 1) + i * 3_600_000, open: 100, high: 100, low: 100, close: 100, volume: 1, closed: true }));
    charger.mockResolvedValue(candles);
    vi.stubGlobal("Worker", class { postMessage() {} terminate() {} });
    backtestStore.setState({ symbol: "BTCUSDT", tf: "1h", modeFunding: "aucun", reglesEntree: [rsi({ length: 14 })], reglesSortie: [] });
    backtestStore.getState().run();
    expect(backtestStore.getState().phase).toBe("chargement");
    await vi.waitFor(() => expect(charger).toHaveBeenCalledTimes(1));
  });
});
