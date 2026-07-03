import { describe, expect, it } from "vitest";
import { parseBisPolicyRatesCsv, ZONES_BIS } from "./policyRates";

// Extrait RÉEL (stats.bis.org WS_CBPOL, format=csv). La ligne JP a un champ
// COMPILATION guillemeté CONTENANT des virgules → exerce le parsing CSV robuste.
const CSV_BIS = `FREQ,REF_AREA,UNIT_MEASURE,UNIT_MULT,TIME_FORMAT,COMPILATION,DECIMALS,SOURCE_REF,SUPP_INFO_BREAKS,TITLE,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK
D,CH,368,0,,From 13 June 2019 onwards SNB Policy rate.,4,Swiss National Bank,, Central bank policy rates - Switzerland - Daily,2026-06-30,0,A,F,
D,GB,368,0,,From 3 Aug 2006 onwards: official bank rate.,4,Bank of England,, Central bank policy rates - United Kingdom - Daily,2026-06-29,3.75,A,F,
D,JP,368,0,,"From 17 Jun 2026 onwards, around 1.00 percent; from 27 Jan 2025, around 0.50 percent.",4,Bank of Japan,See docs, Central bank policy rates - Japan - Daily,2026-06-30,1,A,F,
D,US,368,0,,From 19 Dec 1985 onwards: mid-point of the Federal Reserve target rate.,4,US Federal Reserve System,, Central bank policy rates - United States - Daily,2026-06-30,3.625,A,F,
D,XM,368,0,,"From 18 Sep 2024 onwards: deposit facility rate, fixed rate.",4,European Central Bank,, Central bank policy rates - Euro area - Daily,2026-06-30,2.25,A,F,`;

describe("parseBisPolicyRatesCsv", () => {
  it("parse les cinq banques dans l'ordre d'affichage (Fed, BCE, BoE, BoJ, BNS)", () => {
    const taux = parseBisPolicyRatesCsv(CSV_BIS);
    expect(taux.map((t) => t.sigle)).toEqual(["Fed", "BCE", "BoE", "BoJ", "BNS"]);
  });

  it("mappe zone → banque et lit le taux + la date", () => {
    const taux = parseBisPolicyRatesCsv(CSV_BIS);
    const fed = taux.find((t) => t.refArea === "US")!;
    expect(fed.banque).toBe("Réserve fédérale (US)");
    expect(fed.taux).toBe(3.625);
    expect(fed.date).toBe("2026-06-30");
    const bce = taux.find((t) => t.refArea === "XM")!;
    expect(bce.sigle).toBe("BCE");
    expect(bce.taux).toBe(2.25);
  });

  it("gère un champ guillemeté virgulé sans casser l'alignement des colonnes (JP)", () => {
    const taux = parseBisPolicyRatesCsv(CSV_BIS);
    const boj = taux.find((t) => t.refArea === "JP")!;
    expect(boj.taux).toBe(1);
    expect(boj.date).toBe("2026-06-30");
  });

  it("ignore une zone non ciblée et une valeur non numérique", () => {
    const csv = `FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE
D,CN,2026-06-30,3.0
D,US,2026-06-30,NA`;
    const taux = parseBisPolicyRatesCsv(csv);
    // CN hors table BANQUES → absent ; US non numérique → absent.
    expect(taux).toEqual([]);
  });

  it("CSV vide → [] (dégradation gracieuse)", () => {
    expect(parseBisPolicyRatesCsv("")).toEqual([]);
  });
});

describe("ZONES_BIS", () => {
  it("compose la clé de dimensions attendue", () => {
    expect(ZONES_BIS).toBe("US+XM+GB+JP+CH");
  });
});
