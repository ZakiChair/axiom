import { describe, expect, it } from "vitest";
import { parseEtfFlows } from "./etf";

describe("parseEtfFlows", () => {
  it("dégrade proprement sur toute forme non exploitable", () => {
    expect(parseEtfFlows(null).disponible).toBe(false);
    expect(parseEtfFlows("Internal Error").disponible).toBe(false);
    expect(parseEtfFlows([]).disponible).toBe(false);
    expect(parseEtfFlows({ issuers: [] }).disponible).toBe(false);
  });

  it("parse un schéma plausible { day, issuers } et cumule les flux", () => {
    const res = parseEtfFlows({
      day: "2026-06-30",
      issuers: [
        { name: "IBIT", flow: 1000 },
        { name: "FBTC", flow: -200 },
      ],
    });
    expect(res.disponible).toBe(true);
    expect(res.jour).toBe("2026-06-30");
    expect(res.parEmetteur?.length).toBe(2);
    expect(res.total).toBe(800);
  });
});
