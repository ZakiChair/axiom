import { describe, expect, it } from "vitest";
import { compterAlertesActives } from "./SessionStrip";

describe("compteur du bandeau", () => {
  it("retire à l'échéance exacte sans masquer les alertes permanentes ou encore valides", () => {
    const fin = 1_000;
    const defs = [
      { actif: true },
      { actif: true, expireTs: fin },
      { actif: true, expireTs: fin + 1 },
      { actif: false },
    ];
    expect(compterAlertesActives(defs, fin - 1)).toBe(3);
    expect(compterAlertesActives(defs, fin)).toBe(2);
    expect(compterAlertesActives(defs, fin + 1)).toBe(1);
  });
});
