import { describe, expect, it } from "vitest";
import { parseProfilFinnhub, parseEarnings } from "./finnhub";

describe("parseProfilFinnhub", () => {
  it("parse un profil valide", () => {
    const json = { name: "Apple Inc", finnhubIndustry: "Technology", marketCapitalization: 3_000_000, weburl: "" };
    expect(parseProfilFinnhub(json)).toEqual({
      nom: "Apple Inc",
      secteur: "Technology",
      capitalisation: 3_000_000,
      description: "",
    });
  });
  it("renvoie null sur objet vide", () => {
    expect(parseProfilFinnhub({})).toBeNull();
  });
  it("renvoie null sur forme inconnue", () => {
    expect(parseProfilFinnhub(null)).toBeNull();
  });
});

describe("parseEarnings", () => {
  it("parse une liste d'événements", () => {
    const json = {
      earningsCalendar: [
        { symbol: "AAPL", date: "2026-07-30", epsEstimate: 1.5, epsActual: null },
      ],
    };
    expect(parseEarnings(json, "AAPL")).toEqual([
      { ticker: "AAPL", date: "2026-07-30", epsEstime: 1.5, epsReel: null },
    ]);
  });
  it("liste vide sur forme inconnue", () => {
    expect(parseEarnings(null, "AAPL")).toEqual([]);
  });
});
