import { describe, expect, it } from "vitest";
import {
  chargerDatesEvenement,
  estEteUs,
  parseReleaseDates,
  tsPublicationUtc,
  TYPES_EVENEMENT,
  type DateEvenement,
} from "./eventDates";

// ─────────────────────────── estEteUs (DST US, règle post-2007) ───────────────────────────

describe("estEteUs", () => {
  it("bascule au 2ᵉ dimanche de mars (8 mars 2026)", () => {
    expect(estEteUs("2026-03-07")).toBe(false); // veille du 2ᵉ dimanche → hiver
    expect(estEteUs("2026-03-08")).toBe(true); // 2ᵉ dimanche de mars → été
  });
  it("bascule au 1er dimanche de novembre (1er novembre 2026)", () => {
    expect(estEteUs("2026-11-01")).toBe(false); // 1er dimanche de novembre → hiver
    expect(estEteUs("2026-10-31")).toBe(true); // veille → encore été
  });
  it("plein été", () => {
    expect(estEteUs("2026-07-15")).toBe(true);
  });
  it("plein hiver (janvier)", () => {
    expect(estEteUs("2026-01-15")).toBe(false);
  });
});

// ─────────────────────────── tsPublicationUtc (08:30 ET / 14:00 ET + DST) ───────────────────────────

describe("tsPublicationUtc", () => {
  it("CPI en été = 12:30 UTC (08:30 EDT, UTC-4)", () => {
    expect(tsPublicationUtc("2025-06-11", "cpi")).toBe(Date.parse("2025-06-11T12:30:00Z"));
  });
  it("CPI en hiver = 13:30 UTC (08:30 EST, UTC-5)", () => {
    expect(tsPublicationUtc("2025-01-15", "cpi")).toBe(Date.parse("2025-01-15T13:30:00Z"));
  });
  it("NFP en été = 12:30 UTC (même horaire de publication que le CPI)", () => {
    expect(tsPublicationUtc("2025-06-06", "nfp")).toBe(Date.parse("2025-06-06T12:30:00Z"));
  });
  it("FOMC en été = 18:00 UTC (14:00 EDT, UTC-4)", () => {
    expect(tsPublicationUtc("2025-06-18", "fomc")).toBe(Date.parse("2025-06-18T18:00:00Z"));
  });
  it("FOMC en hiver = 19:00 UTC (14:00 EST, UTC-5)", () => {
    expect(tsPublicationUtc("2025-01-29", "fomc")).toBe(Date.parse("2025-01-29T19:00:00Z"));
  });
});

// ─────────────────────────── parseReleaseDates (réponse FRED release/dates) ───────────────────────────

describe("parseReleaseDates", () => {
  it("trie, dédoublonne par jour et ignore les dates invalides", () => {
    const fixture = {
      release_dates: [
        { date: "2025-07-15", release_id: 10 },
        { date: "2025-06-11", release_id: 10 }, // antérieure → doit passer devant après tri
        { date: "2025-06-11", release_id: 10 }, // doublon → écarté
        { date: "pas-une-date", release_id: 10 }, // format invalide → ignoré
        { date: "2025-13-99", release_id: 10 }, // format OK mais date impossible → ignoré
        { date: 20250815, release_id: 10 }, // non-chaîne → ignoré
      ],
    };
    const out = parseReleaseDates(fixture, "cpi");
    expect(out.map((d) => d.ymd)).toEqual(["2025-06-11", "2025-07-15"]);
    // Horodatage exact = heure de publication CPI (été → 12:30 UTC).
    expect(out[0]!.time).toBe(Date.parse("2025-06-11T12:30:00Z"));
    // Strictement croissant.
    expect(out[1]!.time).toBeGreaterThan(out[0]!.time);
  });
  it("fixture vide → []", () => {
    expect(parseReleaseDates({ release_dates: [] }, "cpi")).toEqual([]);
  });
  it("donnée malformée (pas d'objet release_dates) → []", () => {
    expect(parseReleaseDates(null, "nfp")).toEqual([]);
    expect(parseReleaseDates({ autre: 1 }, "nfp")).toEqual([]);
    expect(parseReleaseDates("bruit", "nfp")).toEqual([]);
  });
});

// ─────────────────────────── TYPES_EVENEMENT (contrat) ───────────────────────────

describe("TYPES_EVENEMENT", () => {
  it("expose les trois types avec leurs libellés", () => {
    expect(TYPES_EVENEMENT).toEqual([
      { id: "cpi", label: "CPI US" },
      { id: "nfp", label: "NFP" },
      { id: "fomc", label: "FOMC" },
    ]);
  });
});

// ─────────────────────────── chargerDatesEvenement — FOMC statique ───────────────────────────

describe("chargerDatesEvenement('fomc')", () => {
  it("liste fusionnée (historique + futur) strictement croissante, exactement 8 décisions/an 2022-2025", async () => {
    const dates = await chargerDatesEvenement("fomc");

    // Strictement croissante en temps ET en ymd.
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]!.time).toBeGreaterThan(dates[i - 1]!.time);
      expect(dates[i]!.ymd > dates[i - 1]!.ymd).toBe(true);
    }

    // Exactement 8 décisions par an sur 2022-2025 (invariant : capte un doublon ou un
    // vote de notation qui se glisserait dans la liste).
    const parAnnee = (annee: string): DateEvenement[] =>
      dates.filter((d) => d.ymd.slice(0, 4) === annee);
    for (const annee of ["2022", "2023", "2024", "2025"]) {
      expect(parAnnee(annee)).toHaveLength(8);
    }

    // La concaténation couvre bien l'historique (2020) ET le futur (>= 2026).
    expect(dates.some((d) => d.ymd.startsWith("2020"))).toBe(true);
    expect(dates.some((d) => d.ymd >= "2026-01-01")).toBe(true);

    // Horodatage FOMC = 14:00 ET (hiver → 19:00 UTC pour une date de janvier).
    const jan2022 = dates.find((d) => d.ymd === "2022-01-26");
    expect(jan2022?.time).toBe(Date.parse("2022-01-26T19:00:00Z"));
  });
});

// ─────────────────────────── chargerDatesEvenement — dégradation CPI/NFP ───────────────────────────

describe("chargerDatesEvenement('cpi') sans réseau", () => {
  it("dégrade proprement : renvoie [] sans lever d'exception (fetch injoignable en env node)", async () => {
    await expect(chargerDatesEvenement("cpi")).resolves.toEqual([]);
  });
});
