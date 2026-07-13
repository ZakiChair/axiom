import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { AlertDef, Declenchement } from "@axiom/alerts";
import {
  assurerTablesAlertes,
  chargerDefs,
  doitNotifier,
  evaluerEtPersister,
  evaluerTick,
  fusionnerEtatArme,
  SEUIL_HEARTBEAT_MS,
  symbolesBinanceActifs,
  symbolesFundingActifs,
  TYPES_FUNDING,
  TYPES_PRIX,
} from "./alerts";

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
