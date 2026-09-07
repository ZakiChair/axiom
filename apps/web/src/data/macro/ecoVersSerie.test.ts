/**
 * Titres sourced en direct du flux live ForexFactory (https://nfs.faireconomy.media/ff_calendar_thisweek.json)
 * le 2026-09-07 — observations réelles, pas inventées.
 */
import { describe, expect, it } from "vitest";
import { serieMacroDe } from "./ecoVersSerie";

describe("serieMacroDe", () => {
  it("relie les publications CPI titre y/y à la série de sa zone", () => {
    // Titres réels du flux FF 2026-09-07 qui correspondent
    expect(serieMacroDe("USD", "CPI y/y")).toBe("cpi-aa-us");
    expect(serieMacroDe("CNY", "CPI y/y")).toBe("cpi-aa-cn");
    expect(serieMacroDe("EUR", "CPI Flash Estimate y/y")).toBe("cpi-aa-ez");
    expect(serieMacroDe("GBP", "CPI y/y")).toBe("cpi-aa-uk");
  });

  it("ignore une publication sans série correspondante ou mesure non-headline", () => {
    // Publis hors périmètre (ne sont pas des CPI)
    expect(serieMacroDe("EUR", "ZEW Economic Sentiment")).toBeNull();
    expect(serieMacroDe("USD", "Non-Farm Employment Change")).toBeNull();
    expect(serieMacroDe("USD", "FOMC Statement")).toBeNull();
    // Titres réels du flux FF 2026-09-07 : CPI mais NOT headline y/y
    // (Core, m/m, variants régionaux)
    expect(serieMacroDe("EUR", "German Final CPI m/m")).toBeNull();
    expect(serieMacroDe("USD", "Core CPI y/y")).toBeNull();
    expect(serieMacroDe("USD", "CPI m/m")).toBeNull();
    // Test en brief : Core variant du FF
    expect(serieMacroDe("JPY", "National Core CPI y/y")).toBeNull();
  });

  it("ignore une devise hors des six zones suivies", () => {
    expect(serieMacroDe("AUD", "CPI q/q")).toBeNull();
    expect(serieMacroDe("", "CPI y/y")).toBeNull();
  });

  it("est insensible à la casse et aux espaces du titre", () => {
    expect(serieMacroDe("usd", "  consumer price index   y/y  ")).toBe("cpi-aa-us");
  });
});
