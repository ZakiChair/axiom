import { describe, expect, it } from "vitest";
import { isMarketOpen } from "./heuresMarche";

const ouvert = (iso: string) => isMarketOpen("stock", new Date(iso));

describe("isMarketOpen — séance NYSE à l'heure de New York (contre-revue du 26/09)", () => {
  it("été (EDT, jeudi 24/09/2026) : 09:20-16:10 New York = 13:20-20:10Z", () => {
    expect(ouvert("2026-09-24T13:15:00Z")).toBe(false);
    expect(ouvert("2026-09-24T13:25:00Z")).toBe(true);
    expect(ouvert("2026-09-24T20:05:00Z")).toBe(true);
    expect(ouvert("2026-09-24T20:15:00Z")).toBe(false);
  });

  it("hiver (EST, mercredi 04/11/2026) : 09:20-16:10 New York = 14:20-21:10Z", () => {
    expect(ouvert("2026-11-04T13:30:00Z")).toBe(false);
    expect(ouvert("2026-11-04T14:25:00Z")).toBe(true);
    expect(ouvert("2026-11-04T20:59:00Z")).toBe(true);
    expect(ouvert("2026-11-04T21:05:00Z")).toBe(true);
    expect(ouvert("2026-11-04T21:15:00Z")).toBe(false);
  });

  it("week-end fermé, y compris un samedi 14:00 New York ; forex inchangé", () => {
    expect(ouvert("2026-11-07T19:00:00Z")).toBe(false);
    expect(isMarketOpen("forex", new Date("2026-11-04T21:05:00Z"))).toBe(true);
    expect(isMarketOpen("forex", new Date("2026-11-07T12:00:00Z"))).toBe(false);
  });
});
