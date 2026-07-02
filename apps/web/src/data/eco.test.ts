import { describe, expect, it } from "vitest";
import {
  chargerEvenementsEco,
  evenementsFomc,
  fusionnerEvenementsEco,
  impactPublicationFred,
  mapImpactFf,
  parseForexFactory,
  parseFredReleases,
  rangImpact,
  type EcoEvent,
} from "./eco";

describe("mapImpactFf", () => {
  it("mappe les libellés ForexFactory (insensible à la casse)", () => {
    expect(mapImpactFf("High")).toBe("high");
    expect(mapImpactFf("MEDIUM")).toBe("medium");
    expect(mapImpactFf("low")).toBe("low");
    expect(mapImpactFf("Holiday")).toBe("holiday");
  });
  it("tout libellé inconnu ou vide → low (jamais un marqueur fort)", () => {
    expect(mapImpactFf("")).toBe("low");
    expect(mapImpactFf(undefined)).toBe("low");
    expect(mapImpactFf("???")).toBe("low");
  });
});

describe("rangImpact", () => {
  it("ordonne fort > moyen > faible > férié", () => {
    expect(rangImpact("high")).toBeGreaterThan(rangImpact("medium"));
    expect(rangImpact("medium")).toBeGreaterThan(rangImpact("low"));
    expect(rangImpact("low")).toBeGreaterThan(rangImpact("holiday"));
  });
});

describe("parseForexFactory", () => {
  // Fixture inline : forme réelle du flux ff_calendar_thisweek.json.
  const fixture = [
    {
      title: "Core CPI m/m",
      country: "USD",
      date: "2026-06-30T08:30:00-04:00", // = 12:30 UTC
      impact: "High",
      forecast: "0.3%",
      previous: "0.2%",
      actual: "0.4%",
    },
    {
      title: "RBA Gov Bullock Speaks",
      country: "AUD",
      date: "2026-06-30T22:15:00-04:00",
      impact: "Medium",
      forecast: "",
      previous: "",
    },
    // Entrée invalide (sans date exploitable) → ignorée.
    { title: "Broken", country: "EUR", date: "pas-une-date", impact: "Low" },
    // Entrée sans titre → ignorée.
    { country: "GBP", date: "2026-07-01T04:00:00-04:00", impact: "Low" },
  ];

  it("parse les entrées valides et ignore les entrées cassées", () => {
    const out = parseForexFactory(fixture);
    expect(out).toHaveLength(2);
  });

  it("convertit l'ISO avec offset en epoch UTC correct", () => {
    const [cpi] = parseForexFactory(fixture);
    expect(cpi?.time).toBe(Date.parse("2026-06-30T12:30:00Z"));
  });

  it("mappe l'impact et conserve forecast/previous/actual non vides", () => {
    const [cpi, rba] = parseForexFactory(fixture);
    expect(cpi?.impact).toBe("high");
    expect(cpi?.forecast).toBe("0.3%");
    expect(cpi?.previous).toBe("0.2%");
    expect(cpi?.actual).toBe("0.4%");
    // Chaînes vides → undefined.
    expect(rba?.forecast).toBeUndefined();
    expect(rba?.previous).toBeUndefined();
    expect(rba?.source).toBe("forexfactory");
    expect(rba?.country).toBe("AUD");
  });

  it("renvoie [] pour une entrée non-tableau", () => {
    expect(parseForexFactory(null)).toEqual([]);
    expect(parseForexFactory({})).toEqual([]);
  });
});

describe("impactPublicationFred", () => {
  it("assigne l'impact curé par motif (sous-chaîne, insensible à la casse)", () => {
    expect(impactPublicationFred("Consumer Price Index")).toBe("high");
    expect(impactPublicationFred("Employment Situation")).toBe("high");
    expect(impactPublicationFred("Producer Price Index")).toBe("medium");
    expect(impactPublicationFred("Industrial Production and Capacity Utilization")).toBe("low");
  });
  it("renvoie null hors périmètre curé (bruit ignoré)", () => {
    expect(impactPublicationFred("Some Obscure Regional Survey")).toBeNull();
  });
});

describe("parseFredReleases", () => {
  const fixture = {
    release_dates: [
      { release_id: 10, release_name: "Consumer Price Index", date: "2026-08-12" },
      { release_id: 50, release_name: "Producer Price Index", date: "2026-08-13" },
      { release_id: 99, release_name: "Obscure Survey", date: "2026-08-14" }, // non curé → ignoré
      { release_id: 11, release_name: "Employment Situation", date: "mauvaise" }, // date KO → ignoré
    ],
  };

  it("ne retient que les publications curées, avec impact assigné", () => {
    const out = parseFredReleases(fixture);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.impact)).toEqual(["high", "medium"]);
  });

  it("ancre l'heure (date seule → 12:30 UTC) et marque timeApprox", () => {
    const [cpi] = parseFredReleases(fixture);
    expect(cpi?.time).toBe(Date.parse("2026-08-12T12:30:00Z"));
    expect(cpi?.timeApprox).toBe(true);
    expect(cpi?.country).toBe("USD");
    expect(cpi?.source).toBe("fred");
  });

  it("renvoie [] sans release_dates", () => {
    expect(parseFredReleases(null)).toEqual([]);
    expect(parseFredReleases({})).toEqual([]);
  });
});

describe("evenementsFomc", () => {
  it("produit des décisions USD fort impact, heure approx.", () => {
    const out = evenementsFomc();
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((e) => e.impact === "high" && e.country === "USD" && e.source === "fomc")).toBe(
      true
    );
    expect(out.every((e) => e.timeApprox === true)).toBe(true);
    // Première décision 2026 : 2026-01-28 à 18:30 UTC.
    expect(out[0]?.time).toBe(Date.parse("2026-01-28T18:30:00Z"));
  });
  it("des identifiants uniques", () => {
    const ids = evenementsFomc().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("fusionnerEvenementsEco", () => {
  const ev = (
    source: EcoEvent["source"],
    iso: string,
    title: string,
    country = "USD",
    impact: EcoEvent["impact"] = "high"
  ): EcoEvent => {
    const time = Date.parse(iso);
    return { id: `${source}:${time}:${title}`, time, country, title, impact, source };
  };

  it("écarte les entrées FRED/FOMC tombant un jour DÉJÀ couvert par ForexFactory", () => {
    const ff = [ev("forexfactory", "2026-06-30T12:30:00Z", "CPI")];
    const fred = [
      ev("fred", "2026-06-30T12:30:00Z", "CPI-dup"), // même jour que FF → écarté
      ev("fred", "2026-08-15T12:30:00Z", "GDP"), // au-delà → conservé
    ];
    const fomc = [
      ev("fomc", "2026-06-30T18:30:00Z", "FOMC-meme-jour"), // même jour FF → écarté
      ev("fomc", "2026-12-09T18:30:00Z", "FOMC-futur"), // au-delà → conservé
    ];
    const out = fusionnerEvenementsEco(ff, fred, fomc);
    expect(out.map((e) => e.title)).toEqual(["CPI", "GDP", "FOMC-futur"]);
  });

  it("trie chronologiquement (ascendant)", () => {
    const out = fusionnerEvenementsEco(
      [ev("forexfactory", "2026-05-10T00:00:00Z", "B")],
      [ev("fred", "2026-04-01T12:30:00Z", "A")],
      [ev("fomc", "2026-07-29T18:30:00Z", "C")]
    );
    const temps = out.map((e) => e.time);
    expect(temps).toEqual([...temps].sort((a, b) => a - b));
    expect(out.map((e) => e.title)).toEqual(["A", "B", "C"]);
  });

  it("dédoublonne par id", () => {
    const dup = ev("fred", "2026-09-01T12:30:00Z", "X");
    const out = fusionnerEvenementsEco([], [dup, dup], []);
    expect(out).toHaveLength(1);
  });

  it("ff vide → conserve toutes les sources FRED/FOMC (dégradation gracieuse)", () => {
    const fred = [ev("fred", "2026-08-15T12:30:00Z", "GDP")];
    const fomc = evenementsFomc();
    const out = fusionnerEvenementsEco([], fred, fomc);
    expect(out).toHaveLength(fred.length + fomc.length);
  });
});

describe("chargerEvenementsEco (sans réseau / sans localStorage)", () => {
  it("dégrade proprement : renvoie au moins les dates FOMC statiques", async () => {
    // En env node : fetch échoue (hôte injoignable) → FF/FRED vides, pas de cache →
    // fusion = FOMC statique. Aucune exception propagée.
    const r = await chargerEvenementsEco({ force: true });
    expect(Array.isArray(r.events)).toBe(true);
    expect(r.events.some((e) => e.source === "fomc")).toBe(true);
  });
});
