import { describe, expect, it } from "vitest";
import {
  assemblerCategorie,
  datasetsRequis,
  type LigneCotCategorie,
} from "./cot";
import { resumerCot, type DatasetCot, type InstrumentCot } from "../data/cot";

// ─────────────────────────── Fixtures : constructeurs d'enregistrements bruts par dataset ───────────────────────────

const OR = "GOLD - COMMODITY EXCHANGE INC.";
const WTI = "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE";
const EUR = "EURO FX - CHICAGO MERCANTILE EXCHANGE";
const SP = "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE";
const BTC = "BITCOIN - CHICAGO MERCANTILE EXCHANGE";

/** Enregistrement Legacy (6dca-aqww) : non-commercial (net1) + commercial (net2). */
function recLegacy(nom: string, date: string, ncL: number, ncS: number, cL: number, cS: number, oi = 0) {
  return {
    market_and_exchange_names: nom,
    report_date_as_yyyy_mm_dd: date,
    noncomm_positions_long_all: String(ncL),
    noncomm_positions_short_all: String(ncS),
    comm_positions_long_all: String(cL),
    comm_positions_short_all: String(cS),
    open_interest_all: String(oi),
  };
}

/** Enregistrement Disaggregated (72hh-3qpy) : Managed Money (net1) + Producer/Merchant (net2). */
function recDisagg(nom: string, date: string, mmL: number, mmS: number, pmL: number, pmS: number, oi = 0) {
  return {
    market_and_exchange_names: nom,
    report_date_as_yyyy_mm_dd: date,
    m_money_positions_long_all: String(mmL),
    m_money_positions_short_all: String(mmS),
    prod_merc_positions_long: String(pmL),
    prod_merc_positions_short: String(pmS),
    open_interest_all: String(oi),
  };
}

/** Enregistrement TFF (gpe5-46if) : Leveraged Funds (net1) + Asset Manager (net2). */
function recTff(nom: string, date: string, lvL: number, lvS: number, amL: number, amS: number, oi = 0) {
  return {
    market_and_exchange_names: nom,
    report_date_as_yyyy_mm_dd: date,
    lev_money_positions_long: String(lvL),
    lev_money_positions_short: String(lvS),
    asset_mgr_positions_long: String(amL),
    asset_mgr_positions_short: String(amS),
    open_interest_all: String(oi),
  };
}

const D1 = "2026-06-16T00:00:00.000";
const D2 = "2026-06-23T00:00:00.000";

// ─────────────────────────── datasetsRequis ───────────────────────────

describe("datasetsRequis (datasets à charger pour une catégorie)", () => {
  it("legacy → uniquement le dataset legacy", () => {
    expect(datasetsRequis("legacy")).toEqual(["legacy"]);
  });
  it("fonds → disaggregated (matières premières) ET tff (financiers)", () => {
    expect([...datasetsRequis("fonds")].sort()).toEqual(["disaggregated", "tff"]);
  });
  it("commerciaux → disaggregated ET tff (même routage que fonds)", () => {
    expect([...datasetsRequis("commerciaux")].sort()).toEqual(["disaggregated", "tff"]);
  });
});

// ─────────────────────────── assemblerCategorie ───────────────────────────

describe("assemblerCategorie", () => {
  it("legacy : toutes les lignes viennent du dataset legacy (net1 = non-commercial), aucune non couverte", () => {
    const watchlist: InstrumentCot[] = [
      { nom: OR, libelle: "Or", categorie: "metal" },
      { nom: BTC, libelle: "Bitcoin", categorie: "crypto" },
    ];
    const records: Partial<Record<DatasetCot, unknown>> = {
      legacy: [
        recLegacy(OR, D1, 211127, 30907, 100, 200, 339330),
        recLegacy(OR, D2, 217028, 35689, 100, 200, 352167),
        recLegacy(BTC, D2, 16348, 12824, 50, 80, 20554),
      ],
    };
    const { lignes } = assemblerCategorie(records, "legacy", watchlist);
    expect(lignes.every((l) => !l.nonCouvert)).toBe(true);
    const or = lignes.find((l) => l.nom === OR)!;
    expect(or.net).toBe(217028 - 35689); // dernier rapport, net1 legacy
    expect(or.delta).toBe(217028 - 35689 - (211127 - 30907));
    expect(or.openInterest).toBe(352167);
    expect(or.serie).toHaveLength(2);
  });

  it("legacy : équivalent à resumerCot pour les instruments couverts (non-régression)", () => {
    const watchlist: InstrumentCot[] = [
      { nom: OR, libelle: "Or", categorie: "metal" },
      { nom: BTC, libelle: "Bitcoin", categorie: "crypto" },
    ];
    const records = [
      recLegacy(OR, D1, 211127, 30907, 100, 200, 339330),
      recLegacy(OR, D2, 217028, 35689, 100, 200, 352167),
      recLegacy(BTC, D1, 17727, 14252, 0, 0, 21000),
      recLegacy(BTC, D2, 16348, 12824, 0, 0, 20554),
    ];
    const attendu = resumerCot(records, watchlist);
    const { lignes, dateRapport } = assemblerCategorie({ legacy: records }, "legacy", watchlist);
    expect(dateRapport).toBe(attendu.dateRapport);
    for (const ref of attendu.lignes) {
      const l = lignes.find((x) => x.nom === ref.nom)!;
      expect(l.net).toBe(ref.net);
      expect(l.delta).toBe(ref.delta);
      expect(l.openInterest).toBe(ref.openInterest);
      expect(l.dateRapport).toBe(ref.dateRapport);
      expect(l.serie).toEqual(ref.serie);
    }
  });

  it("fonds : metal/energie ← Managed Money (disaggregated), fx/indice/crypto ← Leveraged Funds (tff)", () => {
    const watchlist: InstrumentCot[] = [
      { nom: OR, libelle: "Or", categorie: "metal" },
      { nom: EUR, libelle: "EUR", categorie: "fx" },
    ];
    const records: Partial<Record<DatasetCot, unknown>> = {
      disaggregated: [recDisagg(OR, D2, 180000, 40000, 90000, 150000, 500000)],
      tff: [recTff(EUR, D2, 120000, 90000, 200000, 50000, 700000)],
    };
    const { lignes } = assemblerCategorie(records, "fonds", watchlist);
    const or = lignes.find((l) => l.nom === OR)!;
    const eur = lignes.find((l) => l.nom === EUR)!;
    expect(or.net).toBe(180000 - 40000); // Managed Money
    expect(eur.net).toBe(120000 - 90000); // Leveraged Funds
    expect(or.nonCouvert).toBe(false);
    expect(eur.nonCouvert).toBe(false);
  });

  it("commerciaux : metal ← Producer/Merchant (net2 disagg), fx ← Asset Manager (net2 tff)", () => {
    const watchlist: InstrumentCot[] = [
      { nom: OR, libelle: "Or", categorie: "metal" },
      { nom: EUR, libelle: "EUR", categorie: "fx" },
    ];
    const records: Partial<Record<DatasetCot, unknown>> = {
      disaggregated: [recDisagg(OR, D2, 180000, 40000, 90000, 150000, 500000)],
      tff: [recTff(EUR, D2, 120000, 90000, 200000, 50000, 700000)],
    };
    const { lignes } = assemblerCategorie(records, "commerciaux", watchlist);
    expect(lignes.find((l) => l.nom === OR)!.net).toBe(90000 - 150000); // Producer/Merchant
    expect(lignes.find((l) => l.nom === EUR)!.net).toBe(200000 - 50000); // Asset Manager
  });

  it("routage par FAMILLE d'instrument, jamais par présence dans un dataset : un fx présent dans le disaggregated est ignoré, sa série vient du tff", () => {
    const watchlist: InstrumentCot[] = [
      { nom: OR, libelle: "Or", categorie: "metal" },
      { nom: EUR, libelle: "EUR", categorie: "fx" },
    ];
    // Piège : le dataset disaggregated contient AUSSI un enregistrement au nom d'EUR (net trompeur).
    const records: Partial<Record<DatasetCot, unknown>> = {
      disaggregated: [
        recDisagg(OR, D2, 180000, 40000, 90000, 150000, 500000),
        recDisagg(EUR, D2, 999999, 0, 0, 0, 1), // piège : ne doit PAS servir EUR
      ],
      tff: [recTff(EUR, D2, 120000, 90000, 200000, 50000, 700000)],
    };
    const eur = assemblerCategorie(records, "fonds", watchlist).lignes.find((l) => l.nom === EUR)!;
    expect(eur.net).toBe(120000 - 90000); // tff, pas le piège disaggregated
  });

  it("nonCouvert : instrument absent des records de son dataset → stub marqué, série vide, delta null", () => {
    const watchlist: InstrumentCot[] = [
      { nom: OR, libelle: "Or", categorie: "metal" },
      { nom: BTC, libelle: "Bitcoin", categorie: "crypto" },
    ];
    // BTC (crypto → tff) absent des records tff ⇒ non couvert.
    const records: Partial<Record<DatasetCot, unknown>> = {
      disaggregated: [recDisagg(OR, D2, 180000, 40000, 90000, 150000, 500000)],
      tff: [],
    };
    const { lignes } = assemblerCategorie(records, "fonds", watchlist);
    const btc = lignes.find((l) => l.nom === BTC)!;
    expect(btc.nonCouvert).toBe(true);
    expect(btc.serie).toEqual([]);
    expect(btc.delta).toBeNull();
    expect(lignes.find((l) => l.nom === OR)!.nonCouvert).toBe(false);
  });

  it("dataset entièrement absent (clé manquante) → tous ses instruments non couverts", () => {
    const watchlist: InstrumentCot[] = [
      { nom: OR, libelle: "Or", categorie: "metal" },
      { nom: EUR, libelle: "EUR", categorie: "fx" },
    ];
    // Aucune clé tff ⇒ EUR non couvert ; disaggregated présent ⇒ OR couvert.
    const records: Partial<Record<DatasetCot, unknown>> = {
      disaggregated: [recDisagg(OR, D2, 180000, 40000, 90000, 150000, 500000)],
    };
    const { lignes } = assemblerCategorie(records, "fonds", watchlist);
    expect(lignes.find((l) => l.nom === EUR)!.nonCouvert).toBe(true);
    expect(lignes.find((l) => l.nom === OR)!.nonCouvert).toBe(false);
  });

  it("préserve l'ordre de la watchlist, stubs non couverts inclus à leur place", () => {
    const watchlist: InstrumentCot[] = [
      { nom: EUR, libelle: "EUR", categorie: "fx" },
      { nom: OR, libelle: "Or", categorie: "metal" },
      { nom: SP, libelle: "S&P 500", categorie: "indice" },
    ];
    const records: Partial<Record<DatasetCot, unknown>> = {
      disaggregated: [recDisagg(OR, D2, 180000, 40000, 90000, 150000, 500000)],
      tff: [recTff(EUR, D2, 120000, 90000, 200000, 50000, 700000)], // SP absent → stub
    };
    const noms = assemblerCategorie(records, "fonds", watchlist).lignes.map((l) => l.nom);
    expect(noms).toEqual([EUR, OR, SP]);
  });

  it("dateRapport = max des lignes COUVERTES ; null si aucune couverte", () => {
    const watchlist: InstrumentCot[] = [
      { nom: OR, libelle: "Or", categorie: "metal" },
      { nom: WTI, libelle: "WTI", categorie: "energie" },
    ];
    const couverts: Partial<Record<DatasetCot, unknown>> = {
      disaggregated: [
        recDisagg(OR, D1, 1, 0, 0, 0, 1),
        recDisagg(WTI, D2, 1, 0, 0, 0, 1),
      ],
    };
    expect(assemblerCategorie(couverts, "fonds", watchlist).dateRapport).toBe(Date.parse(D2));
    // Aucun record ⇒ toutes non couvertes ⇒ dateRapport null.
    expect(assemblerCategorie({}, "fonds", watchlist).dateRapport).toBeNull();
  });

  it("série triée chrono croissante même si les records arrivent en ordre DESC", () => {
    const watchlist: InstrumentCot[] = [{ nom: OR, libelle: "Or", categorie: "metal" }];
    const records: Partial<Record<DatasetCot, unknown>> = {
      disaggregated: [
        recDisagg(OR, D2, 200, 50, 0, 0, 2),
        recDisagg(OR, D1, 100, 30, 0, 0, 1),
      ],
    };
    const or: LigneCotCategorie = assemblerCategorie(records, "fonds", watchlist).lignes[0]!;
    expect(or.serie.map((p) => p.t)).toEqual([Date.parse(D1), Date.parse(D2)]);
    expect(or.net).toBe(200 - 50); // dernier chrono
    expect(or.delta).toBe(200 - 50 - (100 - 30));
  });
});
