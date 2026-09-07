import { describe, expect, it } from "vitest";
import { serieMacroDe } from "./ecoVersSerie";

describe("serieMacroDe", () => {
  it("relie une publication CPI à la série de sa zone", () => {
    expect(serieMacroDe("USD", "Consumer Price Index m/m")).toBe("cpi-aa-us");
    expect(serieMacroDe("USD", "CPI y/y")).toBe("cpi-aa-us");
    expect(serieMacroDe("EUR", "Core CPI Flash Estimate y/y")).toBe("cpi-aa-ez");
    expect(serieMacroDe("GBP", "CPI y/y")).toBe("cpi-aa-uk");
    expect(serieMacroDe("JPY", "National Core CPI y/y")).toBe("cpi-aa-jp");
    expect(serieMacroDe("CNY", "CPI y/y")).toBe("cpi-aa-cn");
    expect(serieMacroDe("INR", "CPI y/y")).toBe("cpi-aa-in");
  });

  it("ignore une publication sans série correspondante", () => {
    expect(serieMacroDe("EUR", "ZEW Economic Sentiment")).toBeNull();
    expect(serieMacroDe("USD", "Non-Farm Employment Change")).toBeNull();
    expect(serieMacroDe("USD", "FOMC Statement")).toBeNull();
  });

  it("ignore une devise hors des six zones suivies", () => {
    expect(serieMacroDe("AUD", "CPI q/q")).toBeNull();
    expect(serieMacroDe("", "CPI y/y")).toBeNull();
  });

  it("est insensible à la casse et aux espaces du titre", () => {
    expect(serieMacroDe("usd", "  consumer price index  ")).toBe("cpi-aa-us");
  });
});
