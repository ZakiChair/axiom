import { describe, expect, it } from "vitest";
import {
  MATURITE_AU_INDEXEE,
  parseBocValetJson,
  parseJgbCsv,
  parseRbaF2Csv,
} from "./sovereignYields";
import { deltaJour } from "./treasuryYields";

// ─────────────────────────── Japon (MOF jgbcme.csv) ───────────────────────────

// Extrait RÉEL (www.mof.go.jp, 2026-07) — CRLF, ligne de titre, ordre ASCENDANT, ligne
// vide de virgules puis pied de page Shift-JIS (le « ※ » devient U+FFFD après décodage
// UTF-8 de `res.text()`) dont la cellule Date N'EST PAS vide.
const CSV_JP = [
  "Interest Rate (July 2026),,,,,,,,,,,,,,,(Unit : %)",
  "Date,1Y,2Y,3Y,4Y,5Y,6Y,7Y,8Y,9Y,10Y,15Y,20Y,25Y,30Y,40Y",
  "2026/7/7,1.168,1.402,1.565,1.816,2.007,2.172,2.342,2.524,2.68,2.834,3.415,3.749,4.002,3.951,3.879",
  "2026/7/8,1.18,1.433,1.59,1.843,2.039,2.198,2.368,2.552,2.705,2.856,3.445,3.798,4.056,3.998,3.936",
  "2026/7/9,1.183,1.444,1.599,1.851,2.039,2.204,2.372,2.561,2.714,2.866,3.449,3.795,4.065,4.013,3.962",
  ",,,,,,,,,,,,,,,",
  '"  ��If you cannot download the latest csv data, please clear the browser\'s cache and download again.",,,,,,,,,,,,,,,',
  "",
].join("\r\n");

describe("parseJgbCsv", () => {
  it("parse les observations et les renvoie récente en tête (source ascendante)", () => {
    const rows = parseJgbCsv(CSV_JP);
    expect(rows.length).toBe(3);
    expect(rows[0]!.date).toBe("2026/7/9");
    expect(rows[0]!.rendements["1 Yr"]).toBe(1.183);
    expect(rows[0]!.rendements["10 Yr"]).toBe(2.866);
    expect(rows[0]!.rendements["40 Yr"]).toBe(3.962);
    expect(rows[2]!.date).toBe("2026/7/7");
  });

  it("normalise les en-têtes « NY » en « N Yr » (axe commun)", () => {
    const rows = parseJgbCsv(CSV_JP);
    expect(rows[0]!.rendements["15 Yr"]).toBe(3.449);
    expect(rows[0]!.rendements["15Y"]).toBeUndefined();
  });

  it("écarte le pied de page Shift-JIS (Date non vide mais aucune maturité numérique)", () => {
    const rows = parseJgbCsv(CSV_JP);
    expect(rows.some((r) => r.date.includes("If you cannot download"))).toBe(false);
  });

  it("compatible deltaJour (variation 10 Yr : 2.866 − 2.856)", () => {
    expect(deltaJour(parseJgbCsv(CSV_JP), "10 Yr")).toBeCloseTo(0.01, 6);
  });

  it("entrée vide / sans en-tête « Date » → [] (dégradation gracieuse)", () => {
    expect(parseJgbCsv("")).toEqual([]);
    expect(parseJgbCsv("Foo,Bar\n1,2")).toEqual([]);
  });
});

// ─────────────────────────── Canada (BoC Valet API) ───────────────────────────

// Extrait RÉEL (www.bankofcanada.ca/valet, 2026-07) — `seriesDetail` tronqué (non lu),
// observations groupées par date, séries dans un ordre quelconque, valeurs en chaînes.
const JSON_CA = JSON.parse(`{
  "terms": { "url": "https://www.bankofcanada.ca/terms/" },
  "seriesDetail": { "BD.CDN.10YR.DQ.YLD": { "label": "Benchmark bond yield: 10 year" } },
  "observations": [
    {
      "d": "2026-07-08",
      "BD.CDN.7YR.DQ.YLD": { "v": "3.31" },
      "BD.CDN.10YR.DQ.YLD": { "v": "3.56" },
      "BD.CDN.2YR.DQ.YLD": { "v": "2.85" },
      "BD.CDN.3YR.DQ.YLD": { "v": "2.97" },
      "BD.CDN.5YR.DQ.YLD": { "v": "3.18" }
    },
    {
      "d": "2026-07-09",
      "BD.CDN.7YR.DQ.YLD": { "v": "3.26" },
      "BD.CDN.10YR.DQ.YLD": { "v": "3.52" },
      "BD.CDN.2YR.DQ.YLD": { "v": "2.80" },
      "BD.CDN.3YR.DQ.YLD": { "v": "2.91" },
      "BD.CDN.5YR.DQ.YLD": { "v": "3.12" }
    }
  ]
}`) as unknown;

describe("parseBocValetJson", () => {
  it("mappe les ids de série sur les maturités et trie récente en tête", () => {
    const rows = parseBocValetJson(JSON_CA);
    expect(rows.length).toBe(2);
    expect(rows[0]!.date).toBe("2026-07-09"); // trié même si la source est ascendante
    expect(rows[0]!.rendements["2 Yr"]).toBe(2.8);
    expect(rows[0]!.rendements["7 Yr"]).toBe(3.26);
    expect(rows[0]!.rendements["10 Yr"]).toBe(3.52);
    expect(rows[1]!.rendements["10 Yr"]).toBe(3.56);
  });

  it("compatible deltaJour (variation 10 Yr : 3.52 − 3.56)", () => {
    expect(deltaJour(parseBocValetJson(JSON_CA), "10 Yr")).toBeCloseTo(-0.04, 6);
  });

  it("omet les séries absentes ou non numériques d'une date", () => {
    const rows = parseBocValetJson({
      observations: [
        { d: "2026-07-09", "BD.CDN.2YR.DQ.YLD": { v: "2.80" }, "BD.CDN.10YR.DQ.YLD": { v: "NA" } },
      ],
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.rendements["2 Yr"]).toBe(2.8);
    expect(rows[0]!.rendements["10 Yr"]).toBeUndefined();
  });

  it("JSON inattendu → [] (dégradation gracieuse)", () => {
    expect(parseBocValetJson(null)).toEqual([]);
    expect(parseBocValetJson("texte")).toEqual([]);
    expect(parseBocValetJson({ observations: "pas un tableau" })).toEqual([]);
    expect(parseBocValetJson({ observations: [{ d: "2026-07-09" }] })).toEqual([]);
  });
});

// ─────────────────────────── Australie (RBA f2-data.csv) ───────────────────────────

// Extrait RÉEL (www.rba.gov.au, 2026-07) — BOM, titre, bloc de métadonnées (Description
// guillemetée avec virgules), en-tête « Series ID », ordre ASCENDANT, ligne courte de
// début d'historique (cellules vides, colonne indexée absente).
const CSV_AU = [
  "﻿F2 CAPITAL MARKET YIELDS – GOVERNMENT BONDS",
  "Title,Australian Government 2 year bond,Australian Government 3 year bond,Australian Government 5 year bond,Australian Government 10 year bond,Australian Government Indexed Bond",
  'Description,"Yields on Australian government bonds, interpolated, 2 years maturity","Yields on Australian government bonds, interpolated, 3 years maturity","Yields on Australian government bonds, interpolated, 5 years maturity","Yields on Australian government bonds, interpolated, 10 years maturity","Yields on Australian government indexed bonds, interpolated, 10 years maturity"',
  "Frequency,Daily,Daily,Daily,Daily,Daily",
  "Type,Original,Original,Original,Original,Original",
  "Units,Per cent per annum,Per cent per annum,Per cent per annum,Per cent per annum,Per cent per annum",
  "Source,RBA,RBA,RBA,RBA,RBA",
  "Publication date,10-Jul-2026,10-Jul-2026,10-Jul-2026,10-Jul-2026,10-Jul-2026",
  "Series ID,FCMYGBAG2D,FCMYGBAG3D,FCMYGBAG5D,FCMYGBAG10D,FCMYGBAGID",
  "20-May-2013,,,,3.229",
  "07-Jul-2026,4.442,4.412,4.458,4.833,2.505",
  "08-Jul-2026,4.487,4.461,4.512,4.893,2.545",
].join("\r\n");

describe("parseRbaF2Csv", () => {
  it("saute les métadonnées et renvoie les observations récente en tête", () => {
    const rows = parseRbaF2Csv(CSV_AU);
    expect(rows.length).toBe(3);
    expect(rows[0]!.date).toBe("08-Jul-2026");
    expect(rows[0]!.rendements["2 Yr"]).toBe(4.487);
    expect(rows[0]!.rendements["10 Yr"]).toBe(4.893);
    expect(rows[2]!.date).toBe("20-May-2013");
  });

  it("mappe l'obligation indexée sur son libellé dédié", () => {
    const rows = parseRbaF2Csv(CSV_AU);
    expect(rows[0]!.rendements[MATURITE_AU_INDEXEE]).toBe(2.545);
  });

  it("omet les cellules vides des lignes courtes de début d'historique", () => {
    const rows = parseRbaF2Csv(CSV_AU);
    const ancienne = rows[2]!;
    expect(ancienne.rendements["10 Yr"]).toBe(3.229);
    expect(ancienne.rendements["2 Yr"]).toBeUndefined();
    expect(ancienne.rendements[MATURITE_AU_INDEXEE]).toBeUndefined();
  });

  it("compatible deltaJour (variation 10 Yr : 4.893 − 4.833)", () => {
    expect(deltaJour(parseRbaF2Csv(CSV_AU), "10 Yr")).toBeCloseTo(0.06, 6);
  });

  it("entrée vide / sans ligne « Series ID » → [] (dégradation gracieuse)", () => {
    expect(parseRbaF2Csv("")).toEqual([]);
    expect(parseRbaF2Csv("Date,2 Yr\n08-Jul-2026,4.487")).toEqual([]);
  });
});
