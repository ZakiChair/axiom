/**
 * Tests purs du menu alerte prix (lot B4) — extraction, format, items, arrondi
 * via helpers exportés (pas de DOM / KLineChart).
 */
import { describe, expect, it } from "vitest";
import {
  extrairePrixPixel,
  formaterNiveauCourt,
  itemsMenuAlertePrix,
} from "./priceAlertMenu";
import { alertePrixAuNiveau, arrondirNiveauAlerte } from "../store/alerts";

describe("extrairePrixPixel", () => {
  it("extrait une valeur finie", () => {
    expect(extrairePrixPixel({ value: 100.5 })).toBe(100.5);
  });

  it("rejette absent / non fini", () => {
    expect(extrairePrixPixel(undefined)).toBeNull();
    expect(extrairePrixPixel(null)).toBeNull();
    expect(extrairePrixPixel({})).toBeNull();
    expect(extrairePrixPixel({ value: Number.NaN })).toBeNull();
    expect(extrairePrixPixel({ value: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("itemsMenuAlertePrix", () => {
  it("propose hausse, baisse, les-deux dans cet ordre", () => {
    const items = itemsMenuAlertePrix(42_000);
    expect(items.map((i) => i.sens)).toEqual(["hausse", "baisse", "les-deux"]);
    expect(items[0]?.label).toMatch(/↑/);
    expect(items[1]?.label).toMatch(/↓/);
    expect(items[2]?.label).toMatch(/↕/);
    for (const it of items) {
      expect(it.label).toContain("42");
    }
  });
});

describe("formaterNiveauCourt", () => {
  it("formate grands / moyens / petits prix", () => {
    expect(formaterNiveauCourt(42150.12)).toMatch(/42/);
    expect(formaterNiveauCourt(1.2345)).toMatch(/1\.2345/);
    expect(formaterNiveauCourt(0.001234)).toMatch(/0\.001/);
  });
});

describe("pipeline clic → NouvelleAlerte", () => {
  it("arrondit puis construit une def prix-croise cohérente", () => {
    const brut = 42150.123456789;
    const niveau = arrondirNiveauAlerte(brut);
    const a = alertePrixAuNiveau("btcusdt", "binance", niveau, "hausse");
    expect(a.condition.type).toBe("prix-croise");
    if (a.condition.type === "prix-croise") {
      expect(a.condition.niveau).toBe(niveau);
      expect(a.condition.sens).toBe("hausse");
    }
  });
});
