import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { AlertDef, Declenchement } from "@axiom/alerts";
import {
  assetsWhaleFluxActifs,
  assurerTablesAlertes,
  chargerDefs,
  doitNotifier,
  evaluerEtPersister,
  evaluerLiqCascadeTick,
  evaluableDaemon,
  evaluableSurBougie1m,
  evaluerTick,
  evaluerWhaleFluxTick,
  FENETRE_LIQ_MS,
  fusionnerEtatArme,
  purgerJournalAlertes,
  RETENTION_JOURNAL_MS,
  SEUIL_HEARTBEAT_MS,
  sommeLiqUsdParMin,
  symbolesBinanceActifs,
  symbolesFundingActifs,
  symbolesLiqCascadeActifs,
  TYPES_BOUGIE,
  TYPES_FUNDING,
  TYPES_PRIX,
} from "./alerts";
import { assurerTableLiquidations } from "./liquidations";
import { assurerTableWhales } from "./whales";

/** Def d'alerte prix-croise binance, réutilisée dans plusieurs cas. */
function alertePrix(id: string, symbol: string, niveau: number, sens: "hausse" | "baisse" = "hausse"): AlertDef {
  return {
    id,
    symbol,
    source: "binance",
    condition: { type: "prix-croise", niveau, sens },
    actif: true,
    declenchements: [],
  };
}

/** Def funding-extreme binance (seuilAbs fraction). */
function alerteFunding(
  id: string,
  symbol: string,
  seuilAbs = 0.001,
  sens: "long-crowded" | "short-crowded" | "les-deux" = "long-crowded",
): AlertDef {
  return {
    id,
    symbol,
    source: "binance",
    condition: { type: "funding-extreme", seuilAbs, sens },
    actif: true,
    declenchements: [],
  };
}

/** Def liq-cascade binance (seuil USD/min). */
function alerteCascade(id: string, symbol: string, seuilUsdParMin = 1_000_000): AlertDef {
  return {
    id,
    symbol,
    source: "binance",
    condition: { type: "liq-cascade", seuilUsdParMin },
    actif: true,
    declenchements: [],
  };
}

/** Def whale-flux (symbol = ACTIF par convention, porteur binance). */
function alerteWhale(
  id: string,
  asset: string,
  seuilUsd = 5_000_000,
  direction: "depot" | "retrait" | "tous" = "tous",
): AlertDef {
  return {
    id,
    symbol: asset,
    source: "binance",
    condition: { type: "whale-flux", seuilUsd, direction },
    actif: true,
    declenchements: [],
  };
}

// ─────────────────────────── Fonctions PURES ───────────────────────────

describe("fusionnerEtatArme", () => {
  test("écrase le arme du front par celui du daemon (présent) ; absent → undefined", () => {
    const defs: AlertDef[] = [
      { ...alertePrix("a", "BTCUSDT", 100), arme: true }, // front dit true
      { ...alertePrix("b", "ETHUSDT", 200), arme: true }, // aucune entrée daemon
    ];
    const res = fusionnerEtatArme(defs, { a: false });
    expect(res[0]?.arme).toBe(false); // daemon écrase
    expect(res[1]?.arme).toBeUndefined(); // pas d'entrée → calibrage
  });
});

describe("symbolesBinanceActifs", () => {
  test("uniques, majuscules, triés, binance actifs seulement", () => {
    const defs: AlertDef[] = [
      alertePrix("a", "btcusdt", 1),
      { ...alertePrix("b", "ETHUSDT", 1), actif: false }, // inactif → exclu
      alertePrix("c", "BTCUSDT", 2), // doublon symbole
      { ...alertePrix("d", "SOLUSDT", 1), source: "kraken" }, // non-binance → exclu
    ];
    expect(symbolesBinanceActifs(defs)).toEqual(["BTCUSDT"]);
  });

  test("une def de bougie non-1m ne justifie PAS à elle seule une souscription", () => {
    // Le daemon n'évalue que les bougies 1 min (cf. `evaluableSurBougie1m`) : un symbole
    // dont la SEULE alerte est en 4 h ouvrirait un abonnement jamais exploité.
    const defs: AlertDef[] = [
      alerteVariation("v4", "SOLUSDT", "4h"), // seule alerte du symbole → exclu
      {
        ...alerteVariation("i4", "XRPUSDT", "4h"),
        condition: { type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 70 },
      }, // autre type de bougie, même exclusion
      alerteVariation("v1", "ETHUSDT", "1m"), // bougie 1m → gardé
      alerteVariation("v0", "ADAUSDT"), // def héritée (sans timeframe) → gardé
    ];
    expect(symbolesBinanceActifs(defs)).toEqual(["ADAUSDT", "ETHUSDT"]);
  });

  test("garde le symbole si une AUTRE def évaluable le requiert (prix, funding, liq, whale)", () => {
    const defs: AlertDef[] = [
      alerteVariation("v4", "BTCUSDT", "4h"), // non évaluable...
      alertePrix("p1", "BTCUSDT", 100), // ...mais le prix, lui, l'est → gardé
      alerteVariation("w4", "ETHUSDT", "4h"),
      alerteFunding("f1", "ETHUSDT"),
      alerteVariation("l4", "SOLUSDT", "4h"),
      alerteCascade("c1", "SOLUSDT"),
      alerteWhale("h1", "BTC"),
    ];
    expect(symbolesBinanceActifs(defs)).toEqual(["BTC", "BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  });
});

describe("symbolesFundingActifs", () => {
  test("ne retient que binance actives funding-extreme", () => {
    const defs: AlertDef[] = [
      alerteFunding("f1", "btcusdt"),
      alerteFunding("f2", "ETHUSDT"),
      { ...alerteFunding("f3", "SOLUSDT"), actif: false },
      { ...alerteFunding("f4", "XRPUSDT"), source: "kraken" },
      alertePrix("p1", "BNBUSDT", 1), // prix → exclu
      alerteFunding("f5", "BTCUSDT"), // doublon
    ];
    expect(symbolesFundingActifs(defs)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
});

describe("symbolesLiqCascadeActifs", () => {
  test("ne retient que binance actives liq-cascade (uniques, majuscules, triées)", () => {
    const defs: AlertDef[] = [
      alerteCascade("l1", "dogeusdt"),
      alerteCascade("l2", "BTCUSDT"),
      { ...alerteCascade("l3", "SOLUSDT"), actif: false }, // inactive → exclue
      { ...alerteCascade("l4", "XRPUSDT"), source: "kraken" }, // non-binance → exclue
      alerteFunding("f1", "ETHUSDT"), // autre type → exclue
      alerteCascade("l5", "BTCUSDT"), // doublon symbole
    ];
    expect(symbolesLiqCascadeActifs(defs)).toEqual(["BTCUSDT", "DOGEUSDT"]);
  });
});

describe("sommeLiqUsdParMin", () => {
  test("somme les usd du symbole sur la fenêtre glissante d'une minute", () => {
    const d = new Database(":memory:");
    assurerTableLiquidations(d);
    const maintenant = 10_000_000;
    const inserer = d.query(
      "INSERT INTO liquidations (symbole, venue, t, side, price, qty, usd) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    inserer.run("BTCUSDT", "bybit", maintenant - 59_000, "long", 100, 1, 100); // dans la fenêtre
    inserer.run("BTCUSDT", "okx", maintenant - FENETRE_LIQ_MS, "short", 25, 1, 25); // borne incluse
    inserer.run("BTCUSDT", "bybit", maintenant - FENETRE_LIQ_MS - 1, "long", 999, 1, 999); // hors fenêtre
    inserer.run("ETHUSDT", "bybit", maintenant, "long", 50, 1, 50); // autre symbole
    expect(sommeLiqUsdParMin(d, "BTCUSDT", maintenant)).toBe(125);
  });

  test("table vide ou symbole absent → 0", () => {
    const d = new Database(":memory:");
    assurerTableLiquidations(d);
    expect(sommeLiqUsdParMin(d, "XRPUSDT", 1_000_000)).toBe(0);
  });
});

describe("doitNotifier", () => {
  test("notifie si le dernier heartbeat date de plus de 90 s", () => {
    const maintenant = 1_000_000;
    expect(doitNotifier(maintenant - SEUIL_HEARTBEAT_MS - 1, maintenant)).toBe(true);
  });

  test("silencieux si un heartbeat récent (< 90 s)", () => {
    const maintenant = 1_000_000;
    expect(doitNotifier(maintenant - 1_000, maintenant)).toBe(false);
  });

  test("jamais de heartbeat (0) avec un temps réel → notifie", () => {
    expect(doitNotifier(0, Date.now())).toBe(true);
  });
});

describe("evaluerTick", () => {
  test("ne retient que binance + symbole + type demandé", () => {
    const defs: AlertDef[] = [
      { ...alertePrix("a", "BTCUSDT", 100), arme: true },
      { ...alertePrix("b", "ETHUSDT", 100), arme: true }, // autre symbole
    ];
    const res = evaluerTick(defs, "BTCUSDT", TYPES_PRIX, { maintenant: 2000, dernierPrix: 110 });
    expect(res.declenchements.map((d) => d.alertId)).toEqual(["a"]);
  });
});

// ─────────────────────────── Intégration SQLite (alerte factice en base) ───────────────────────────

/** Base en mémoire avec la table kv (schéma miroir de kv.ts) + une def factice. */
function baseAvecAlerte(def: AlertDef): Database {
  const d = new Database(":memory:");
  d.run(`CREATE TABLE kv (
    namespace TEXT NOT NULL, cle TEXT NOT NULL, valeur TEXT NOT NULL, majA INTEGER NOT NULL,
    PRIMARY KEY (namespace, cle)
  )`);
  d.query("INSERT INTO kv (namespace, cle, valeur, majA) VALUES (?, ?, ?, ?)").run(
    "alerts",
    "defs",
    JSON.stringify([def]),
    Date.now(),
  );
  assurerTablesAlertes(d);
  return d;
}

describe("evaluerEtPersister (démarrage complet en base)", () => {
  test("calibre puis déclenche sur franchissement, journalise et notifie", () => {
    const d = baseAvecAlerte(alertePrix("a1", "BTCUSDT", 100, "hausse"));
    const notifs: Array<{ symbol: string; decl: Declenchement }> = [];
    const notifier = (symbol: string, decl: Declenchement): void => {
      notifs.push({ symbol, decl });
    };

    // 1er tick sous le niveau : CALIBRAGE, aucun déclenchement.
    const r1 = evaluerEtPersister(
      "BTCUSDT",
      TYPES_PRIX,
      { maintenant: 1_000_000, dernierPrix: 90 },
      { db: d, notifier, dernierHeartbeat: 0 },
    );
    expect(r1).toHaveLength(0);
    // L'état de ré-armement a été persisté (armé = true).
    const etat = chargerDefs(d).find((x) => x.id === "a1");
    expect(etat?.arme).toBe(true);

    // 2e tick au-dessus du niveau : DÉCLENCHEMENT.
    const r2 = evaluerEtPersister(
      "BTCUSDT",
      TYPES_PRIX,
      { maintenant: 2_000_000, dernierPrix: 110 },
      { db: d, notifier, dernierHeartbeat: 0 }, // heartbeat très ancien → notifie
    );
    expect(r2).toHaveLength(1);
    expect(r2[0]?.valeur).toBe(110);

    // Journal : une entrée notifiée.
    const journal = d.query("SELECT alertId, symbol, valeur, notifie FROM alertes_journal").all() as Array<{
      alertId: string;
      symbol: string;
      valeur: number;
      notifie: number;
    }>;
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ alertId: "a1", symbol: "BTCUSDT", valeur: 110, notifie: 1 });
    // Notification déclenchée (heartbeat ancien).
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.symbol).toBe("BTCUSDT");
  });

  test("app ouverte (heartbeat récent) : journalise mais NE notifie PAS", () => {
    const d = baseAvecAlerte(alertePrix("a2", "BTCUSDT", 100, "hausse"));
    const notifs: Declenchement[] = [];
    const notifier = (_symbol: string, decl: Declenchement): void => {
      notifs.push(decl);
    };

    evaluerEtPersister("BTCUSDT", TYPES_PRIX, { maintenant: 1_000_000, dernierPrix: 90 }, { db: d, notifier, dernierHeartbeat: 999_990 });
    const r = evaluerEtPersister(
      "BTCUSDT",
      TYPES_PRIX,
      { maintenant: 1_000_000, dernierPrix: 110 },
      { db: d, notifier, dernierHeartbeat: 999_990 }, // heartbeat il y a 10 ms → silencieux
    );
    expect(r).toHaveLength(1); // déclenchement bien produit

    const journal = d.query("SELECT notifie FROM alertes_journal").all() as Array<{ notifie: number }>;
    expect(journal).toHaveLength(1);
    expect(journal[0]?.notifie).toBe(0); // journalisé mais NON notifié
    expect(notifs).toHaveLength(0); // notifier jamais appelé
  });

  test("funding-extreme : calibre puis déclenche, journal + notify (heartbeat ancien)", () => {
    const d = baseAvecAlerte(alerteFunding("f1", "BTCUSDT", 0.001, "long-crowded"));
    const notifs: Array<{ symbol: string; decl: Declenchement }> = [];
    const notifier = (symbol: string, decl: Declenchement): void => {
      notifs.push({ symbol, decl });
    };

    // Sous seuil → calibrage (armé), aucun déclenchement.
    const r1 = evaluerEtPersister(
      "BTCUSDT",
      TYPES_FUNDING,
      { maintenant: 1_000_000, dernierPrix: 0, fundingRate: 0.0001 },
      { db: d, notifier, dernierHeartbeat: 0 },
    );
    expect(r1).toHaveLength(0);
    expect(chargerDefs(d).find((x) => x.id === "f1")?.arme).toBe(true);

    // |rate| ≥ seuilAbs et long → DÉCLENCHE + journal notifié.
    const r2 = evaluerEtPersister(
      "BTCUSDT",
      TYPES_FUNDING,
      { maintenant: 2_000_000, dernierPrix: 0, fundingRate: 0.002 },
      { db: d, notifier, dernierHeartbeat: 0 },
    );
    expect(r2).toHaveLength(1);
    expect(r2[0]?.valeur).toBe(0.002);

    const journal = d.query("SELECT alertId, valeur, notifie FROM alertes_journal").all() as Array<{
      alertId: string;
      valeur: number;
      notifie: number;
    }>;
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ alertId: "f1", valeur: 0.002, notifie: 1 });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.symbol).toBe("BTCUSDT");
  });

  test("funding-extreme ignoré si évalué avec TYPES_PRIX (pas de double fire)", () => {
    const d = baseAvecAlerte(alerteFunding("f2", "BTCUSDT", 0.001));
    const r = evaluerEtPersister(
      "BTCUSDT",
      TYPES_PRIX,
      { maintenant: 1, dernierPrix: 100, fundingRate: 0.01 },
      { db: d, notifier: () => {}, dernierHeartbeat: 0 },
    );
    expect(r).toHaveLength(0);
  });
});

describe("evaluerLiqCascadeTick (tick complet en base)", () => {
  test("inerte sans def liq-cascade active (aucune table liquidations requise)", () => {
    const d = baseAvecAlerte(alertePrix("p1", "BTCUSDT", 100)); // aucune def liq-cascade
    const notifier = (): void => {
      throw new Error("ne doit pas notifier");
    };
    evaluerLiqCascadeTick(1_000_000, { db: d, notifier, dernierHeartbeat: 0 });
    // Inerte : la table liquidations n'a même pas été créée.
    const tables = d
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'liquidations'")
      .all();
    expect(tables).toHaveLength(0);
  });

  test("calibre sous le seuil puis déclenche quand la minute glissante le dépasse", () => {
    const d = baseAvecAlerte(alerteCascade("l1", "BTCUSDT", 1_000_000));
    const notifs: Array<{ symbol: string; decl: Declenchement }> = [];
    const notifier = (symbol: string, decl: Declenchement): void => {
      notifs.push({ symbol, decl });
    };
    const opts = { db: d, notifier, dernierHeartbeat: 0 }; // heartbeat ancien → notifie

    // Tick 1 : table vide → 0 USD/min → calibrage (armée), aucun déclenchement.
    evaluerLiqCascadeTick(1_000_000, opts);
    expect(chargerDefs(d).find((x) => x.id === "l1")?.arme).toBe(true);
    expect(notifs).toHaveLength(0);

    // 1,2 M$ dans la fenêtre du tick 2 + 5 M$ HORS fenêtre (ignorés).
    const inserer = d.query(
      "INSERT INTO liquidations (symbole, venue, t, side, price, qty, usd) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    inserer.run("BTCUSDT", "bybit", 1_050_000, "long", 100, 7_000, 700_000);
    inserer.run("BTCUSDT", "okx", 1_055_000, "short", 100, 5_000, 500_000);
    inserer.run("BTCUSDT", "bybit", 900_000, "long", 100, 50_000, 5_000_000); // hors fenêtre

    // Tick 2 : 1,2 M$ ≥ seuil → déclenche, journalise et notifie (heartbeat ancien).
    evaluerLiqCascadeTick(1_060_000, opts);
    const journal = d
      .query("SELECT alertId, symbol, valeur, notifie FROM alertes_journal")
      .all() as Array<{ alertId: string; symbol: string; valeur: number; notifie: number }>;
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ alertId: "l1", symbol: "BTCUSDT", valeur: 1_200_000, notifie: 1 });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.symbol).toBe("BTCUSDT");

    // Tick 3 : la fenêtre a glissé (débit retombé sous le seuil) → ré-armement, pas de re-fire.
    evaluerLiqCascadeTick(2_000_000, opts);
    expect(chargerDefs(d).find((x) => x.id === "l1")?.arme).toBe(true);
    expect(notifs).toHaveLength(1);
  });

  test("app ouverte (heartbeat récent) : journalise mais NE notifie PAS", () => {
    const d = baseAvecAlerte(alerteCascade("l2", "BTCUSDT", 1_000));
    const notifs: Declenchement[] = [];
    const notifier = (_symbol: string, decl: Declenchement): void => {
      notifs.push(decl);
    };
    const opts = { db: d, notifier, dernierHeartbeat: 999_990 }; // heartbeat il y a 10 ms

    evaluerLiqCascadeTick(1_000_000, opts); // calibrage à 0 (armée)
    d.query(
      "INSERT INTO liquidations (symbole, venue, t, side, price, qty, usd) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("BTCUSDT", "bybit", 1_005_000, "long", 100, 20, 2_000);
    evaluerLiqCascadeTick(1_010_000, opts);

    const journal = d.query("SELECT notifie FROM alertes_journal").all() as Array<{ notifie: number }>;
    expect(journal).toHaveLength(1);
    expect(journal[0]?.notifie).toBe(0); // journalisé mais NON notifié (front actif)
    expect(notifs).toHaveLength(0);
  });
});

describe("assetsWhaleFluxActifs", () => {
  test("ne retient que les actives whale-flux (actifs uniques, majuscules, triés)", () => {
    const defs: AlertDef[] = [
      alerteWhale("w1", "usdt"),
      alerteWhale("w2", "BTC"),
      { ...alerteWhale("w3", "ETH"), actif: false }, // inactive → exclue
      alerteCascade("l1", "BTCUSDT"), // autre type → exclue
      alerteWhale("w4", "BTC"), // doublon actif
    ];
    expect(assetsWhaleFluxActifs(defs)).toEqual(["BTC", "USDT"]);
  });
});

describe("evaluerWhaleFluxTick (tick complet en base)", () => {
  /** Insère un mouvement baleine minimal dans `whale_moves` (table créée au besoin). */
  function insererMouvementTest(d: Database, id: string, t: number, usd: number, direction: string): void {
    assurerTableWhales(d);
    d.query(
      `INSERT INTO whale_moves (id, t, chain, asset, qty, usd, de, vers, deLabel, versLabel, direction)
       VALUES (?, ?, 'btc', 'BTC', 1, ?, '1A', '1B', NULL, NULL, ?)`,
    ).run(id, t, usd, direction);
  }

  test("inerte sans def whale-flux active", () => {
    const d = baseAvecAlerte(alertePrix("p1", "BTCUSDT", 100));
    const notifier = (): void => {
      throw new Error("ne doit pas notifier");
    };
    evaluerWhaleFluxTick(1_000_000, { db: d, notifier, dernierHeartbeat: 0 });
    const tables = d
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'whale_moves'")
      .all();
    expect(tables).toHaveLength(0); // inerte : la table n'a même pas été créée
  });

  test("calibre fenêtre vide puis déclenche sur un transfert ≥ seuil dans la fenêtre 10 min", () => {
    const d = baseAvecAlerte(alerteWhale("w1", "BTC", 5_000_000, "tous"));
    const notifs: Array<{ symbol: string; decl: Declenchement }> = [];
    const notifier = (symbol: string, decl: Declenchement): void => {
      notifs.push({ symbol, decl });
    };
    const opts = { db: d, notifier, dernierHeartbeat: 0 }; // heartbeat ancien → notifie

    // Tick 1 : aucune ligne → calibrage (armée), aucun déclenchement.
    evaluerWhaleFluxTick(1_000_000, opts);
    expect(chargerDefs(d).find((x) => x.id === "w1")?.arme).toBe(true);
    expect(notifs).toHaveLength(0);

    // 8 M$ dans la fenêtre + 20 M$ HORS fenêtre (> 10 min avant le tick 2) : ignoré.
    insererMouvementTest(d, "m1", 1_050_000, 8_000_000, "inconnu");
    insererMouvementTest(d, "m2", 300_000, 20_000_000, "depot");

    // Tick 2 : max fenêtre = 8 M$ ≥ 5 M$ → déclenche, journalise (symbol = actif) et notifie.
    evaluerWhaleFluxTick(1_060_000, opts);
    const journal = d
      .query("SELECT alertId, symbol, valeur, notifie FROM alertes_journal")
      .all() as Array<{ alertId: string; symbol: string; valeur: number; notifie: number }>;
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ alertId: "w1", symbol: "BTC", valeur: 8_000_000, notifie: 1 });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.symbol).toBe("BTC");

    // Tick 3 : la fenêtre a glissé (plus aucun transfert ≥ seuil) → ré-armement, pas de re-fire.
    evaluerWhaleFluxTick(2_000_000, opts);
    expect(chargerDefs(d).find((x) => x.id === "w1")?.arme).toBe(true);
    expect(notifs).toHaveLength(1);
  });

  test("filtre par direction : un retrait ne déclenche pas une alerte « dépôt »", () => {
    const d = baseAvecAlerte(alerteWhale("w2", "USDT", 1_000_000, "depot"));
    const notifs: Declenchement[] = [];
    const notifier = (_symbol: string, decl: Declenchement): void => {
      notifs.push(decl);
    };
    const opts = { db: d, notifier, dernierHeartbeat: 0 };

    evaluerWhaleFluxTick(1_000_000, opts); // calibrage (fenêtre vide)
    assurerTableWhales(d);
    d.query(
      `INSERT INTO whale_moves (id, t, chain, asset, qty, usd, de, vers, deLabel, versLabel, direction)
       VALUES ('m3', 1_005_000, 'eth', 'USDT', 9000000, 9000000, '0xa', '0xb', 'Binance', NULL, 'retrait')`,
    ).run();
    evaluerWhaleFluxTick(1_010_000, opts); // retrait 9 M$ mais direction filtrée « depot » → rien
    expect(notifs).toHaveLength(0);
  });
});

// ─────────────────────────── Purge du journal (rétention 30 j) ───────────────────────────

describe("purgerJournalAlertes", () => {
  /** Base :memory: avec la table `alertes_journal` et une ligne par horodatage fourni. */
  function baseAvecJournal(...ts: number[]): Database {
    const d = new Database(":memory:");
    assurerTablesAlertes(d);
    const inserer = d.query(
      "INSERT INTO alertes_journal (alertId, symbol, ts, valeur, message, notifie) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const t of ts) inserer.run(`a${t}`, "BTCUSDT", t, 1, "msg", 0);
    return d;
  }

  test("supprime les entrées plus vieilles que la rétention, garde les récentes", () => {
    const now = 100 * RETENTION_JOURNAL_MS; // repère arbitraire, loin de 0
    const vieille = now - RETENTION_JOURNAL_MS - 86_400_000; // 31 j
    const recente = now - 86_400_000; // 1 j
    const d = baseAvecJournal(vieille, recente);

    expect(purgerJournalAlertes(d, now - RETENTION_JOURNAL_MS)).toBe(1);
    const restant = d.query("SELECT ts FROM alertes_journal").all() as Array<{ ts: number }>;
    expect(restant).toEqual([{ ts: recente }]);
  });

  test("borne stricte : exactement 30 jours est gardé", () => {
    const now = 100 * RETENTION_JOURNAL_MS;
    const d = baseAvecJournal(now - RETENTION_JOURNAL_MS);
    expect(purgerJournalAlertes(d, now - RETENTION_JOURNAL_MS)).toBe(0);
    expect(d.query("SELECT COUNT(*) AS n FROM alertes_journal").get()).toMatchObject({ n: 1 });
  });

  test("journal vide → 0 suppression (idempotent)", () => {
    const d = baseAvecJournal();
    expect(purgerJournalAlertes(d, Date.now())).toBe(0);
  });
});

// ─────────────────────────── Filtre de timeframe (bougies 1 min du daemon) ───────────────────────────

/** Def `variation-pct` binance (fenêtre 1 min, seuil +5 %), avec timeframe optionnel. */
function alerteVariation(id: string, symbol: string, timeframe?: AlertDef["timeframe"]): AlertDef {
  return {
    id,
    symbol,
    source: "binance",
    condition: { type: "variation-pct", fenetreMs: 60_000, seuilPct: 5 },
    ...(timeframe === undefined ? {} : { timeframe }),
    actif: true,
    declenchements: [],
  };
}

/** Trois bougies plates : la fenêtre de 1 min est couverte, la variation vaut 0 %. */
function bougiesPlates(maintenant: number): Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}> {
  return [180_000, 120_000, 60_000].map((recul) => ({
    time: maintenant - recul,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
  }));
}

describe("evaluableSurBougie1m", () => {
  test("def héritée (timeframe absent) → évaluable par le daemon", () => {
    expect(evaluableSurBougie1m(alerteVariation("v0", "BTCUSDT"))).toBe(true);
  });

  test("def explicitement 1m → évaluable", () => {
    expect(evaluableSurBougie1m(alerteVariation("v1", "BTCUSDT", "1m"))).toBe(true);
  });

  test("def 4h → NON évaluable (front-only plutôt que fausse)", () => {
    expect(evaluableSurBougie1m(alerteVariation("v4", "BTCUSDT", "4h"))).toBe(false);
  });
});

describe("evaluableDaemon", () => {
  test("composite CVD ou régime → front-only", () => {
    const cvd: AlertDef = {
      id: "c1",
      symbol: "BTCUSDT",
      source: "binance",
      actif: true,
      declenchements: [],
      condition: {
        type: "composite",
        conditions: [
          { type: "prix-croise", niveau: 100, sens: "hausse" },
          { type: "cvd-spot-perp-div", kind: "les-deux" },
        ],
      },
    };
    expect(evaluableDaemon(cvd)).toBe(false);
  });

  test("composite prix + funding 1m → évaluable", () => {
    const ok: AlertDef = {
      id: "c2",
      symbol: "BTCUSDT",
      source: "binance",
      actif: true,
      declenchements: [],
      timeframe: "1m",
      condition: {
        type: "composite",
        conditions: [
          { type: "prix-croise", niveau: 100, sens: "hausse" },
          { type: "funding-extreme", sens: "les-deux", zSeuil: 2 },
        ],
      },
    };
    expect(evaluableDaemon(ok)).toBe(true);
  });
});

describe("evaluerTick — conditions de bougie filtrées sur le timeframe", () => {
  const maintenant = 3_000_000;
  const ctx = { maintenant, dernierPrix: 100, candles: bougiesPlates(maintenant) };

  test("def 1m : évaluée (calibrage de l'armement)", () => {
    const res = evaluerTick([alerteVariation("v1", "BTCUSDT", "1m")], "BTCUSDT", TYPES_BOUGIE, ctx);
    expect(res.modifie).toBe(true);
    expect(res.defs).toHaveLength(1);
    expect(res.defs[0]?.arme).toBe(true);
  });

  test("def héritée (sans timeframe) : évaluée comme avant", () => {
    const res = evaluerTick([alerteVariation("v0", "BTCUSDT")], "BTCUSDT", TYPES_BOUGIE, ctx);
    expect(res.modifie).toBe(true);
    expect(res.defs).toHaveLength(1);
  });

  test("def 4h : écartée du lot (le daemon n'a que des bougies 1 min)", () => {
    const res = evaluerTick([alerteVariation("v4", "BTCUSDT", "4h")], "BTCUSDT", TYPES_BOUGIE, ctx);
    expect(res.defs).toHaveLength(0);
    expect(res.modifie).toBe(false);
  });

  test("horloge du daemon en retard : la référence ne glisse pas d'une bougie", () => {
    // Bougies 1 min CLÔTURÉES aux prix 80 / 100 / 90 ; la dernière est ouverte en
    // `maintenant - 60 000` (elle a donc clôturé à `maintenant`). Référence attendue =
    // clôture de la bougie précédente (100) → pct = −10, quel que soit le retard de
    // l'horloge de la machine sur celle de l'exchange.
    const t = 3_000_000;
    const bougie = (time: number, close: number) => ({ time, open: close, high: close, low: close, close, volume: 1 });
    const candles = [bougie(t - 180_000, 80), bougie(t - 120_000, 100), bougie(t - 60_000, 90)];
    const chute: AlertDef = {
      ...alerteVariation("vc", "BTCUSDT", "1m"),
      condition: { type: "variation-pct", fenetreMs: 60_000, seuilPct: -10 },
      arme: true,
    };

    const juste = evaluerTick([chute], "BTCUSDT", TYPES_BOUGIE, { maintenant: t, dernierPrix: 90, candles });
    // Horloge locale en retard de 3,5 s sur la clôture réelle.
    const enRetard = evaluerTick([chute], "BTCUSDT", TYPES_BOUGIE, {
      maintenant: t - 3_500,
      dernierPrix: 90,
      candles,
    });

    expect(juste.declenchements[0]?.valeur).toBeCloseTo(-10, 5);
    expect(enRetard.declenchements[0]?.valeur).toBeCloseTo(-10, 5);
  });

  test("le filtre ne touche PAS les conditions hors bougie (prix-croise timeframé)", () => {
    const def: AlertDef = { ...alertePrix("p4", "BTCUSDT", 100, "hausse"), timeframe: "4h" };
    const res = evaluerTick([def], "BTCUSDT", TYPES_PRIX, { maintenant, dernierPrix: 90 });
    expect(res.defs).toHaveLength(1);
    expect(res.defs[0]?.arme).toBe(true);
  });
});

describe("evaluerEtPersister — alerte de bougie 4h (front-only)", () => {
  const maintenant = 3_000_000;

  test("def 4h : aucun état de ré-armement persisté par le daemon", () => {
    const d = baseAvecAlerte(alerteVariation("v4", "BTCUSDT", "4h"));
    evaluerEtPersister(
      "BTCUSDT",
      TYPES_BOUGIE,
      { maintenant, dernierPrix: 100, candles: bougiesPlates(maintenant) },
      { db: d, dernierHeartbeat: 0 },
    );
    expect(d.query("SELECT COUNT(*) AS n FROM alertes_etat").get()).toMatchObject({ n: 0 });
  });

  test("def 1m : état persisté (le daemon l'évalue bien)", () => {
    const d = baseAvecAlerte(alerteVariation("v1", "BTCUSDT", "1m"));
    evaluerEtPersister(
      "BTCUSDT",
      TYPES_BOUGIE,
      { maintenant, dernierPrix: 100, candles: bougiesPlates(maintenant) },
      { db: d, dernierHeartbeat: 0 },
    );
    expect(d.query("SELECT COUNT(*) AS n FROM alertes_etat").get()).toMatchObject({ n: 1 });
  });
});
