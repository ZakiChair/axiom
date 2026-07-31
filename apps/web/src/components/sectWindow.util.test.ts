import { describe, expect, it } from "vitest";
import { classePct, paireOuvrable } from "./sectWindow.util";

describe("paireOuvrable", () => {
  const catalogue = new Set(["BTCUSDT", "ETHUSDT"]);

  it("retient la paire curée seulement si le catalogue Binance la confirme", () => {
    expect(paireOuvrable("BTCUSDT", catalogue)).toBe("BTCUSDT");
    // Paire curée périmée (délistage) : « sinon rien », comme MAP.
    expect(paireOuvrable("XMRUSDT", catalogue)).toBeNull();
  });

  it("membre sans paire ou catalogue non chargé → null", () => {
    expect(paireOuvrable(undefined, catalogue)).toBeNull();
    expect(paireOuvrable("BTCUSDT", null)).toBeNull();
  });
});

describe("classePct", () => {
  it("signe → up/down ; zéro compte comme up (convention formatPct « +0,00 % »)", () => {
    expect(classePct(3.2)).toBe("text-up");
    expect(classePct(0)).toBe("text-up");
    expect(classePct(-0.1)).toBe("text-down");
  });

  it("valeur absente (non couvert / vieux cache) → estompé", () => {
    expect(classePct(null)).toBe("text-text-dim");
    expect(classePct(Number.NaN)).toBe("text-text-dim");
  });
});
