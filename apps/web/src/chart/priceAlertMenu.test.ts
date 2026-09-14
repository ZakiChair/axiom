/**
 * Tests purs du menu alerte prix (lot B4) — extraction, format, items, arrondi
 * via helpers exportés (pas de DOM / KLineChart).
 */
import { describe, expect, it } from "vitest";
import {
  extrairePrixPixel,
  formaterNiveauCourt,
  itemsMenuAlertePrix,
  ligneAccrochee,
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
  it("délègue à formatPrice : décimales adaptées à la magnitude (2/4/6)", () => {
    expect(formaterNiveauCourt(42150.12)).toBe("42,150.12");
    expect(formaterNiveauCourt(0.2345)).toBe("0.2345");
    expect(formaterNiveauCourt(0.0013)).toBe("0.001300");
  });

  it("niveau ≤ 0 (échelle percentage) : format signé, jamais « — »", () => {
    // En échelle %, convertFromPixel renvoie un pourcentage — un clic sous 0 est
    // légitime et l'alerte créée est correcte : le libellé doit suivre.
    expect(formaterNiveauCourt(-2.34)).toBe("−2.34");
    expect(formaterNiveauCourt(0)).toBe("0.00");
    expect(formaterNiveauCourt(-0.0013)).toBe("−0.001300");
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

describe("ligneAccrochee — clic droit près d'une ligne de niveau (lot A)", () => {
  const pdh = { price: 77_450, label: "PDH" };
  const pwh = { price: 80_443.99, label: "PWH" };
  const oj = { price: 76_842.01, label: "PDC·OJ·OS" };

  it("dans la tolérance : renvoie la ligne la plus proche", () => {
    const candidats = [
      { y: 100, ligne: pwh },
      { y: 205, ligne: pdh },
      { y: 210, ligne: oj },
    ];
    expect(ligneAccrochee(207, candidats)).toBe(pdh);
    expect(ligneAccrochee(209, candidats)).toBe(oj);
    expect(ligneAccrochee(96, candidats)).toBe(pwh);
  });

  it("hors tolérance (6 px par défaut, réglable) : null", () => {
    const candidats = [{ y: 100, ligne: pdh }];
    expect(ligneAccrochee(106, candidats)).toBe(pdh);
    expect(ligneAccrochee(106.5, candidats)).toBeNull();
    expect(ligneAccrochee(110, candidats, 10)).toBe(pdh);
  });

  it("égalité de distance : la première ligne gagne ; liste vide : null", () => {
    expect(ligneAccrochee(105, [{ y: 100, ligne: pdh }, { y: 110, ligne: pwh }])).toBe(pdh);
    expect(ligneAccrochee(105, [])).toBeNull();
  });

  it("Y non fini ignoré", () => {
    expect(ligneAccrochee(100, [{ y: Number.NaN, ligne: pdh }])).toBeNull();
  });

  it("l'alerte créée depuis une ligne porte le niveau exact et le libellé en message", () => {
    const a = alertePrixAuNiveau("BTCUSDT", "binance", pdh.price, "hausse", "PDH BTCUSDT");
    expect(a.message).toBe("PDH BTCUSDT");
    expect(a.condition).toEqual({ type: "prix-croise", niveau: 77_450, sens: "hausse" });
  });
});
