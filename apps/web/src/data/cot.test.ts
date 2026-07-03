import { describe, expect, it } from "vitest";
import {
  CATEGORIES_COT,
  WATCHLIST_COT,
  nombreCot,
  pointCot,
  resumerCot,
  type InstrumentCot,
} from "./cot";

describe("nombreCot", () => {
  it("parse une chaîne numérique CFTC", () => {
    expect(nombreCot("16348")).toBe(16348);
    expect(nombreCot("-1379")).toBe(-1379);
    expect(nombreCot(" 217028 ")).toBe(217028);
  });
  it("conserve un nombre déjà fini", () => {
    expect(nombreCot(42)).toBe(42);
  });
  it("renvoie NaN pour vide / non numérique / non chaîne (« » ne devient PAS 0)", () => {
    expect(nombreCot("")).toBeNaN();
    expect(nombreCot("   ")).toBeNaN();
    expect(nombreCot("abc")).toBeNaN();
    expect(nombreCot(undefined)).toBeNaN();
    expect(nombreCot(null)).toBeNaN();
    expect(nombreCot(Number.NaN)).toBeNaN();
  });
});

describe("pointCot", () => {
  // Fixture calquée sur la forme réelle du dataset 6dca-aqww (champs en chaînes).
  const brut = {
    market_and_exchange_names: "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: "2026-06-23T00:00:00.000",
    noncomm_positions_long_all: "16348",
    noncomm_positions_short_all: "12824",
    open_interest_all: "20554",
    // champ superflu ignoré
    contract_market_name: "BITCOIN",
  };

  it("calcule le net spéculatif (longs − shorts) et conserve l'OI", () => {
    const pt = pointCot(brut);
    expect(pt).not.toBeNull();
    expect(pt?.net).toBe(16348 - 12824);
    expect(pt?.openInterest).toBe(20554);
    expect(pt?.dateRapport).toBe(Date.parse("2026-06-23T00:00:00.000"));
  });

  it("renvoie null si le nom est absent", () => {
    expect(pointCot({ ...brut, market_and_exchange_names: undefined })).toBeNull();
    expect(pointCot({ ...brut, market_and_exchange_names: "" })).toBeNull();
  });

  it("renvoie null si la date est inexploitable", () => {
    expect(pointCot({ ...brut, report_date_as_yyyy_mm_dd: "pas-une-date" })).toBeNull();
  });

  it("renvoie null si une position long/short est vide ou manquante", () => {
    expect(pointCot({ ...brut, noncomm_positions_long_all: "" })).toBeNull();
    expect(pointCot({ ...brut, noncomm_positions_short_all: undefined })).toBeNull();
  });

  it("tolère un open interest absent (OI = NaN, point conservé)", () => {
    const pt = pointCot({ ...brut, open_interest_all: "" });
    expect(pt).not.toBeNull();
    expect(pt?.net).toBe(3524);
    expect(pt?.openInterest).toBeNaN();
  });

  it("ignore une entrée non-objet", () => {
    expect(pointCot(null)).toBeNull();
    expect(pointCot("nope")).toBeNull();
  });
});

describe("resumerCot", () => {
  const OR = "GOLD - COMMODITY EXCHANGE INC.";
  const BTC = "BITCOIN - CHICAGO MERCANTILE EXCHANGE";

  /** Construit un enregistrement brut minimal. */
  function rec(nom: string, date: string, long: number, short: number, oi = 0) {
    return {
      market_and_exchange_names: nom,
      report_date_as_yyyy_mm_dd: date,
      noncomm_positions_long_all: String(long),
      noncomm_positions_short_all: String(short),
      open_interest_all: String(oi),
    };
  }

  // Deux instruments suivis, deux semaines chacun (ordre volontairement mélangé), plus un
  // instrument NON curé qui doit être ignoré.
  const records = [
    rec(OR, "2026-06-16T00:00:00.000", 211127, 30907, 339330), // précédent
    rec(BTC, "2026-06-23T00:00:00.000", 16348, 12824, 20554), // dernier
    rec("GULF # 6 FUEL OIL CRACK - NEW YORK MERCANTILE EXCHANGE", "2026-06-23T00:00:00.000", 1655, 2282),
    rec(OR, "2026-06-23T00:00:00.000", 217028, 35689, 352167), // dernier
    rec(BTC, "2026-06-16T00:00:00.000", 17727, 14252, 21000), // précédent
  ];

  it("ne retient que les instruments de la watchlist (ignore le non-curé)", () => {
    const { lignes } = resumerCot(records);
    const noms = lignes.map((l) => l.nom);
    expect(noms).toContain(OR);
    expect(noms).toContain(BTC);
    expect(noms).not.toContain("GULF # 6 FUEL OIL CRACK - NEW YORK MERCANTILE EXCHANGE");
  });

  it("retient le DERNIER rapport pour le net et l'OI", () => {
    const { lignes } = resumerCot(records);
    const or = lignes.find((l) => l.nom === OR);
    expect(or?.net).toBe(217028 - 35689); // = 181339
    expect(or?.openInterest).toBe(352167);
    expect(or?.dateRapport).toBe(Date.parse("2026-06-23T00:00:00.000"));
  });

  it("calcule la variation hebdo (net dernier − net précédent)", () => {
    const { lignes } = resumerCot(records);
    const or = lignes.find((l) => l.nom === OR);
    const btc = lignes.find((l) => l.nom === BTC);
    // Or : (217028−35689) − (211127−30907) = 181339 − 180220 = +1119
    expect(or?.delta).toBe(1119);
    // BTC : (16348−12824) − (17727−14252) = 3524 − 3475 = +49
    expect(btc?.delta).toBe(49);
  });

  it("delta null quand une seule semaine est disponible", () => {
    const { lignes } = resumerCot([rec(BTC, "2026-06-23T00:00:00.000", 16348, 12824, 20554)]);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.delta).toBeNull();
  });

  it("dateRapport = date du dernier rapport publié (max)", () => {
    const { dateRapport } = resumerCot(records);
    expect(dateRapport).toBe(Date.parse("2026-06-23T00:00:00.000"));
  });

  it("préserve l'ordre de la watchlist (regroupement par famille contigu)", () => {
    const watchlist: InstrumentCot[] = [
      { nom: BTC, libelle: "Bitcoin", categorie: "crypto" },
      { nom: OR, libelle: "Or", categorie: "metal" },
    ];
    const { lignes } = resumerCot(records, watchlist);
    expect(lignes.map((l) => l.nom)).toEqual([BTC, OR]);
  });

  it("renvoie un résumé vide (dateRapport null) sur entrée non-tableau ou vide", () => {
    expect(resumerCot(null)).toEqual({ lignes: [], dateRapport: null });
    expect(resumerCot([])).toEqual({ lignes: [], dateRapport: null });
  });
});

describe("WATCHLIST_COT / CATEGORIES_COT (cohérence de curation)", () => {
  it("aucun doublon de nom d'instrument", () => {
    const noms = WATCHLIST_COT.map((i) => i.nom);
    expect(new Set(noms).size).toBe(noms.length);
  });
  it("chaque instrument appartient à une famille déclarée", () => {
    const familles = new Set(CATEGORIES_COT.map((c) => c.id));
    for (const i of WATCHLIST_COT) expect(familles.has(i.categorie)).toBe(true);
  });
});
