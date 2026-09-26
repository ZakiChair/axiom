import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("isMarketOpen — fuseau America/New_York indisponible (vérification du 26/09)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("le module se charge et revient à la fenêtre UTC d'été 13:20-20:10", async () => {
    const Original = Intl.DateTimeFormat;
    vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: function (locale?: string, options?: Intl.DateTimeFormatOptions) {
      if (options?.timeZone === "America/New_York") throw new RangeError("Invalid time zone specified: America/New_York");
      return new Original(locale, options);
    } });
    vi.resetModules();
    const { isMarketOpen: repli } = await import("./heuresMarche");
    expect(repli("stock", new Date("2026-11-04T13:25:00Z"))).toBe(true);
    expect(repli("stock", new Date("2026-11-04T20:15:00Z"))).toBe(false);
    expect(repli("stock", new Date("2026-11-07T15:00:00Z"))).toBe(false);
  });
});
