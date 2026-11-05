import { describe, expect, it } from "vitest";
import {
  CATEGORIES_GRAPHE,
  LIGNES_DECOUVERTE,
  bilanCoherence,
  cheminSocrata,
  colonnesPresentes,
  compacterSerie,
  construireRequeteDecouverte,
  construireRequeteHistorique,
  datasetGraphe,
  dateRapportSuivant,
  decompacterSerie,
  expositionDerniere,
  finValiditeHistorique,
  historiqueAJour,
  instrumentCot,
  netCategorie,
  parserHistorique,
  prochainePublicationCot,
  rapportEnRetard,
  resoudreColonnes,
  sommeNets,
  RELANCE_MIN_MS,
  type ColonnesResolues,
} from "./cotHistorique";

const EUR = "EURO FX - CHICAGO MERCANTILE EXCHANGE";

/** Colonnes d'un enregistrement TFF de fixture (noms candidats, la logique est testée ici). */
const COLONNES_TFF = [
  "market_and_exchange_names",
  "report_date_as_yyyy_mm_dd",
  "open_interest_all",
  "dealer_positions_long_all",
  "dealer_positions_short_all",
  "asset_mgr_positions_long",
  "asset_mgr_positions_short",
  "lev_money_positions_long",
  "lev_money_positions_short",
  "other_rept_positions_long",
  "other_rept_positions_short",
  "nonrept_positions_long_all",
  "nonrept_positions_short_all",
];

type Paire = [number, number];

/**
 * Enregistrement TFF COHÉRENT : Σ longs = Σ shorts (hors spreads), OI = Σ longs + spreads.
 * Les nombres arrivent en chaînes, comme chez Socrata.
 */
function recTff(date: string, p: { dealer: Paire; am: Paire; lev: Paire; autres: Paire; nr: Paire }, spreads = 50) {
  const oi = p.dealer[0] + p.am[0] + p.lev[0] + p.autres[0] + p.nr[0] + spreads;
  return {
    market_and_exchange_names: EUR,
    report_date_as_yyyy_mm_dd: `${date}T00:00:00.000`,
    open_interest_all: String(oi),
    dealer_positions_long_all: String(p.dealer[0]),
    dealer_positions_short_all: String(p.dealer[1]),
    asset_mgr_positions_long: String(p.am[0]),
    asset_mgr_positions_short: String(p.am[1]),
    lev_money_positions_long: String(p.lev[0]),
    lev_money_positions_short: String(p.lev[1]),
    other_rept_positions_long: String(p.autres[0]),
    other_rept_positions_short: String(p.autres[1]),
    nonrept_positions_long_all: String(p.nr[0]),
    nonrept_positions_short_all: String(p.nr[1]),
  };
}

const BASE = { dealer: [50, 300] as Paire, am: [400, 100] as Paire, lev: [150, 250] as Paire, autres: [80, 60] as Paire, nr: [70, 40] as Paire };

function colonnesTff(): ColonnesResolues {
  return resoudreColonnes("tff", new Set(COLONNES_TFF));
}

describe("routage du rapport tracé", () => {
  it("financiers → TFF, matières premières → Disaggregated, Legacy sur demande", () => {
    expect(datasetGraphe("fx", "detaille")).toBe("tff");
    expect(datasetGraphe("indice", "detaille")).toBe("tff");
    expect(datasetGraphe("crypto", "detaille")).toBe("tff");
    expect(datasetGraphe("metal", "detaille")).toBe("disaggregated");
    expect(datasetGraphe("energie", "detaille")).toBe("disaggregated");
    for (const f of ["fx", "indice", "metal", "energie", "crypto"] as const) {
      expect(datasetGraphe(f, "legacy")).toBe("legacy");
    }
  });

  it("chaque rapport couvre toutes ses catégories, non déclarants compris", () => {
    expect(CATEGORIES_GRAPHE.tff.map((c) => c.id)).toEqual(["dealer", "asset_mgr", "lev_money", "other_rept", "nonrept"]);
    expect(CATEGORIES_GRAPHE.disaggregated.map((c) => c.id)).toEqual(["prod_merc", "swap", "m_money", "other_rept", "nonrept"]);
    expect(CATEGORIES_GRAPHE.legacy.map((c) => c.id)).toEqual(["comm", "noncomm", "nonrept"]);
  });

  it("les paires déjà vérifiées en direct restent les premiers candidats", () => {
    const am = CATEGORIES_GRAPHE.tff.find((c) => c.id === "asset_mgr")!;
    expect(am.long[0]).toBe("asset_mgr_positions_long");
    const mm = CATEGORIES_GRAPHE.disaggregated.find((c) => c.id === "m_money")!;
    expect(mm.long[0]).toBe("m_money_positions_long_all");
    const nc = CATEGORIES_GRAPHE.legacy.find((c) => c.id === "noncomm")!;
    expect([nc.long[0], nc.short[0]]).toEqual(["noncomm_positions_long_all", "noncomm_positions_short_all"]);
  });

  it("retrouve un instrument par son nom CFTC exact", () => {
    expect(instrumentCot(EUR)?.libelle).toBe("Euro (EUR)");
    expect(instrumentCot("INCONNU")).toBeNull();
  });
});

describe("colonnes vérifiées contre la réponse réelle", () => {
  it("union des clés de plusieurs lignes (Socrata omet les clés nulles)", () => {
    const cles = colonnesPresentes([{ a: "1" }, { b: "2" }, null, "x", [1]]);
    expect([...cles].sort()).toEqual(["a", "b"]);
    expect(colonnesPresentes("pas un tableau").size).toBe(0);
  });

  it("résout toutes les catégories TFF quand leurs colonnes sont présentes", () => {
    const c = colonnesTff();
    expect(c.oi).toBe("open_interest_all");
    expect(c.categories.every((x) => x !== null)).toBe(true);
    expect(c.categories[0]).toEqual({ long: "dealer_positions_long_all", short: "dealer_positions_short_all" });
  });

  it("une catégorie à moitié présente est absente, jamais une demi-position", () => {
    const presentes = new Set(COLONNES_TFF.filter((c) => c !== "dealer_positions_short_all"));
    const c = resoudreColonnes("tff", presentes);
    expect(c.categories[0]).toBeNull();
    expect(c.categories.slice(1).every((x) => x !== null)).toBe(true);
  });

  it("choisit la graphie réellement renvoyée pour les swap dealers", () => {
    const base = ["swap_positions_long_all", "prod_merc_positions_long", "prod_merc_positions_short"];
    const avecDouble = resoudreColonnes("disaggregated", new Set([...base, "swap__positions_short_all"]));
    expect(avecDouble.categories[1]).toEqual({ long: "swap_positions_long_all", short: "swap__positions_short_all" });
    const avecSimple = resoudreColonnes("disaggregated", new Set([...base, "swap_positions_short_all"]));
    expect(avecSimple.categories[1]).toEqual({ long: "swap_positions_long_all", short: "swap_positions_short_all" });
    const sans = resoudreColonnes("disaggregated", new Set(base));
    expect(sans.categories[1]).toBeNull();
    expect(sans.categories[0]).toEqual({ long: "prod_merc_positions_long", short: "prod_merc_positions_short" });
  });
});

describe("requêtes Socrata", () => {
  it("la découverte lit les dernières lignes complètes, sans $select", () => {
    const p = new URLSearchParams(construireRequeteDecouverte("L'EXEMPLE - CME"));
    expect(p.has("$select")).toBe(false);
    expect(p.get("$where")).toBe("market_and_exchange_names='L''EXEMPLE - CME'");
    expect(p.get("$order")).toBe("report_date_as_yyyy_mm_dd DESC");
    expect(p.get("$limit")).toBe(String(LIGNES_DECOUVERTE));
  });

  it("l'historique ne sélectionne que des colonnes vues, par date croissante", () => {
    const presentes = new Set(COLONNES_TFF.filter((c) => !c.startsWith("dealer_")));
    const p = new URLSearchParams(construireRequeteHistorique(EUR, resoudreColonnes("tff", presentes)));
    const select = p.get("$select")!.split(",");
    expect(select).toContain("asset_mgr_positions_long");
    expect(select).toContain("open_interest_all");
    expect(select.some((c) => c.startsWith("dealer_"))).toBe(false);
    for (const c of select) expect(presentes.has(c)).toBe(true);
    expect(p.get("$order")).toBe("report_date_as_yyyy_mm_dd ASC");
    expect(p.get("$where")).toBe(`market_and_exchange_names='${EUR}'`);
  });

  it("chemin du dataset Socrata", () => {
    expect(cheminSocrata("tff", "a=1")).toBe("resource/gpe5-46if.json?a=1");
    expect(cheminSocrata("disaggregated", "a=1")).toBe("resource/72hh-3qpy.json?a=1");
    expect(cheminSocrata("legacy", "a=1")).toBe("resource/6dca-aqww.json?a=1");
  });
});

describe("série historique", () => {
  it("trie, dédoublonne et garde NaN pour une valeur absente, vide ou négative", () => {
    const records = [
      recTff("2026-10-27", BASE),
      recTff("2026-10-13", BASE),
      { ...recTff("2026-10-20", BASE), dealer_positions_long_all: "" },
      { ...recTff("2026-10-20", BASE), lev_money_positions_short: "-5" }, // doublon : la dernière gagne
      { ...recTff("2026-10-06", BASE), market_and_exchange_names: "AUTRE" },
      { ...recTff("2026-09-29", BASE), report_date_as_yyyy_mm_dd: "pas une date" },
      null,
    ];
    const serie = parserHistorique(records, "tff", EUR, colonnesTff());
    expect(serie.points.map((p) => new Date(p.t).getDate())).toEqual([13, 20, 27]);
    const doublon = serie.points[1]!;
    expect(doublon.longs[0]).toBe(50); // la ligne au long vide a été remplacée
    expect(Number.isNaN(doublon.shorts[2]!)).toBe(true);
    expect(netCategorie(doublon, 2)).toBeNull();
    expect(netCategorie(serie.points[2]!, 1)).toBe(300);
  });

  it("une catégorie non résolue reste NaN et indisponible", () => {
    const presentes = new Set(COLONNES_TFF.filter((c) => !c.startsWith("other_rept")));
    const serie = parserHistorique([recTff("2026-10-27", BASE)], "tff", EUR, resoudreColonnes("tff", presentes));
    expect(serie.disponibles).toEqual([true, true, true, false, true]);
    expect(netCategorie(serie.points[0]!, 3)).toBeNull();
  });
});

describe("contrôle Σ nets = 0", () => {
  it("passe sur des rapports cohérents et signale une colonne mal associée", () => {
    const serie = parserHistorique(
      [recTff("2026-10-20", BASE), recTff("2026-10-27", { ...BASE, lev: [150, 260] })],
      "tff",
      EUR,
      colonnesTff(),
    );
    expect(sommeNets(serie.points[0]!)).toBe(0);
    expect(sommeNets(serie.points[1]!)).toBe(-10);
    const bilan = bilanCoherence(serie);
    expect(bilan.controles).toBe(2);
    expect(bilan.ecarts).toBe(1); // −10 contrats > 0,1 % de 800
    expect(bilan.dernierEcart).toBe(serie.points[1]!.t);
  });

  it("ne contrôle pas un rapport dont une catégorie manque", () => {
    const presentes = new Set(COLONNES_TFF.filter((c) => !c.startsWith("nonrept")));
    const serie = parserHistorique([recTff("2026-10-27", BASE)], "tff", EUR, resoudreColonnes("tff", presentes));
    expect(sommeNets(serie.points[0]!)).toBeNull();
    expect(bilanCoherence(serie)).toEqual({ controles: 0, ecarts: 0, dernierEcart: null });
  });
});

describe("exposition au dernier rapport", () => {
  it("stocks, net, variation, net/OI et indice par catégorie", () => {
    const records = Array.from({ length: 30 }, (_, i) => {
      const jour = new Date(Date.UTC(2026, 3, 7 + 7 * i)).toISOString().slice(0, 10);
      // Le net des gérants d'actifs monte de 10 par semaine (contrepartie : les dealers).
      return recTff(jour, { ...BASE, am: [400 + 10 * i, 100], dealer: [50, 300 + 10 * i] });
    });
    const serie = parserHistorique(records, "tff", EUR, colonnesTff());
    const expo = expositionDerniere(serie);
    expect(expo.map((e) => e.categorie.id)).toEqual(["dealer", "asset_mgr", "lev_money", "other_rept", "nonrept"]);
    const am = expo[1]!;
    expect(am.long).toBe(690);
    expect(am.short).toBe(100);
    expect(am.net).toBe(590);
    expect(am.deltaNet).toBe(10);
    expect(am.indice).toBe(100); // maximum de son amplitude
    expect(am.netPctOi!).toBeCloseTo((590 / (690 + 50 + 150 + 80 + 70 + 50)) * 100, 6);
    expect(expo[0]!.indice).toBe(0); // dealers au minimum
    expect(expo[2]!.indice).toBe(50); // net constant
  });

  it("indice indisponible sous 26 rapports, variation absente sans rapport précédent", () => {
    const serie = parserHistorique([recTff("2026-10-27", BASE)], "tff", EUR, colonnesTff());
    const am = expositionDerniere(serie)[1]!;
    expect(am.net).toBe(300);
    expect(am.deltaNet).toBeNull();
    expect(am.indice).toBeNull();
  });
});

describe("calendrier hebdomadaire de la CFTC", () => {
  // Positions du mardi 27 octobre 2026 (publiées le vendredi 30).
  const mardi = Date.parse("2026-10-27T00:00:00.000");

  it("le rapport suivant paraît le vendredi T+10 à 20 h 30 UTC", () => {
    expect(new Date(prochainePublicationCot(mardi)).toISOString()).toBe("2026-11-06T20:30:00.000Z");
    expect(new Date(dateRapportSuivant(mardi)).getDate()).toBe(3);
  });

  it("à jour jusqu'à la publication suivante, puis relu", () => {
    const ts = Date.parse("2026-10-31T10:00:00Z");
    expect(historiqueAJour(mardi, ts, Date.parse("2026-11-06T20:00:00Z"))).toBe(true);
    expect(historiqueAJour(mardi, ts, Date.parse("2026-11-06T20:31:00Z"))).toBe(false);
    expect(rapportEnRetard(mardi, Date.parse("2026-11-06T20:31:00Z"))).toBe(true);
    expect(rapportEnRetard(null, Date.now())).toBe(false);
  });

  it("rapport en retard (jour férié) : nouvelle vérification au plus tôt 6 h après", () => {
    const ts = Date.parse("2026-11-06T21:00:00Z");
    expect(finValiditeHistorique(mardi, ts)).toBe(ts + RELANCE_MIN_MS);
    expect(historiqueAJour(mardi, ts, ts + RELANCE_MIN_MS - 1)).toBe(true);
    expect(historiqueAJour(mardi, ts, ts + RELANCE_MIN_MS)).toBe(false);
    expect(finValiditeHistorique(null, ts)).toBe(ts + RELANCE_MIN_MS);
  });
});

describe("cache compact", () => {
  it("aller-retour fidèle, NaN compris", () => {
    const records = [recTff("2026-10-20", BASE), { ...recTff("2026-10-27", BASE), open_interest_all: "" }];
    const serie = parserHistorique(records, "tff", EUR, colonnesTff());
    const compact = JSON.parse(JSON.stringify(compacterSerie(serie))) as unknown;
    const relue = decompacterSerie(compact)!;
    expect(relue.dataset).toBe("tff");
    expect(relue.nom).toBe(EUR);
    expect(relue.disponibles).toEqual(serie.disponibles);
    expect(relue.points).toHaveLength(2);
    expect(relue.points[0]).toEqual(serie.points[0]);
    expect(Number.isNaN(relue.points[1]!.oi)).toBe(true);
  });

  it("rejette une version, un rapport ou une forme inattendus", () => {
    const serie = parserHistorique([recTff("2026-10-27", BASE)], "tff", EUR, colonnesTff());
    const ok = compacterSerie(serie);
    expect(decompacterSerie({ ...ok, v: 99 })).toBeNull();
    expect(decompacterSerie({ ...ok, dataset: "inconnu" })).toBeNull();
    expect(decompacterSerie({ ...ok, dataset: "legacy" })).toBeNull(); // 3 catégories ≠ 5
    expect(decompacterSerie({ ...ok, lignes: [[1, 2, 3]] })).toBeNull();
    expect(decompacterSerie(null)).toBeNull();
  });
});
