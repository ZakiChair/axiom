import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATEGORIES_COT,
  DATASETS_COT,
  WATCHLIST_COT,
  chargerRapportCot,
  construireRequete,
  cotIndex,
  datasetPour,
  deltaSemaines,
  netSurOi,
  nombreCot,
  pointCot,
  resumerCot,
  type CategoriePositionnement,
  type CotCategorie,
  type DatasetCot,
  type InstrumentCot,
  type PointCot,
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

  it("conserve la série complète triée chrono CROISSANTE par instrument (t, net, oi)", () => {
    // records mélange l'ordre DESC de l'API et entrelace OR/BTC ⇒ la série doit ressortir
    // ASC par date, indépendamment par instrument.
    const { lignes } = resumerCot(records);
    const or = lignes.find((l) => l.nom === OR);
    expect(or?.serie).toEqual([
      { t: Date.parse("2026-06-16T00:00:00.000"), net: 211127 - 30907, oi: 339330 },
      { t: Date.parse("2026-06-23T00:00:00.000"), net: 217028 - 35689, oi: 352167 },
    ]);
    const btc = lignes.find((l) => l.nom === BTC);
    expect(btc?.serie).toEqual([
      { t: Date.parse("2026-06-16T00:00:00.000"), net: 17727 - 14252, oi: 21000 },
      { t: Date.parse("2026-06-23T00:00:00.000"), net: 16348 - 12824, oi: 20554 },
    ]);
  });

  it("exclut de la série les points à long/short vide (mais garde un OI vide → NaN)", () => {
    const avecTrous = [
      rec(BTC, "2026-06-09T00:00:00.000", 100, 40, 5000), // valide
      { // long vide ⇒ point ignoré
        market_and_exchange_names: BTC,
        report_date_as_yyyy_mm_dd: "2026-06-16T00:00:00.000",
        noncomm_positions_long_all: "",
        noncomm_positions_short_all: "50",
        open_interest_all: "6000",
      },
      { // OI vide ⇒ point conservé, oi = NaN
        market_and_exchange_names: BTC,
        report_date_as_yyyy_mm_dd: "2026-06-23T00:00:00.000",
        noncomm_positions_long_all: "120",
        noncomm_positions_short_all: "30",
        open_interest_all: "",
      },
    ];
    const { lignes } = resumerCot(avecTrous);
    const btc = lignes.find((l) => l.nom === BTC);
    expect(btc?.serie).toHaveLength(2);
    expect(btc?.serie[0]).toEqual({ t: Date.parse("2026-06-09T00:00:00.000"), net: 60, oi: 5000 });
    expect(btc?.serie[1]?.t).toBe(Date.parse("2026-06-23T00:00:00.000"));
    expect(btc?.serie[1]?.net).toBe(90);
    expect(btc?.serie[1]?.oi).toBeNaN();
  });
});

describe("cotIndex", () => {
  /** Construit une série de longueur `n` à partir des nets fournis (t/oi arbitraires mais finis). */
  function serieDe(nets: number[]): PointCot[] {
    return nets.map((net, i) => ({ t: i * 1000, net, oi: 1000 }));
  }

  it("dernier = max de la fenêtre → 100", () => {
    const nets = Array.from({ length: 30 }, (_, i) => i); // croissant, dernier = max
    expect(cotIndex(serieDe(nets))).toBe(100);
  });

  it("dernier = min de la fenêtre → 0", () => {
    const nets = Array.from({ length: 30 }, (_, i) => -i); // décroissant, dernier = min
    expect(cotIndex(serieDe(nets))).toBe(0);
  });

  it("série constante (amplitude nulle) → 50", () => {
    const nets = Array.from({ length: 30 }, () => 5000);
    expect(cotIndex(serieDe(nets))).toBe(50);
  });

  it("< 26 points d'historique → null", () => {
    expect(cotIndex(serieDe(Array.from({ length: 25 }, (_, i) => i)))).toBeNull();
  });

  it("valeur intermédiaire : dernier au 3/4 de l'amplitude → 75", () => {
    // min=0, max=100, dernier=75 ⇒ (75-0)/(100-0)*100 = 75.
    const nets = [0, 100, 25, 50, ...Array.from({ length: 22 }, () => 10), 75];
    expect(cotIndex(serieDe(nets))).toBe(75);
  });

  it("fenêtre plus grande que la série → utilise toute la série", () => {
    const nets = Array.from({ length: 30 }, (_, i) => i);
    // fenetreSem très large (> longueur série) : identique à la fenêtre par défaut ici (30 < 156).
    expect(cotIndex(serieDe(nets), 10_000)).toBe(cotIndex(serieDe(nets)));
    expect(cotIndex(serieDe(nets), 10_000)).toBe(100);
  });

  it("fenêtre plus étroite que la série : ignore l'historique hors fenêtre (résultat DIFFÉRENT selon la fenêtre)", () => {
    // min/max globaux = 0/100 (2 premiers points) ; 23 points de remplissage (50, sans effet sur
    // le min/max global) ; 5 derniers points resserrés autour de 20-24 (min/max LOCAUX distincts
    // du min/max global). Le dernier point (24) est extrême dans la fenêtre de 5 mais médian sur
    // l'ensemble de la série ⇒ les deux calculs doivent diverger si la fenêtre est bien appliquée.
    const nets = [100, 0, ...Array.from({ length: 23 }, () => 50), 20, 21, 22, 23, 24];
    expect(cotIndex(serieDe(nets), 5)).toBe(100); // fenêtre [20,21,22,23,24] : dernier = max local
    expect(cotIndex(serieDe(nets))).toBe(24); // série entière [0,100] : (24-0)/100*100 = 24
  });
});

describe("deltaSemaines", () => {
  function serieDe(nets: number[]): PointCot[] {
    return nets.map((net, i) => ({ t: i * 1000, net, oi: 1000 }));
  }

  it("delta 1 semaine (net dernier − net précédent)", () => {
    const serie = serieDe([100, 120, 90]);
    expect(deltaSemaines(serie, 1)).toBe(90 - 120);
  });

  it("delta 4 semaines", () => {
    const serie = serieDe([100, 120, 90, 80, 130]);
    expect(deltaSemaines(serie, 4)).toBe(130 - 100);
  });

  it("série trop courte pour reculer de n → null", () => {
    const serie = serieDe([100, 120, 90]);
    expect(deltaSemaines(serie, 4)).toBeNull();
    expect(deltaSemaines(serie, 3)).toBeNull(); // exactement à la limite (index -1 hors tableau)
  });
});

describe("netSurOi", () => {
  it("calcule le ratio net/OI en pourcentage (cas positif et négatif)", () => {
    expect(netSurOi(5000, 20000)).toBe(25);
    expect(netSurOi(-5000, 20000)).toBe(-25);
  });

  it("OI = 0 → null", () => {
    expect(netSurOi(5000, 0)).toBeNull();
  });

  it("OI négatif ou NaN → null", () => {
    expect(netSurOi(5000, -100)).toBeNull();
    expect(netSurOi(5000, Number.NaN)).toBeNull();
  });
});

describe("chargerRapportCot — normalisation du cache (fix revue Task 1)", () => {
  /** Mock localStorage en mémoire (environnement de test Node, pas de DOM ici). */
  function installMockLocalStorage(): Storage {
    const data = new Map<string, string>();
    const mock: Storage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
      clear: () => data.clear(),
      key: (i) => Array.from(data.keys())[i] ?? null,
      get length() {
        return data.size;
      },
    };
    (globalThis as { localStorage?: Storage }).localStorage = mock;
    return mock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("un OI absent (NaN) survit au round-trip localStorage sans devenir null", async () => {
    installMockLocalStorage();
    const BTC = "BITCOIN - CHICAGO MERCANTILE EXCHANGE";
    const records = [
      {
        market_and_exchange_names: BTC,
        report_date_as_yyyy_mm_dd: "2026-06-23T00:00:00.000",
        noncomm_positions_long_all: "16348",
        noncomm_positions_short_all: "12824",
        open_interest_all: "", // ⇒ OI = NaN (convention nombreCot)
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => records }),
    );

    // 1) premier chargement réseau : écrit le cache (JSON.stringify(NaN) → "null" dans le blob).
    const premier = await chargerRapportCot({ force: true });
    const btc1 = premier.resume.lignes.find((l) => l.nom === BTC);
    expect(Number.isNaN(btc1?.openInterest)).toBe(true);
    expect(Number.isNaN(btc1?.serie[0]?.oi)).toBe(true);

    // 2) relecture pure cache (frais, aucun fetch nécessaire) : sans le fix, oi/openInterest
    //    reviendraient `null` (violation du contrat `number`) au lieu de NaN.
    const second = await chargerRapportCot();
    expect(second.depuisCache).toBe(true);
    const btc2 = second.resume.lignes.find((l) => l.nom === BTC);
    expect(btc2?.openInterest).not.toBeNull();
    expect(Number.isNaN(btc2?.openInterest)).toBe(true);
    expect(btc2?.serie[0]?.oi).not.toBeNull();
    expect(Number.isNaN(btc2?.serie[0]?.oi)).toBe(true);
  });
});

describe("construireRequete", () => {
  // Instant UTC (suffixe Z) : la borne est calculée en UTC, donc le test est déterministe
  // quel que soit le fuseau de la machine.
  const nowMs = Date.parse("2026-07-23T00:00:00.000Z");
  const watchlist: InstrumentCot[] = [
    { nom: "GOLD - COMMODITY EXCHANGE INC.", libelle: "Or", categorie: "metal" },
    { nom: "BITCOIN - CHICAGO MERCANTILE EXCHANGE", libelle: "Bitcoin", categorie: "crypto" },
  ];

  it("récupère 3000 lignes", () => {
    const params = new URLSearchParams(construireRequete(watchlist, nowMs));
    expect(params.get("$limit")).toBe("3000");
  });

  it("borne le $where à 3 ans (nowMs injecté) EN PLUS du filtre watchlist", () => {
    const params = new URLSearchParams(construireRequete(watchlist, nowMs));
    const where = params.get("$where") ?? "";
    // Filtre instruments conservé.
    expect(where).toContain("market_and_exchange_names in(");
    expect(where).toContain("'GOLD - COMMODITY EXCHANGE INC.'");
    // Borne temporelle : now − 3 ans calendaires ⇒ 2023-07-23.
    expect(where).toContain("report_date_as_yyyy_mm_dd >= '2023-07-23T00:00:00.000'");
  });

  it("sélectionne toujours les mêmes 5 champs", () => {
    const params = new URLSearchParams(construireRequete(watchlist, nowMs));
    expect(params.get("$select")).toBe(
      "market_and_exchange_names,report_date_as_yyyy_mm_dd,noncomm_positions_long_all,noncomm_positions_short_all,open_interest_all",
    );
  });
});

describe("datasetPour (routage famille × catégorie → dataset)", () => {
  const FAMILLES: CotCategorie[] = ["fx", "indice", "metal", "energie", "crypto"];

  // Table de vérité EXHAUSTIVE : 3 catégories × 5 familles = 15 combinaisons.
  // - catégorie "legacy" → "legacy" pour TOUTES les familles ;
  // - "fonds"/"commerciaux" → metal|energie → "disaggregated" ; fx|indice|crypto → "tff".
  const attendu: Record<CategoriePositionnement, Record<CotCategorie, DatasetCot>> = {
    legacy: { fx: "legacy", indice: "legacy", metal: "legacy", energie: "legacy", crypto: "legacy" },
    fonds: { fx: "tff", indice: "tff", metal: "disaggregated", energie: "disaggregated", crypto: "tff" },
    commerciaux: {
      fx: "tff",
      indice: "tff",
      metal: "disaggregated",
      energie: "disaggregated",
      crypto: "tff",
    },
  };

  for (const categorie of ["legacy", "fonds", "commerciaux"] as CategoriePositionnement[]) {
    for (const famille of FAMILLES) {
      it(`${categorie} × ${famille} → ${attendu[categorie][famille]}`, () => {
        expect(datasetPour(famille, categorie)).toBe(attendu[categorie][famille]);
      });
    }
  }

  it("ne renvoie jamais null (routage exhaustif sur les 15 combinaisons)", () => {
    for (const categorie of ["legacy", "fonds", "commerciaux"] as CategoriePositionnement[]) {
      for (const famille of FAMILLES) {
        expect(datasetPour(famille, categorie)).not.toBeNull();
      }
    }
  });
});

describe("DATASETS_COT (ids Socrata vérifiés live + paires de champs)", () => {
  const CLES: DatasetCot[] = ["legacy", "disaggregated", "tff"];

  it("expose les trois datasets avec un id Socrata non vide", () => {
    for (const cle of CLES) {
      expect(DATASETS_COT[cle].id).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    }
  });

  it("ids vérifiés live (legacy=6dca-aqww, disaggregated=72hh-3qpy, tff=gpe5-46if)", () => {
    expect(DATASETS_COT.legacy.id).toBe("6dca-aqww");
    expect(DATASETS_COT.disaggregated.id).toBe("72hh-3qpy");
    expect(DATASETS_COT.tff.id).toBe("gpe5-46if");
  });

  it("chaque paire (long, short) a deux champs distincts et non vides", () => {
    for (const cle of CLES) {
      for (const paire of [DATASETS_COT[cle].champs.net1, DATASETS_COT[cle].champs.net2]) {
        const [long, short] = paire;
        expect(long.length).toBeGreaterThan(0);
        expect(short.length).toBeGreaterThan(0);
        expect(long).not.toBe(short);
      }
    }
  });

  it("net1 et net2 désignent des catégories DISTINCTES (jamais la même paire)", () => {
    for (const cle of CLES) {
      const { net1, net2 } = DATASETS_COT[cle].champs;
      // Aucun des 4 champs ne se répète : les deux catégories sont bien indépendantes.
      const tous = [...net1, ...net2];
      expect(new Set(tous).size).toBe(4);
    }
  });

  it("champs de position exacts (transcrits des réponses live)", () => {
    expect(DATASETS_COT.legacy.champs.net1).toEqual([
      "noncomm_positions_long_all",
      "noncomm_positions_short_all",
    ]);
    expect(DATASETS_COT.legacy.champs.net2).toEqual([
      "comm_positions_long_all",
      "comm_positions_short_all",
    ]);
    // ⚠️ asymétrie live : m_money a le suffixe _all, prod_merc ne l'a PAS.
    expect(DATASETS_COT.disaggregated.champs.net1).toEqual([
      "m_money_positions_long_all",
      "m_money_positions_short_all",
    ]);
    expect(DATASETS_COT.disaggregated.champs.net2).toEqual([
      "prod_merc_positions_long",
      "prod_merc_positions_short",
    ]);
    expect(DATASETS_COT.tff.champs.net1).toEqual([
      "lev_money_positions_long",
      "lev_money_positions_short",
    ]);
    expect(DATASETS_COT.tff.champs.net2).toEqual([
      "asset_mgr_positions_long",
      "asset_mgr_positions_short",
    ]);
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
