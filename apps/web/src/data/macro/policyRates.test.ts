import { describe, expect, it } from "vitest";
import { parseBisPolicyRatesCsv, ZONES_BIS } from "./policyRates";

// Extrait RÉEL (stats.bis.org WS_CBPOL, format=csv). La ligne JP a un champ
// COMPILATION guillemeté CONTENANT des virgules → exerce le parsing CSV robuste.
// Les zones arrivent dans un ordre ≠ de l'ordre d'affichage (l'API renvoie ses
// propres regroupements) → l'ordre de sortie doit venir de la table BANQUES.
const CSV_BIS = `FREQ,REF_AREA,UNIT_MEASURE,UNIT_MULT,TIME_FORMAT,COMPILATION,DECIMALS,SOURCE_REF,SUPP_INFO_BREAKS,TITLE,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK
D,AU,368,0,,Cash rate target.,4,Reserve Bank of Australia,, Central bank policy rates - Australia - Daily,2026-06-30,3.6,A,F,
D,BR,368,0,,Selic target rate.,4,Central Bank of Brazil,, Central bank policy rates - Brazil - Daily,2026-06-30,15,A,F,
D,CA,368,0,,Target for the overnight rate.,4,Bank of Canada,, Central bank policy rates - Canada - Daily,2026-06-30,2.75,A,F,
D,CH,368,0,,From 13 June 2019 onwards SNB Policy rate.,4,Swiss National Bank,, Central bank policy rates - Switzerland - Daily,2026-06-30,0,A,F,
D,CN,368,0,,"From 20 Aug 2019 onwards, loan prime rate (1 year).",4,People's Bank of China,, Central bank policy rates - China - Daily,2026-06-30,3,A,F,
D,GB,368,0,,From 3 Aug 2006 onwards: official bank rate.,4,Bank of England,, Central bank policy rates - United Kingdom - Daily,2026-06-29,3.75,A,F,
D,IN,368,0,,Policy repo rate.,4,Reserve Bank of India,, Central bank policy rates - India - Daily,2026-06-30,5.5,A,F,
D,JP,368,0,,"From 17 Jun 2026 onwards, around 1.00 percent; from 27 Jan 2025, around 0.50 percent.",4,Bank of Japan,See docs, Central bank policy rates - Japan - Daily,2026-06-30,1,A,F,
D,KR,368,0,,Base rate.,4,Bank of Korea,, Central bank policy rates - Korea - Daily,2026-06-30,2.5,A,F,
D,MX,368,0,,Overnight interbank funding rate target.,4,Bank of Mexico,, Central bank policy rates - Mexico - Daily,2026-06-30,8,A,F,
D,US,368,0,,From 19 Dec 1985 onwards: mid-point of the Federal Reserve target rate.,4,US Federal Reserve System,, Central bank policy rates - United States - Daily,2026-06-30,3.625,A,F,
D,XM,368,0,,"From 18 Sep 2024 onwards: deposit facility rate, fixed rate.",4,European Central Bank,, Central bank policy rates - Euro area - Daily,2026-06-30,2.25,A,F,`;

describe("parseBisPolicyRatesCsv", () => {
  it("parse les douze banques dans l'ordre d'affichage (les cinq grandes d'abord)", () => {
    const taux = parseBisPolicyRatesCsv(CSV_BIS);
    expect(taux.map((t) => t.sigle)).toEqual([
      "Fed",
      "BCE",
      "BoE",
      "BoJ",
      "BNS",
      "PBOC",
      "BoC",
      "RBA",
      "BCB",
      "RBI",
      "BoK",
      "Banxico",
    ]);
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

  it("mappe les nouvelles zones (PBOC, BCB, Banxico)", () => {
    const taux = parseBisPolicyRatesCsv(CSV_BIS);
    const pboc = taux.find((t) => t.refArea === "CN")!;
    expect(pboc.banque).toBe("Banque populaire de Chine");
    expect(pboc.taux).toBe(3);
    const bcb = taux.find((t) => t.refArea === "BR")!;
    expect(bcb.sigle).toBe("BCB");
    expect(bcb.taux).toBe(15);
    const banxico = taux.find((t) => t.refArea === "MX")!;
    expect(banxico.banque).toBe("Banque du Mexique");
    expect(banxico.taux).toBe(8);
  });

  it("gère un champ guillemeté virgulé sans casser l'alignement des colonnes (JP, CN)", () => {
    const taux = parseBisPolicyRatesCsv(CSV_BIS);
    const boj = taux.find((t) => t.refArea === "JP")!;
    expect(boj.taux).toBe(1);
    expect(boj.date).toBe("2026-06-30");
    const pboc = taux.find((t) => t.refArea === "CN")!;
    expect(pboc.date).toBe("2026-06-30");
  });

  it("ignore une zone non ciblée et une valeur non numérique", () => {
    const csv = `FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE
D,SE,2026-06-30,1.75
D,US,2026-06-30,NA`;
    const taux = parseBisPolicyRatesCsv(csv);
    // SE hors table BANQUES → absent ; US non numérique → absent.
    expect(taux).toEqual([]);
  });

  it("CSV vide → [] (dégradation gracieuse)", () => {
    expect(parseBisPolicyRatesCsv("")).toEqual([]);
  });
});

describe("ZONES_BIS", () => {
  it("compose la clé de dimensions attendue (cinq grandes puis jeu curé)", () => {
    expect(ZONES_BIS).toBe("US+XM+GB+JP+CH+CN+CA+AU+BR+IN+KR+MX");
  });
});
