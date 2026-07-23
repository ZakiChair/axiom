/**
 * Tests du formatage PUR du hashrate (TH/s → EH/s/PH/s selon magnitude, 3 chiffres
 * significatifs). Ancre : ~9.18e8 TH/s doit se lire « 918 EH/s » (piège d'unité T2).
 */
import { describe, it, expect } from "vitest";
import { formatHashrate } from "./onchainWindow.util";

describe("formatHashrate", () => {
  it("convertit ~9.18e8 TH/s en « 918 EH/s » (ancre du brief)", () => {
    expect(formatHashrate(9.18e8)).toBe("918 EH/s");
  });

  it("garde la partie entière au-delà de 1000 EH/s (réel 2026 ~1.075e9 TH/s)", () => {
    expect(formatHashrate(1.075e9)).toBe("1075 EH/s");
  });

  it("bascule en PH/s entre 1e3 et 1e6 TH/s", () => {
    expect(formatHashrate(5.5e5)).toBe("550 PH/s");
  });

  it("reste en TH/s sous 1e3", () => {
    expect(formatHashrate(9.18e2)).toBe("918 TH/s");
  });

  it("applique 3 chiffres significatifs (2 décimales à un chiffre entier)", () => {
    expect(formatHashrate(9.183e6)).toBe("9.18 EH/s");
  });

  it("applique 3 chiffres significatifs (1 décimale à deux chiffres entiers)", () => {
    expect(formatHashrate(9.183e7)).toBe("91.8 EH/s");
  });

  it("gère la borne exacte 1e6 TH/s = 1.00 EH/s", () => {
    expect(formatHashrate(1e6)).toBe("1.00 EH/s");
  });

  it("renvoie « — » sur valeur absente ou non finie", () => {
    expect(formatHashrate(undefined)).toBe("—");
    expect(formatHashrate(null)).toBe("—");
    expect(formatHashrate(NaN)).toBe("—");
  });
});
