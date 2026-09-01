import { beforeEach, describe, expect, it } from "vitest";
import { SYNTHETIC_PRESETS, syntheticsStore } from "./synthetics";

beforeEach(() => {
  syntheticsStore.getState().setRecents([]);
});

describe("syntheticsStore", () => {
  it("ajoute un récent valide en tête", () => {
    syntheticsStore.getState().addRecent("binance:ETHUSDT|/|binance:BTCUSDT");
    expect(syntheticsStore.getState().recents).toEqual(["binance:ETHUSDT|/|binance:BTCUSDT"]);
  });

  it("dédoublonne en gardant le plus récent en tête", () => {
    syntheticsStore.getState().addRecent("binance:ETHUSDT|/|binance:BTCUSDT");
    syntheticsStore.getState().addRecent("binance:BTCUSDT|/|twelvedata:GLD");
    syntheticsStore.getState().addRecent("binance:ETHUSDT|/|binance:BTCUSDT");
    expect(syntheticsStore.getState().recents).toEqual([
      "binance:ETHUSDT|/|binance:BTCUSDT",
      "binance:BTCUSDT|/|twelvedata:GLD",
    ]);
  });

  it("tronque à 8 récents", () => {
    for (let i = 0; i < 10; i++) {
      syntheticsStore.getState().addRecent(`binance:A${i}|/|binance:B${i}`);
    }
    expect(syntheticsStore.getState().recents).toHaveLength(8);
    expect(syntheticsStore.getState().recents[0]).toBe("binance:A9|/|binance:B9");
    expect(syntheticsStore.getState().recents[7]).toBe("binance:A2|/|binance:B2");
  });

  it("accepte les trois capitalisations autonomes", () => {
    syntheticsStore.getState().setRecents(["TOTAL", "TOTAL2", "TOTAL3"]);
    expect(syntheticsStore.getState().recents).toEqual(["TOTAL", "TOTAL2", "TOTAL3"]);
    expect(SYNTHETIC_PRESETS.map((preset) => preset.symbol)).toEqual(
      expect.arrayContaining(["TOTAL", "TOTAL2", "TOTAL3"]),
    );
  });

  it("ignore les symboles invalides à l'ajout et à l'hydratation", () => {
    syntheticsStore.getState().addRecent("BTCUSDT");
    syntheticsStore.getState().setRecents([
      "nimporte",
      "binance:ETHUSDT|-|twelvedata:UUP",
      "synthetic:X|/|binance:B",
    ]);
    expect(syntheticsStore.getState().recents).toEqual(["binance:ETHUSDT|-|twelvedata:UUP"]);
  });
});
